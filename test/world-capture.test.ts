import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadCharacter } from '../src/formats/character.ts'
import type { ValidationError } from '../src/formats/validate.ts'
import { captureFor, readClips } from '../src/mocap/capture.ts'
import * as metrics from '../src/motion/metrics.ts'
import type { LocomotionRecording } from '../src/motion/metrics.ts'
import type { Pose } from '../src/motion/pose.ts'
import { validateWorldConfig } from '../src/world/config.ts'
import { readWorldBundle } from '../src/world/bundle.ts'
import { createWorld } from '../src/world/world.ts'
import type { CastMember, World, WorldFrame } from '../src/world/world.ts'

const FPS = 24
const config = validateWorldConfig(JSON.parse(readFileSync('site/world.json', 'utf8'))).value!
const errors: ValidationError[] = []
const clipFiles = readdirSync('motion/clips').filter(f => f.endsWith('.json')).sort()
const clips = readClips(clipFiles.map(f => JSON.parse(readFileSync(join('motion/clips', f), 'utf8'))), errors, 'clips')
const base = JSON.parse(readFileSync('motion/humanoid.json', 'utf8'))
const cast: CastMember[] = config.cast.map(name => {
  const character = loadCharacter(join('examples', name)).value!
  const member: CastMember = { name, mannequin: character.mannequin, rig: character.rig }
  const own = join('examples', name, 'retarget.json')
  if (!existsSync(own)) return member
  const capture = captureFor(member, clips, base, JSON.parse(readFileSync(own, 'utf8')), errors, name)
  return capture === undefined ? member : { ...member, capture }
})
const captured = cast.map((member, k) => ({ member, k })).filter(({ member }) => member.capture !== undefined)

function run (world: World, frames: number, each?: (frame: number) => void): WorldFrame[] {
  return Array.from({ length: frames }, (_, i) => {
    each?.(i)
    return world.step()
  })
}

test('the humanoids with a retarget.json move by motion capture, and the rest do not', () => {
  assert.deepEqual(errors, [])
  assert.deepEqual(captured.map(({ member }) => member.name).sort(), ['dwarf', 'knight', 'rogue', 'wizard'])
})

test('over a minute on the showcase terrain, captured actors keep busy and their feet keep the gates', () => {
  const world = createWorld({ seed: 3, cast, config, fps: FPS })
  const frames = run(world, 60 * FPS)
  for (const { member, k } of captured) {
    const activities = frames.map(f => f.actors[k].activity)
    const started = activities.filter((a, i) => i === 0 || a !== activities[i - 1] || frames[i].actors[k].handover)
    let moved = 0
    for (let i = 1; i < frames.length; i++) {
      moved += Math.abs(frames[i].actors[k].root.position[0] - frames[i - 1].actors[k].root.position[0])
    }
    const nonStop = member.rig.gait.referenceSpeed * 60
    assert.ok(new Set(activities).size >= 2 && started.length >= 4, `${member.name}: started ${started.length}`)
    assert.ok(moved >= 0.25 * nonStop, `${member.name} moved ${moved.toFixed(1)} m of ${nonStop.toFixed(1)}`)
    const relative: LocomotionRecording = {
      fps: FPS,
      frames: frames.map(f => {
        const joints: Pose = {}
        for (const [name, p] of Object.entries(f.actors[k].joints)) {
          joints[name] = [p[0], p[1] - world.terrain.ground(p[0], p[2]), p[2]]
        }
        return { time: f.time, root: f.actors[k].root, joints, clamped: 0, planted: {} }
      })
    }
    const actual: LocomotionRecording = {
      fps: FPS,
      frames: frames.map(f => {
        const actor = f.actors[k]
        return { time: f.time, root: actor.root, joints: actor.joints, clamped: 0, planted: {} }
      })
    }
    const geometry = { rig: member.rig, mannequin: member.mannequin }
    assert.ok(metrics.footSlidePx(relative, geometry, 1 / 34) <= 0.25, `${member.name}: slide`)
    assert.ok(metrics.groundPenetrationPx(relative, geometry, 1 / 34) <= 0.5, `${member.name}: penetration`)
    assert.equal(metrics.kneeLimitViolations(actual, geometry), 0, `${member.name}: knees`)
    assert.ok(frames.every(f => Object.values(f.actors[k].joints).every(p => p.every(Number.isFinite))))
  }
})

