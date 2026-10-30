import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Mannequin } from '../src/formats/mannequin.ts'
import { legsOf } from '../src/formats/rig.ts'
import type { Rig } from '../src/formats/rig.ts'
import { kneeBendsBackward, kneeFlexionDegrees } from '../src/motion/ik.ts'
import { planGait } from '../src/motion/gait.ts'
import { poseAt } from '../src/motion/locomotion.ts'
import * as metrics from '../src/motion/metrics.ts'
import { restPose } from '../src/motion/pose.ts'
import { toWorld } from '../src/sim/body.ts'
import { length, sub } from '../src/math/vec.ts'
import type { Vec3 } from '../src/math/vec.ts'
import { assertClose } from './helpers.ts'
import {
  mannequin, quadMannequin, quadRig, rig, straightMannequin, turnTrack, walkTrack
} from './locomotion-fixtures.ts'

const rest = restPose(mannequin)

function frames (speed: number, walkSeconds: number, duration: number) {
  return planGait({ track: walkTrack(speed, walkSeconds), rig, rest, mannequin, duration, fps: 24 })
}

function distance (pose: Record<string, Vec3>, a: string, b: string): number {
  return length(sub(pose[a], pose[b]))
}

const BONES: [string, string][] = [
  ['hipL', 'kneeL'], ['kneeL', 'ankleL'], ['ankleL', 'toeL'], ['hipR', 'kneeR'], ['kneeR', 'ankleR'],
  ['ankleR', 'toeR'], ['shoulderL', 'elbowL'], ['elbowL', 'wristL'], ['shoulderR', 'elbowR'],
  ['elbowR', 'wristR']
]

test('bone lengths equal rest lengths in every frame of a walk', () => {
  for (const frame of frames(1.2, 4, 7)) {
    const { pose, clamped } = poseAt({ frame, rig, rest, mannequin })
    assert.equal(clamped, 0)
    for (const [a, b] of BONES) assertClose(distance(pose, a, b), distance(rest, a, b), 1e-9)
  }
})

test('a root at rest with the feet at rest gives the rest pose', () => {
  const [frame] = frames(0, 0, 1)
  const { pose, clamped } = poseAt({ frame, rig, rest, mannequin })
  assert.equal(clamped, 0)
  for (const name of Object.keys(rest)) {
    for (let k = 0; k < 3; k++) assertClose(pose[name][k], rest[name][k], 1e-6)
  }
})

test('knees bend forward throughout a walk', () => {
  for (const frame of frames(1.2, 4, 7)) {
    const { pose } = poseAt({ frame, rig, rest, mannequin })
    for (const side of ['L', 'R']) {
      assert.equal(kneeBendsBackward(pose[`hip${side}`], pose[`knee${side}`], pose[`ankle${side}`], [0, 0, 1]), false)
    }
  }
})

test('planted ankles land on the planner positions in world space', () => {
  for (const frame of frames(1.2, 4, 7)) {
    const { pose } = poseAt({ frame, rig, rest, mannequin })
    const left = toWorld(pose.ankleL, frame.root)
    for (let k = 0; k < 3; k++) assertClose(left[k], frame.feet[0].ankle[k], 1e-9)
  }
})

test('the swing toe pitches up with lift, the planted toe stays flat', () => {
  const walk = frames(1.2, 4, 7)
  const flat = poseAt({ frame: walk[0], rig, rest, mannequin }).pose
  assertClose(flat.toeL[1] - flat.ankleL[1], rest.toeL[1] - rest.ankleL[1], 1e-9)
  const peak = walk.reduce((best, f) => (f.feet[0].lift > best.feet[0].lift ? f : best))
  const pose = poseAt({ frame: peak, rig, rest, mannequin }).pose
  assert.ok(pose.toeL[1] - pose.ankleL[1] > rest.toeL[1] - rest.ankleL[1] + 0.02)
})

test('arms swing in opposite directions and the upper body follows the pelvis', () => {
  const walk = frames(1.2, 4, 7)
  const frame = walk.reduce((best, f) => (Math.abs(f.armSwings[0]) > Math.abs(best.armSwings[0]) ? f : best))
  const { pose } = poseAt({ frame, rig, rest, mannequin })
  const left = pose.handL[2] - rest.handL[2]
  const right = pose.handR[2] - rest.handR[2]
  assert.ok(left * right < 0)
  assertClose(pose.chest[1] - rest.chest[1], frame.pelvisOffset[1])
  assertClose(pose.shoulderL[1] - rest.shoulderL[1], frame.pelvisOffset[1])
})

test('a straight-legged rig at rest stays within 1 cm of its rest pose', () => {
  const straight = restPose(straightMannequin)
  const [frame] = planGait({
    track: walkTrack(0, 0), rig, rest: straight, mannequin: straightMannequin, duration: 1, fps: 24
  })
  const { pose, clamped } = poseAt({ frame, rig, rest: straight, mannequin: straightMannequin })
  assert.equal(clamped, 0)
  assert.ok(Math.abs(pose.pelvis[1] - straight.pelvis[1]) < 0.01, `pelvis moved ${pose.pelvis[1] - straight.pelvis[1]}`)
})

