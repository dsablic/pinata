import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Mannequin } from '../src/formats/mannequin.ts'
import { legsOf } from '../src/formats/rig.ts'
import type { Rig } from '../src/formats/rig.ts'
import type { Vec3 } from '../src/math/vec.ts'
import { planGait } from '../src/motion/gait.ts'
import * as metrics from '../src/motion/metrics.ts'
import type { LocomotionRecording } from '../src/motion/metrics.ts'
import { restPose } from '../src/motion/pose.ts'
import type { RootState } from '../src/motion/script.ts'
import { generateTerrain, terrainOf } from '../src/world/terrain.ts'
import type { Terrain } from '../src/world/terrain.ts'
import { mannequin, quadMannequin, quadRig, rig } from './locomotion-fixtures.ts'

const FPS = 24
const SPEED = 0.4
const WALK = 18

/** Ramps of 20 degrees and flights of four stairs of the given rise, up and down. */
function course (rise: number): Terrain {
  const ramp = 0.5 / Math.tan(20 * Math.PI / 180)
  const top = 0.5 + 4 * rise
  return terrainOf([
    { kind: 'flat', from: -2, to: 1, height: 0 },
    { kind: 'ramp', from: 1, to: 1 + ramp, start: 0, end: 0.5 },
    { kind: 'flat', from: 1 + ramp, to: 3 + ramp, height: 0.5 },
    { kind: 'stairs', from: 3 + ramp, to: 4.6 + ramp, start: 0.5, end: top, steps: 4 },
    { kind: 'flat', from: 4.6 + ramp, to: 6 + ramp, height: top },
    { kind: 'stairs', from: 6 + ramp, to: 7.6 + ramp, start: top, end: 0.5, steps: 4 },
    { kind: 'ramp', from: 7.6 + ramp, to: 7.6 + 2 * ramp, start: 0.5, end: 0 },
    { kind: 'flat', from: 7.6 + 2 * ramp, to: 30, height: 0 }
  ])
}

function track (t: number): RootState {
  const moving = t < WALK
  return {
    position: [Math.min(t, WALK) * SPEED - 1, 0, 0], yaw: Math.PI / 2, velocity: [moving ? SPEED : 0, 0, 0],
    angularVelocity: 0
  }
}

/** The recording with every joint's height measured from the ground under it, so the flat-ground metrics apply. */
function aboveGround (recording: LocomotionRecording, terrain: Terrain): LocomotionRecording {
  return {
    fps: recording.fps,
    frames: recording.frames.map(frame => ({
      ...frame,
      joints: Object.fromEntries(Object.entries(frame.joints).map(([name, p]): [string, Vec3] => {
        return [name, [p[0], p[1] - terrain.ground(p[0], p[2]), p[2]]]
      }))
    }))
  }
}

function legLength (m: Mannequin, r: Rig): number {
  const rest = restPose(m)
  const leg = legsOf(r)[0]
  return rest[leg.hip][1] - rest[leg.ankle][1]
}

for (const [name, body, bodyRig] of [['biped', mannequin, rig], ['quadruped', quadMannequin, quadRig]] as const) {
  test(`a ${name} walks up and down 20-degree ramps and stairs rising 0.35 leg lengths without slipping`, () => {
    const terrain = course(0.35 * legLength(body, bodyRig))
    const rest = restPose(body)
    const frames = planGait({
      track, rig: bodyRig, rest, mannequin: body, duration: WALK + 2, fps: FPS, ground: terrain.ground
    })
    const recording = metrics.recordLocomotion(frames, { rig: bodyRig, rest, mannequin: body, fps: FPS })
    const relative = aboveGround(recording, terrain)
    const geometry = { rig: bodyRig, mannequin: body }
    const mpp = body.height / 48
    assert.ok(recording.frames[recording.frames.length - 1].root.position[0] > 6, 'the walk crosses the course')
    const slide = metrics.footSlidePx(relative, geometry, mpp)
    assert.ok(slide <= 0.25, `slide ${slide}`)
    const penetration = metrics.groundPenetrationPx(relative, geometry, mpp)
    assert.ok(penetration <= 0.5, `penetration ${penetration}`)
    assert.equal(metrics.reachViolations(recording), 0)
    assert.equal(metrics.kneeLimitViolations(recording, geometry), 0)
    assert.equal(metrics.alternationViolations(relative, geometry, [{ start: 2, end: WALK - 1 }]), 0)
    assert.equal(metrics.unsupportedFrames(relative, geometry), 0)
  })
}

test('without ground the planner is unchanged; with flat ground it plans the same walk', () => {
  const rest = restPose(mannequin)
  const plain = planGait({ track, rig, rest, mannequin, duration: 4, fps: FPS })
  const level = planGait({ track, rig, rest, mannequin, duration: 4, fps: FPS, ground: () => 0 })
  const flat = (frame: (typeof plain)[number]): boolean => {
    return frame.pelvisPitch === undefined && frame.feet.every(foot => foot.surfacePitch === undefined)
  }
  assert.ok(plain.every(flat))
  level.forEach((frame, i) => {
    assert.deepEqual(frame.pelvisOffset, plain[i].pelvisOffset)
    frame.feet.forEach((foot, k) => { assert.deepEqual(foot.ankle, plain[i].feet[k].ankle) })
  })
})

