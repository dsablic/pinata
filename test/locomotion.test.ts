import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kneeBendsBackward } from '../src/motion/ik.ts'
import { planGait } from '../src/motion/gait.ts'
import { poseAt } from '../src/motion/locomotion.ts'
import { restPose } from '../src/motion/pose.ts'
import { toWorld } from '../src/sim/body.ts'
import { length, sub } from '../src/math/vec.ts'
import type { Vec3 } from '../src/math/vec.ts'
import { assertClose } from './helpers.ts'
import { mannequin, rig, walkTrack } from './locomotion-fixtures.ts'

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
  const frame = walk.reduce((best, f) => (Math.abs(f.armSwing) > Math.abs(best.armSwing) ? f : best))
  const { pose } = poseAt({ frame, rig, rest, mannequin })
  const left = pose.handL[2] - rest.handL[2]
  const right = pose.handR[2] - rest.handR[2]
  assert.ok(left * right < 0)
  assertClose(pose.chest[1] - rest.chest[1], frame.pelvisOffset[1])
  assertClose(pose.shoulderL[1] - rest.shoulderL[1], frame.pelvisOffset[1])
})
