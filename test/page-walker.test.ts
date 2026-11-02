import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase } from '../src/mocap/database.ts'
import { createWalker } from '../src/page/walker.ts'
import type { Walker, WalkerFrame } from '../src/page/walker.ts'
import type { Ground } from '../src/page/surfaces.ts'
import { random } from '../src/world/terrain.ts'
import { HUMANOIDS, loadClips, retargetOptions } from './mocap-fixtures.ts'

const FPS = 24
const EAST = Math.PI / 2
const database = buildDatabase(loadClips(), retargetOptions('knight'))

function walker (ground: Ground, x: number, height: number, seed = 1): Walker {
  return createWalker({ database, fps: FPS, random: random(seed), ground, place: { x, height }, yaw: EAST })
}

function run (w: Walker, seconds: number): WalkerFrame[] {
  return Array.from({ length: seconds * FPS }, () => w.step())
}

function ground (surfaces: Array<[number, number, number]>, walls: Array<[number, number, number]> = []): Ground {
  return {
    surfaces: surfaces.map(([from, to, height], id) => ({ id, from, to, height })),
    walls: walls.map(([x, bottom, top], id) => ({ id: 100 + id, x, bottom, top }))
  }
}

test('a wanderer gets around a page of shelves, dropping down, never standing off a surface', () => {
  const page = ground([[0, 7, 0], [8, 16, 0], [2, 6, 1.2], [9, 12, 2.5], [6.5, 9, 0.1]])
  const frames = run(walker(page, 10.5, 2.5), 60)
  const visited = new Set(frames.flatMap(f => f.support === undefined || f.falling ? [] : [f.support.id]))
  assert.ok(visited.size >= 2, `stood on ${[...visited].join(', ')}`)
  assert.ok(frames.some(f => f.falling), 'it dropped off a shelf at least once')
  assert.ok(frames.every(f => f.support !== undefined), 'it never walks over the gap with nothing below')
  assert.ok(frames.filter(f => f.moving).length > 0.3 * frames.length, 'it spends time walking')
})

test('a wall splits the page: a wanderer on one side never crosses it', () => {
  const page = ground([[0, 12, 0]], [[6, 0, 3]])
  const frames = run(walker(page, 3, 0, 4), 60)
  const furthest = Math.max(...frames.map(f => f.root.position[0]))
  assert.ok(furthest < 6, `reached ${furthest.toFixed(2)} m`)
  assert.ok(Math.max(...frames.map(f => f.root.position[0])) - Math.min(...frames.map(f => f.root.position[0])) > 2)
})

test('turning round on a narrow ledge over nothing, every character stays up on it', () => {
  const fell: string[] = []
  for (const name of HUMANOIDS) {
    const own = buildDatabase(loadClips(), retargetOptions(name))
    for (const width of [0.5, 0.6, 0.8]) {
      for (const seed of [1, 2, 3]) {
        const page = ground([[0, 3, 0], [4, 4 + width, 1]])
        const w = createWalker({
          database: own, fps: FPS, random: random(seed), ground: page, place: { x: 4 + width / 2, height: 1 }, yaw: EAST
        })
        const frames = Array.from({ length: 4 * FPS }, (_, i) => {
          if (i % FPS === FPS / 2) w.poke()
          return w.step()
        })
        if (frames.some(f => f.support?.height !== 1 || f.falling)) fell.push(`${name} on ${width} m, seed ${seed}`)
      }
    }
  }
  assert.deepEqual(fell, [])
})

test('carried with its surface, a walker keeps walking where the surface now is', () => {
  const w = walker(ground([[0, 10, 1]]), 5, 1, 3)
  run(w, 3)
  const before = w.frame().root.position[0]
  w.setGround(ground([[2, 12, 0.4]]))
  w.shiftBy(2, -0.6)
  const frames = run(w, 3)
  assert.ok(Math.abs(frames[0].root.position[0] - before - 2) < 0.1)
  assert.ok(frames.every(f => !f.falling && f.support?.height === 0.4))
})

test('a poke turns a walker round and it walks the other way', () => {
  const page = ground([[0, 20, 0]])
  const w = walker(page, 10, 0, 2)
  run(w, 6)
  const before = w.frame()
  w.poke()
  const after = run(w, 2)
  const moved = after.at(-1)!.root.position[0] - before.root.position[0]
  assert.notEqual(after[0].heading, before.heading)
  assert.ok(Math.sign(moved) === Math.sign(Math.sin(after[0].heading)) && Math.abs(moved) > 0.3,
    `moved ${moved.toFixed(2)} m`)
})

test('moved with its surface, a walker stands on the surface where it now is', () => {
  const page = ground([[0, 10, 1]])
  const w = walker(page, 5, 1, 3)
  run(w, 2)
  const x = w.frame().root.position[0]
  const moved = ground([[3, 13, 0.4]])
  w.setGround(moved)
  w.moveTo({ x: x + 3, height: 0.4 })
  const frames = run(w, 1)
  assert.ok(frames.every(f => !f.falling && f.support?.height === 0.4))
})

test('asked to visit a place it can reach, a walker goes there; one it cannot reach, it refuses', () => {
  const page = ground([[0, 12, 0], [5, 7, 2]])
  const w = walker(page, 2, 0, 6)
  run(w, 1)
  assert.equal(w.reaches({ x: 6, height: 2 }), false)
  assert.equal(w.visit({ x: 6, height: 2 }), false)
  assert.equal(w.visit({ x: 10, height: 0 }), true)
  const frames = run(w, 12)
  const ended = frames.findIndex(f => f.activity !== 'visit')
  assert.ok(ended > 0, 'the visit ended')
  const end = frames[ended]
  assert.ok(end.activity === 'rest' && end.reached, `the visit ended in ${end.activity}`)
  assert.ok(Math.abs(end.root.position[0] - 10) < 0.15, `it stopped at ${end.root.position[0].toFixed(2)} m`)
})

test('walkers spend at least twice as long per metre on attractive elements', () => {
  const page = ground([[0, 4, 0], [4, 8, 0], [8, 12, 0]])
  let attracted = 0
  let plain = 0
  for (let seed = 1; seed <= 10; seed++) {
    const w = createWalker({
      database, fps: FPS, random: random(seed), ground: page, place: { x: 2 + seed, height: 0 }, yaw: EAST,
      attraction: surface => surface === 1 ? 3 : 0
    })
    for (const f of run(w, 60)) {
      if (f.support?.id === 1) attracted++
      else plain++
    }
  }
  const ratio = (attracted / 4) / (plain / 8)
  assert.ok(ratio >= 2, `${ratio.toFixed(2)} times as long per metre`)
})

test('a visit whose place goes from the page ends without arriving', () => {
  const w = walker(ground([[0, 12, 0]]), 2, 0, 6)
  run(w, 1)
  assert.equal(w.visit({ x: 10, height: 0 }), true)
  run(w, 1)
  w.setGround(ground([[0, 6, 0]]))
  const after = w.step()
  assert.equal(after.activity, 'rest')
  assert.equal(after.reached, false)
})