test('generated terrain is contiguous, seeded, and keeps rises and slopes within the limits', () => {
  const options = { length: 60, maxRise: 0.12, maxSlopeDegrees: 18, maxHeight: 0.8 }
  const terrain = generateTerrain(7, options)
  assert.deepEqual(generateTerrain(7, options).spans, terrain.spans)
  assert.notDeepEqual(generateTerrain(8, options).spans, terrain.spans)
  assert.ok(terrain.to >= 60)
  const kinds = new Set(terrain.spans.map(span => span.kind))
  assert.deepEqual([...kinds].sort(), ['flat', 'ramp', 'stairs'])
  for (const span of terrain.spans) {
    if (span.kind === 'stairs') assert.ok(Math.abs(span.end - span.start) / span.steps <= options.maxRise + 1e-9)
    if (span.kind === 'ramp') {
      const slope = Math.atan(Math.abs(span.end - span.start) / (span.to - span.from)) * 180 / Math.PI
      assert.ok(slope <= options.maxSlopeDegrees + 1e-9, `slope ${slope}`)
    }
    if (span.kind === 'flat') assert.ok(span.height >= 0 && span.height <= options.maxHeight + 1e-9)
  }
  for (let x = terrain.from; x < terrain.to; x += 0.01) {
    assert.ok(Math.abs(terrain.ground(x + 0.01, 0) - terrain.ground(x, 0)) <= options.maxRise + 1e-9)
  }
})

function walkAlong (from: number, to: number): (t: number) => RootState {
  const sign = Math.sign(to - from)
  const seconds = Math.abs(to - from) / SPEED
  return (t: number) => ({
    position: [from + sign * SPEED * Math.min(t, seconds), 0, 0],
    yaw: sign * Math.PI / 2,
    velocity: [t < seconds ? sign * SPEED : 0, 0, 0],
    angularVelocity: 0
  })
}

for (const seed of [3, 8, 15]) {
  test(`generated course ${seed}: both bodies walk it both ways with regular steps and a bounded lean`, () => {
    for (const [body, bodyRig] of [[mannequin, rig], [quadMannequin, quadRig]] as const) {
      const leg = legLength(body, bodyRig)
      const terrain = generateTerrain(seed, {
        length: 12, maxRise: 0.3 * leg, maxSlopeDegrees: 18, maxHeight: 4 * 0.3 * leg, minTread: 0.4
      })
      const rest = restPose(body)
      for (const [from, to] of [[0.5, 11], [11, 0.5]]) {
        const track = walkAlong(from, to)
        const duration = Math.abs(to - from) / SPEED + 2
        const ground = terrain.ground
        const frames = planGait({ track, rig: bodyRig, rest, mannequin: body, duration, fps: FPS, ground })
        const recording = metrics.recordLocomotion(frames, { rig: bodyRig, rest, mannequin: body, fps: FPS })
        const relative = aboveGround(recording, terrain)
        const geometry = { rig: bodyRig, mannequin: body }
        const mpp = body.height / 48
        const where = `seed ${seed}, ${from} to ${to}`
        assert.ok(metrics.footSlidePx(relative, geometry, mpp) <= 0.25, `${where}: slide`)
        assert.ok(metrics.groundPenetrationPx(relative, geometry, mpp) <= 0.5, `${where}: penetration`)
        assert.equal(metrics.reachViolations(recording), 0, `${where}: reach`)
        assert.ok(frames.every(f => Math.abs(f.pelvisPitch ?? 0) <= 35 * Math.PI / 180), `${where}: lean`)
        const nominal = bodyRig.gait.strideLength / 2
        const steps: number[] = []
        frames.forEach((frame, i) => {
          frame.feet.forEach((foot, k) => {
            if (i === 0 || !foot.planted || frames[i - 1].feet[k].planted) return
            const lifted = frames[i - 1].feet[k]
            steps.push(Math.hypot(foot.ankle[0] - lifted.ankle[0], foot.ankle[2] - lifted.ankle[2]))
          })
        })
        const walking = steps.slice(1, -2)
        assert.ok(walking.every(d => d <= 2.2 * nominal), `${where}: longest step ${Math.max(...walking)} m`)
      }
    }
  })
}

test('the generator copes with tight limits and refuses broken spans', () => {
  const flat = generateTerrain(1, { length: 10, maxRise: 0.12, maxSlopeDegrees: 15, maxHeight: 0.02 })
  assert.deepEqual(flat.spans.map(s => s.kind), ['flat'])
  const low = generateTerrain(2, { length: 30, maxRise: 0.12, maxSlopeDegrees: 15, maxHeight: 0.1 })
  assert.ok(low.spans.every(s => s.kind !== 'flat' || s.height <= 0.1 + 1e-9))
  const steep = generateTerrain(3, { length: 30, maxRise: 0.12, maxSlopeDegrees: 0, maxHeight: 0.6, minTread: 0.5 })
  assert.ok(steep.spans.every(s => s.kind !== 'ramp'))
  assert.ok(steep.spans.every(s => s.kind !== 'stairs' || (s.to - s.from) / s.steps >= 0.5))
  assert.throws(() => terrainOf([]), /at least one span/)
  assert.throws(() => terrainOf([{ kind: 'ramp', from: 1, to: 1, start: 0, end: 1 }]), /positive length/)
  const stairs = terrainOf([{ kind: 'stairs', from: 0, to: 1, start: 0, end: 0.4, steps: 2 }])
  assert.equal(stairs.ground(-1, 0), 0)
  assert.equal(stairs.ground(2, 0), 0.4)
})
