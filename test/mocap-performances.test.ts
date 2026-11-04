import { test } from 'node:test'
import assert from 'node:assert/strict'
import { axisAngle, multiply, toAxisAngle, transpose } from '../src/math/matrix.ts'
import { buildDatabase } from '../src/mocap/database.ts'
import { loopedFrames } from '../src/mocap/performance.ts'
import type { BodyFrame } from '../src/mocap/retarget.ts'
import { createPlayer } from '../src/mocap/player.ts'
import { loadClips, retargetOptions } from './mocap-fixtures.ts'

const FPS = 24
const EAST = Math.PI / 2
const database = buildDatabase(loadClips(), retargetOptions('knight'))

function player (): ReturnType<typeof createPlayer> {
  return createPlayer({ database, fps: FPS, ground: () => 0 }, { position: [0, 0, 0], yaw: EAST })
}

function run (p: ReturnType<typeof player>, frames: number): string[] {
  return Array.from({ length: frames }, () => p.step().clip)
}

test('performance takes are kept out of matching and an idle take closes on itself', () => {
  assert.deepEqual(database.performances.map(take => take.kind).sort(), ['attack', 'crouch', 'idle'])
  const names = new Set(database.entries.map(entry => entry.name))
  assert.ok(database.performances.every(take => !names.has(take.name)))
  const { frames } = database.performances.find(take => take.kind === 'idle')!
  assert.deepEqual(frames[frames.length - 1].rotations, frames[0].rotations)
})

test('a one-shot performance plays its take once and hands back to matching', () => {
  const p = player()
  run(p, 24)
  assert.equal(p.perform('attack'), true)
  assert.equal(p.performing(), true)
  const clips = run(p, 120)
  assert.ok(clips.includes('attack-punch'))
  assert.equal(p.performing(), false)
  assert.notEqual(clips[clips.length - 1], 'attack-punch')
})

test('an idle performance keeps looping until the player is told to move', () => {
  const p = player()
  run(p, 24)
  p.perform('idle')
  assert.ok(run(p, 400).every(clip => clip === 'idle-wait'))
  p.command({ speed: 1, heading: EAST })
  assert.equal(p.performing(), false)
})

test('a performance is refused while jumping or performing', () => {
  const p = player()
  run(p, 24)
  assert.equal(p.perform('crouch'), true)
  assert.equal(p.perform('attack'), false)
  p.cancelPerformance()
  assert.equal(p.jump({ x: 0.8, height: 0 }), true)
  assert.equal(p.perform('attack'), false)
})

test('an idle take\'s cross-fade makes its loop continuous where a plain cut jumps', () => {
  const identity = { rotations: {}, root: { position: [0, 0, 0], yaw: 0, velocity: [0, 0, 0], angularVelocity: 0 } }
  const swing = (i: number): number => 0.3 * Math.sin(2 * Math.PI * i / 40)
  const frames = Array.from({ length: 70 }, (_, i) => ({
    ...identity,
    rotations: { hip: axisAngle([0, 0, 1], swing(i)) },
    clearance: { left: 0, right: 0 },
    contact: [true, true]
  })) as unknown as BodyFrame[]
  const angle = (a: BodyFrame, b: BodyFrame): number => Math.abs(toAxisAngle(multiply(b.rotations.hip,
    transpose(a.rotations.hip))).angle)
  const steps = (list: BodyFrame[]): number[] => list.slice(1).map((frame, i) => angle(list[i], frame))
  const looped = loopedFrames(frames)
  assert.deepEqual(looped[looped.length - 1], looped[0])
  const usual = Math.max(...steps(frames))
  const closing = steps([...looped.slice(0, -1), looped[0]]).pop() as number
  assert.ok(closing <= 1.5 * usual, `the closing step ${closing} against ${usual}`)
  assert.ok(Math.max(...steps(looped)) <= 3 * usual)
  assert.ok(angle(frames[frames.length - 1], frames[12]) > 3 * usual, 'a plain cut at the ends would jump')
})

test('the new takes do not change what the page\'s player does', () => {
  const plain = buildDatabase(loadClips().filter(clip => clip.kind === undefined || clip.kind === 'jump'),
    retargetOptions('knight'))
  assert.equal(plain.performances.length, 0)
  const [a, b] = [database, plain].map(own => createPlayer({ database: own, fps: FPS, ground: () => 0 },
    { position: [0, 0, 0], yaw: EAST }))
  for (let i = 0; i < 400; i++) {
    const heading = EAST + (i > 200 ? 1 : 0)
    for (const p of [a, b]) p.command({ speed: i % 150 < 100 ? 1.1 : 0, heading })
    if (i === 250) for (const p of [a, b]) p.jump({ x: 0.8, height: 0 })
    assert.deepEqual(a.step(), b.step(), `step ${i}`)
  }
})