test('a carried joint keeps its distance to the hand during an arm swing', () => {
  const sword: Mannequin = { ...mannequin, joints: { ...mannequin.joints, tip: [-0.27, 0.82, 0.5] } }
  const carrying: Rig = {
    ...rig,
    limbs: rig.limbs.map(l => (l.kind === 'arm' && l.side === 'right' ? { ...l, carried: ['tip'] } : l))
  }
  const swordRest = restPose(sword)
  const track = walkTrack(1.2, 4)
  const walk = planGait({ track, rig: carrying, rest: swordRest, mannequin: sword, duration: 7, fps: 24 })
  const frame = walk.reduce((best, f) => (Math.abs(f.armSwings[0]) > Math.abs(best.armSwings[0]) ? f : best))
  const { pose } = poseAt({ frame, rig: carrying, rest: swordRest, mannequin: sword })
  assertClose(distance(pose, 'tip', 'handR'), distance(swordRest, 'tip', 'handR'), 1e-9)
  assert.ok(Math.abs(pose.tip[1] - swordRest.tip[1] - frame.pelvisOffset[1]) > 0.05)
})

function kneeFlexions (speed: number): number[][] {
  return frames(speed, 4, 7).map(frame => {
    const { pose } = poseAt({ frame, rig, rest, mannequin })
    return ['L', 'R'].map(side => kneeFlexionDegrees(pose[`hip${side}`], pose[`knee${side}`], pose[`ankle${side}`]))
  })
}

test('knees stay at least 25 degrees bent while walking at the reference speed', () => {
  const walking = kneeFlexions(1.2).slice(0, 96).flat()
  assert.ok(Math.min(...walking) >= 25, `knee reached ${Math.min(...walking)} degrees`)
})

test('knee flexion speed stays under 600 degrees per second at 24 fps in a brisk walk', () => {
  const flexions = kneeFlexions(1.6)
  let peak = 0
  for (let i = 1; i < flexions.length; i++) {
    for (let k = 0; k < 2; k++) peak = Math.max(peak, Math.abs(flexions[i][k] - flexions[i - 1][k]) * 24)
  }
  assert.ok(peak <= 600, `knee peaked at ${peak.toFixed(0)} degrees per second`)
})

test('knees stay at least 25 degrees bent while stepping around in place', () => {
  const straight = restPose(straightMannequin)
  const turning = planGait({
    track: turnTrack(Math.PI, 2), rig, rest: straight, mannequin: straightMannequin, duration: 3, fps: 24
  })
  const flexions = turning.slice(0, 48).flatMap(frame => {
    const { pose } = poseAt({ frame, rig, rest: straight, mannequin: straightMannequin })
    return ['L', 'R'].map(side => kneeFlexionDegrees(pose[`hip${side}`], pose[`knee${side}`], pose[`ankle${side}`]))
  })
  assert.ok(Math.min(...flexions) >= 25, `knee reached ${Math.min(...flexions)} degrees`)
})

test('each leg bends toward its own side: forward legs and backward legs of a quadruped', () => {
  const quadRest = restPose(quadMannequin)
  const gait = planGait({
    track: walkTrack(0.9, 4), rig: quadRig, rest: quadRest, mannequin: quadMannequin, duration: 6, fps: 24
  })
  let bent = 0
  for (const frame of gait) {
    const { pose, clamped } = poseAt({ frame, rig: quadRig, rest: quadRest, mannequin: quadMannequin })
    assert.equal(clamped, 0)
    for (const leg of legsOf(quadRig)) {
      const forward: Vec3 = leg.bend === 'backward' ? [0, 0, -1] : [0, 0, 1]
      assert.equal(kneeBendsBackward(pose[leg.hip], pose[leg.knee], pose[leg.ankle], forward), false)
      const chord = sub(pose[leg.ankle], pose[leg.hip])
      const offset = sub(pose[leg.knee], pose[leg.hip])
      const along = (chord[0] * offset[0] + chord[1] * offset[1] + chord[2] * offset[2]) / length(chord) ** 2
      const side = offset[2] - chord[2] * along
      if (Math.abs(side) > 0.01) bent++
      assert.ok(leg.bend === 'backward' ? side < 1e-9 : side > -1e-9)
    }
  }
  assert.ok(bent > 100)
})

test('four feet are assigned to the legs by index, not by side', () => {
  const quadRest = restPose(quadMannequin)
  const [frame] = planGait({
    track: walkTrack(0, 0), rig: quadRig, rest: quadRest, mannequin: quadMannequin, duration: 1, fps: 24
  })
  const { pose } = poseAt({ frame, rig: quadRig, rest: quadRest, mannequin: quadMannequin })
  for (const leg of legsOf(quadRig)) {
    for (let k = 0; k < 3; k++) assertClose(pose[leg.ankle][k], quadRest[leg.ankle][k], 1e-6)
  }
})

test('limits on two-bone legs clamp the knee and the missed target counts as clamped', () => {
  const capped = (l: Rig['limbs'][number]): Rig['limbs'][number] => {
    return l.kind === 'leg' ? { ...l, limits: { min: 0, max: 20 } } : l
  }
  const limited: Rig = { ...rig, limbs: rig.limbs.map(capped) }
  const walked = planGait({ track: walkTrack(1.2, 4), rig: limited, rest, mannequin, duration: 6, fps: 24 })
  const recording = metrics.recordLocomotion(walked, { rig: limited, rest, mannequin, fps: 24 })
  assert.ok(recording.frames.every(f => f.clamped > 0))
  assert.ok(metrics.reachViolations(recording) > 0)
  for (const { joints } of recording.frames) {
    assert.ok(kneeFlexionDegrees(joints.hipL, joints.kneeL, joints.ankleL) <= 20 + 1e-6)
  }
  assert.equal(metrics.kneeLimitViolations(recording, { rig: limited, mannequin }), 0)
})
