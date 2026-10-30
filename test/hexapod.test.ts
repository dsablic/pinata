import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkRig, legsOf, validateRig } from '../src/formats/rig.ts'
import { planGait } from '../src/motion/gait.ts'
import type { GaitFrame } from '../src/motion/gait.ts'
import { kneeFlexionDegrees } from '../src/motion/ik.ts'
import { poseAt } from '../src/motion/locomotion.ts'
import * as metrics from '../src/motion/metrics.ts'
import { restPose } from '../src/motion/pose.ts'
import { toLocal, toWorld } from '../src/sim/body.ts'
import { length, sub } from '../src/math/vec.ts'
import type { Vec3 } from '../src/math/vec.ts'
import { assertClose } from './helpers.ts'
import { walkTrack } from './locomotion-fixtures.ts'
import { hexMannequin as mannequin, hexRig as rig } from './hexapod-fixtures.ts'

const FPS = 24
const rest = restPose(mannequin)

function walk (): GaitFrame[] {
  return planGait({ track: walkTrack(0.5, 5), rig, rest, mannequin, duration: 7, fps: FPS })
}

function bone (pose: Record<string, Vec3>, a: string, b: string): number {
  return length(sub(pose[a], pose[b]))
}

test('the hexapod fixture rig passes validateRig and checkRig', () => {
  assert.deepEqual(validateRig(structuredClone(rig)).errors, [])
  assert.deepEqual(checkRig(rig, mannequin), [])
  assert.deepEqual(legsOf(rig)[0].bends, ['forward', 'backward'])
})

test('hexapod legs keep every segment length, reach the planned feet and never clamp', () => {
  for (const frame of walk()) {
    const { pose, clamped } = poseAt({ frame, rig, rest, mannequin })
    assert.equal(clamped, 0)
    legsOf(rig).forEach((leg, k) => {
      leg.joints.slice(1).forEach((joint, i) => {
        assertClose(bone(pose, leg.joints[i], joint), bone(rest, leg.joints[i], joint), 1e-9)
      })
      const ankle = toWorld(pose[leg.ankle], frame.root)
      for (let axis = 0; axis < 3; axis++) assertClose(ankle[axis], frame.feet[k].ankle[axis], 1e-4)
    })
  }
})

test('hexapod planted feet stay put in world space', () => {
  const frames = walk()
  const ankles = frames.map(frame => {
    const { pose } = poseAt({ frame, rig, rest, mannequin })
    return legsOf(rig).map(leg => toWorld(pose[leg.ankle], frame.root))
  })
  let held = 0
  for (let i = 1; i < frames.length; i++) {
    frames[i].feet.forEach((foot, k) => {
      if (!foot.planted || !frames[i - 1].feet[k].planted) return
      held++
      assert.ok(length(sub(ankles[i][k], ankles[i - 1][k])) < 2e-4, `leg ${k} frame ${i}`)
    })
  }
  assert.ok(held > 200)
})

test('hexapod feet land in phase order, tripod group after tripod group', () => {
  const frames = walk()
  const recording = metrics.recordLocomotion(frames, { rig, rest, mannequin, fps: FPS })
  const geometry = { rig, mannequin }
  assert.equal(metrics.alternationViolations(recording, geometry, [{ start: 0, end: 7 }]), 0)
  const groups: number[] = []
  for (let i = 1; i < frames.length; i++) {
    frames[i].feet.forEach((foot, k) => {
      if (foot.planted && !frames[i - 1].feet[k].planted) groups.push(legsOf(rig)[k].phase ?? 0)
    })
  }
  assert.ok(groups.length >= 12)
  const changes = groups.filter((phase, i) => i === 0 || phase !== groups[i - 1]).length
  assert.ok(changes >= 4, `landing groups: ${groups.join(' ')}`)
  assert.equal(metrics.reachViolations(recording), 0)
})

test('hexapod at rest stands in the rest pose', () => {
  const [frame] = planGait({ track: walkTrack(0, 0), rig, rest, mannequin, duration: 1, fps: FPS })
  const { pose } = poseAt({ frame, rig, rest, mannequin })
  for (const name of Object.keys(rest)) {
    for (let k = 0; k < 3; k++) assertClose(pose[name][k], rest[name][k], 1e-4)
  }
})