test('a poke shoves each captured actor away, further than it would have gone, and its startled walk goes away', () => {
  for (const seed of [3, 5, 8]) {
    for (const { member, k } of captured) {
      const poked = createWorld({ seed, cast, config, fps: FPS })
      const plain = createWorld({ seed, cast, config, fps: FPS })
      const x = run(poked, 2 * FPS)[2 * FPS - 1].actors[k].root.position[0]
      run(plain, 2 * FPS)
      const after = run(poked, 2 * FPS, i => { if (i === 0) poked.poke(k, x - 0.5) })
      const baseline = run(plain, 2 * FPS)
      const shove = after[11].actors[k].root.position[0] - baseline[11].actors[k].root.position[0]
      assert.ok(shove >= 0.1, `seed ${seed}, ${member.name}: shoved ${shove.toFixed(2)} m beyond its own path`)
      assert.ok(after.some(f => f.actors[k].activity === 'startled' && f.actors[k].say !== undefined))
      const end = after[after.length - 1].actors[k].root.position[0]
      assert.ok(end > x, `seed ${seed}, ${member.name}: the startled walk went back toward the poke`)
    }
  }
})

test('repeated pokes do not add up, and strong wind neither strands nor blows away captured actors', () => {
  const span = (world: World): [number, number] => [world.extent[0] - 0.5, world.extent[1] + 0.5]
  const poked = createWorld({ seed: 3, cast, config, fps: FPS })
  const { k } = captured[captured.length - 1]
  run(poked, FPS)
  const frames = run(poked, 3 * FPS, i => {
    if (i < FPS && i % 4 === 0) poked.poke(k, poked.extent[0])
  })
  const fastest = Math.max(...frames.map(f => Math.hypot(f.actors[k].root.velocity[0], f.actors[k].root.velocity[2])))
  assert.ok(fastest < 3, `top speed ${fastest.toFixed(2)} m/s`)
  for (const speed of [8, -8]) {
    const world = createWorld({ seed: 3, cast, config, fps: FPS })
    world.environment.wind.speed = Math.abs(speed)
    world.environment.wind.direction = [Math.sign(speed), 0, 0]
    world.environment.wind.gust = 0.4
    const windy = run(world, 60 * FPS)
    const [low, high] = span(world)
    for (const { member, k } of captured) {
      const xs = windy.map(f => f.actors[k].root.position[0])
      assert.ok(xs.every(x => x >= low && x <= high), `${speed} m/s: ${member.name} left the world`)
      const activities = new Set(windy.slice(30 * FPS).map(f => f.actors[k].activity))
      const handovers = windy.slice(30 * FPS).filter(f => f.actors[k].handover).length
      assert.ok(handovers >= 2, `${speed} m/s: ${member.name} stuck in ${[...activities].join(', ')}`)
    }
  }
})

test('malformed capture data is reported at its path, not thrown', () => {
  const bundle = JSON.parse(readFileSync('site/world.json', 'utf8'))
  const members = config.cast.map(name => {
    const dir = join('examples', name)
    const read = (file: string): unknown => JSON.parse(readFileSync(join(dir, file), 'utf8'))
    return { name, mannequin: read('mannequin.json'), style: read('style.json'), rig: read('rig.json') }
  })
  const paths = (capture: unknown): string[] => {
    return (readWorldBundle({ config: bundle, cast: members, capture }).errors).map(e => e.path).sort()
  }
  assert.deepEqual(paths('nope'), ['capture'])
  assert.deepEqual(paths({ clips: [], base: {} }), ['capture.members'])
  assert.deepEqual(paths({ clips: {}, base: {}, members: null }), ['capture.clips', 'capture.members'])
  assert.deepEqual(paths({ clips: [], base: {}, members: { ghost: {} } }), ['capture.members.ghost'])
})