test('hexapod joints bend to their sides: knees forward, hocks backward', () => {
  for (const frame of walk()) {
    const { pose } = poseAt({ frame, rig, rest, mannequin })
    for (const leg of legsOf(rig)) {
      const [hip, knee, hock, ankle] = leg.chain.map(name => pose[name])
      const kneeOffset = knee[2] - (hip[2] + (hock[2] - hip[2]) * (hip[1] - knee[1]) / (hip[1] - hock[1]))
      const hockOffset = hock[2] - (knee[2] + (ankle[2] - knee[2]) * (knee[1] - hock[1]) / (knee[1] - ankle[1]))
      assert.ok(kneeOffset > -1e-6, `knee ${kneeOffset}`)
      assert.ok(hockOffset < 1e-6, `hock ${hockOffset}`)
    }
  }
})

test('arms swing as a whole chain about the shoulder, counter to the nearest leg on their side', () => {
  const frames = walk()
  const frame = frames.reduce((best, f) => Math.abs(f.armSwings[0]) > Math.abs(best.armSwings[0]) ? f : best)
  assert.ok(Math.abs(frame.armSwings[0]) > 10)
  const { pose } = poseAt({ frame, rig, rest, mannequin })
  const angle = frame.armSwings[0] * Math.PI / 180
  for (const [tag, sign] of [['L', 1], ['R', -1]] as const) {
    const turn = sign * angle
    for (const joint of ['elbow', 'claw', 'gem']) {
      const offset = sub(rest[`${joint}${tag}`], rest[`shoulder${tag}`])
      const expected: Vec3 = [
        offset[0],
        offset[1] * Math.cos(turn) - offset[2] * Math.sin(turn),
        offset[1] * Math.sin(turn) + offset[2] * Math.cos(turn)
      ]
      const actual = sub(pose[`${joint}${tag}`], pose[`shoulder${tag}`])
      for (let k = 0; k < 3; k++) assertClose(actual[k], expected[k], 1e-9)
    }
  }
})

test('appendages are placed with the pelvis offset', () => {
  const frame = walk().reduce((best, f) => f.pelvisOffset[1] < best.pelvisOffset[1] ? f : best)
  assert.ok(frame.pelvisOffset[1] < 0)
  const { pose } = poseAt({ frame, rig, rest, mannequin })
  for (const joint of ['tail1', 'tail2', 'tail3']) {
    for (let k = 0; k < 3; k++) assertClose(pose[joint][k], rest[joint][k] + frame.pelvisOffset[k], 1e-12)
  }
})

test('hexapod joint speeds are reported for every intermediate joint of every leg', () => {
  const recording = metrics.recordLocomotion(walk(), { rig, rest, mannequin, fps: FPS })
  const speeds = metrics.jointSpeedsDegPerSec(recording, { rig, mannequin })
  assert.equal(speeds.length, 12)
  assert.deepEqual(speeds.slice(0, 2).map(s => [s.leg, s.joint]), [[0, 'kneeLF'], [0, 'hockLF']])
  assert.ok(speeds.every(s => s.value > 0))
  assert.equal(metrics.kneeSpeedDegPerSec(recording, { rig, mannequin }), Math.max(...speeds.map(s => s.value)))
  assert.equal(metrics.kneeLimitViolations(recording, { rig, mannequin }), 0)
  assert.equal(metrics.boneLengthError(recording, { rig, mannequin }, rest) < 1e-9, true)
})

test('leg limits given on a limb bound every intermediate joint', () => {
  const limited = { ...rig, limbs: rig.limbs.map(l => l.kind === 'leg' ? { ...l, limits: { min: 0, max: 70 } } : l) }
  const recording = metrics.recordLocomotion(walk(), { rig: limited, rest, mannequin, fps: FPS })
  assert.equal(metrics.kneeLimitViolations(recording, { rig: limited, mannequin }), 0)
  for (const { joints } of recording.frames) {
    for (const leg of legsOf(limited)) {
      const [a, b, c] = leg.chain.slice(0, 3)
      assert.ok(kneeFlexionDegrees(joints[a], joints[b], joints[c]) <= 70 + 1e-6)
    }
  }
})

function splayed (): typeof mannequin {
  const joints = structuredClone(mannequin.joints)
  for (const { tag, x, z } of [
    { tag: 'LF', x: 0.1, z: 0.3 }, { tag: 'LM', x: 0.1, z: 0 }, { tag: 'LH', x: 0.1, z: -0.3 },
    { tag: 'RF', x: -0.1, z: 0.3 }, { tag: 'RM', x: -0.1, z: 0 }, { tag: 'RH', x: -0.1, z: -0.3 }
  ]) {
    joints[`knee${tag}`] = [x * 1.5, 0.75, z]
    joints[`hock${tag}`] = [x * 2.2, 0.4, z]
    joints[`ankle${tag}`] = [x * 2.8, 0.03, z]
    joints[`toe${tag}`] = [x * 2.8, 0.03, z + 0.08]
  }
  return { ...mannequin, joints }
}

test('bend up puts every knee above its hip on a splayed leg', () => {
  const wide = splayed()
  const wideRest = restPose(wide)
  const spider = { ...rig, limbs: rig.limbs.map(l => l.kind === 'leg' ? { ...l, bend: 'up' as const } : l) }
  const frame: GaitFrame = {
    root: { position: [0, 0, 0], yaw: 0, velocity: [0, 0, 0], angularVelocity: 0 },
    pelvisOffset: [0, 0, 0],
    feet: legsOf(spider).map(leg => ({
      side: leg.side, ankle: wideRest[leg.ankle], toeYaw: 0, planted: true, lift: 0, toePitch: 0
    })),
    armSwings: legsOf(spider).map(() => 0),
    phase: 0
  }
  const { pose, clamped } = poseAt({ frame, rig: spider, rest: wideRest, mannequin: wide })
  assert.equal(clamped, 0)
  for (const leg of legsOf(spider)) {
    assert.ok(pose[leg.knee][1] > pose[leg.hip][1] + 0.1, `${leg.name} knee ${pose[leg.knee][1]}`)
    assertClose(bone(pose, leg.hip, leg.knee), bone(wideRest, leg.hip, leg.knee), 1e-9)
  }
})

test('a splayed hexapod keeps its spread while walking and at the stop when lateral is rest', () => {
  const wide = splayed()
  const wideRest = restPose(wide)
  const spread = { ...rig, gait: { ...rig.gait, lateral: 'rest' as const } }
  const frames = planGait({
    track: walkTrack(0.5, 5), rig: spread, rest: wideRest, mannequin: wide, duration: 8, fps: FPS
  })
  const last = frames[frames.length - 1]
  let planted = 0
  for (const frame of frames) {
    legsOf(spread).forEach((leg, k) => {
      if (!frame.feet[k].planted) return
      planted++
      assertClose(frame.feet[k].ankle[0], wideRest[leg.ankle][0], 1e-9)
    })
  }
  assert.ok(planted > 200)
  assert.ok(last.feet.every(foot => foot.planted))
  legsOf(spread).forEach((leg, k) => assertClose(last.feet[k].ankle[0], wideRest[leg.ankle][0], 1e-9))
  const { clamped } = poseAt({ frame: last, rig: spread, rest: wideRest, mannequin: wide })
  assert.equal(clamped, 0)
})

test('without lateral rest the feet plant footSpacing / 2 from the centre line', () => {
  const wide = splayed()
  const frames = planGait({
    track: walkTrack(0.5, 5), rig, rest: restPose(wide), mannequin: wide, duration: 8, fps: FPS
  })
  const spacing = rig.gait.footSpacing
  for (const frame of frames.slice(120)) {
    frame.feet.forEach(foot => {
      if (foot.planted) assertClose(Math.abs(foot.ankle[0]), spacing / 2, 1e-9)
    })
  }
})

test('with lateral rest, feet plant at their rest ankle offset along the body as well as sideways', () => {
  const fanned = structuredClone(mannequin)
  for (const tag of ['LF', 'RF']) {
    fanned.joints[`ankle${tag}`][2] += 0.08
    fanned.joints[`toe${tag}`][2] += 0.08
  }
  const fannedRest = restPose(fanned)
  const restRig = { ...rig, gait: { ...rig.gait, lateral: 'rest' as const } }
  const track = walkTrack(0.5, 5)
  const frames = planGait({ track, rig: restRig, rest: fannedRest, mannequin: fanned, duration: 7, fps: FPS })
  legsOf(restRig).forEach((leg, k) => {
    const planted = frames.filter(f => f.root.position[2] > 1 && f.feet[k].planted)
      .map(f => toLocal(f.feet[k].ankle, f.root)[2])
    const mean = planted.reduce((a, b) => a + b, 0) / planted.length
    const expected = fannedRest[leg.ankle][2]
    assert.ok(Math.abs(mean - expected) < 0.03, `${leg.name}: mean ${mean} vs ${expected}`)
  })
})
