import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AppendageLimb, Rig } from '../src/formats/rig.ts'
import { animateAppendages } from '../src/motion/appendages.ts'
import type { GaitFrame } from '../src/motion/gait.ts'
import { kneeFlexionDegrees } from '../src/motion/ik.ts'
import { length, sub } from '../src/math/vec.ts'
import type { Vec3 } from '../src/math/vec.ts'
import { restPose } from '../src/motion/pose.ts'
import type { Pose } from '../src/motion/pose.ts'
import { hexMannequin as mannequin, hexRig } from './hexapod-fixtures.ts'

const FPS = 24
const SUBSTEPS = 8
const rest = restPose(mannequin)
const TAIL = ['tail1', 'tail2', 'tail3']

function rigWith (tail: Partial<AppendageLimb>): Rig {
  const limb: AppendageLimb = { kind: 'appendage', name: 'tail', joints: TAIL, stiffness: 0.6, damping: 0.4, ...tail }
  return { ...hexRig, limbs: [limb] }
}

function frames (seconds: number, position: (t: number) => Vec3, yaw: (t: number) => number = () => 0): GaitFrame[] {
  return Array.from({ length: Math.round(seconds * FPS) + 1 }, (_, i) => {
    const t = i / FPS
    const velocity: Vec3 = sub(position(t + 1e-3), position(t)).map(v => v / 1e-3) as Vec3
    const angularVelocity = (yaw(t + 1e-3) - yaw(t)) / 1e-3
    return {
      root: { position: position(t), yaw: yaw(t), velocity, angularVelocity },
      pelvisOffset: [0, 0, 0],
      feet: [],
      armSwings: [],
      phase: 0
    }
  })
}

function animate (rig: Rig, gait: GaitFrame[], from: Pose = rest): Pose[] {
  const poses = gait.map(() => ({ ...from }))
  const transforms = gait.map(() => ({ pelvis: { translation: [0, 0, 0] as Vec3 } }))
  animateAppendages({ frames: gait, poses, transforms }, { rig, rest: from, fps: FPS, substeps: SUBSTEPS })
  return poses
}

function bend (pose: Pose): number {
  return kneeFlexionDegrees(pose.tail1, pose.tail2, pose.tail3)
}

function deviation (pose: Pose): number {
  return Math.max(...TAIL.map(name => length(sub(pose[name], rest[name]))))
}

function accelerateSideways (t: number): Vec3 {
  const ramp = 0.5
  return [t < ramp ? t * t / (2 * ramp) : ramp / 2 + (t - ramp), 0, 0]
}

test('a still body leaves the tail at rest', () => {
  for (const pose of animate(rigWith({}), frames(2, () => [0.3, 0, -0.2]))) assert.ok(deviation(pose) < 1e-12)
})

test('the tail lags behind a body that speeds up, then settles back to rest', () => {
  const poses = animate(rigWith({}), frames(4, accelerateSideways))
  const early = Math.max(...poses.slice(0, 12).map(deviation))
  assert.ok(early > 0.01, `deviation while speeding up: ${early}`)
  assert.ok(poses[6].tail3[0] < rest.tail3[0], 'the tip trails behind the body')
  assert.ok(deviation(poses[poses.length - 1]) < 1e-3)
})

test('a softer tail swings further, and stiffness 1 is rigid', () => {
  const peak = (stiffness: number): number => Math.max(...animate(rigWith({ stiffness }), frames(2, accelerateSideways))
    .map(deviation))
  assert.ok(peak(0.2) > peak(0.8))
  assert.ok(peak(1) < 1e-12)
})

test('every tail bone keeps its length within 1e-9 through a turn, and the run is deterministic', () => {
  const gait = frames(4, t => [Math.sin(t), 0.02 * Math.sin(9 * t), t], t => 1.5 * Math.sin(2 * t))
  const poses = animate(rigWith({ stiffness: 0.1, damping: 0.05 }), gait)
  for (const pose of poses) {
    for (let j = 1; j < TAIL.length; j++) {
      const expected = length(sub(rest[TAIL[j]], rest[TAIL[j - 1]]))
      assert.ok(Math.abs(length(sub(pose[TAIL[j]], pose[TAIL[j - 1]])) - expected) < 1e-9)
    }
    assert.ok(TAIL.every(name => pose[name].every(Number.isFinite)))
  }
  assert.deepEqual(animate(rigWith({ stiffness: 0.1, damping: 0.05 }), gait), poses)
})

test('the oscillator swings the first segment by degrees at the period and the rest of the tail follows', () => {
  const rig = rigWith({ stiffness: 1, oscillate: { axis: [0, 1, 0], degrees: 30, period: 1, phase: 0 } })
  const poses = animate(rig, frames(1, () => [0, 0, 0]))
  const yawOf = (pose: Pose): number => {
    const d = sub(pose.tail2, pose.tail1)
    return Math.atan2(d[0], -d[2]) * 180 / Math.PI
  }
  assert.ok(Math.abs(Math.abs(yawOf(poses[6])) - 30) < 1e-6, `quarter period: ${yawOf(poses[6])}`)
  assert.ok(Math.abs(yawOf(poses[12])) < 1e-6)
  assert.ok(Math.abs(yawOf(poses[24])) < 1e-6)
  assert.ok(Math.abs(bend(poses[6]) - bend(rest)) < 1e-6)
})

test('a rig without appendages returns the poses untouched', () => {
  const poses = [{ ...rest }]
  const before = structuredClone(poses)
  animateAppendages({ frames: frames(0, () => [0, 0, 0]), poses, transforms: [{}] }, {
    rig: { ...hexRig, limbs: [] }, rest, fps: FPS, substeps: SUBSTEPS
  })
  assert.deepEqual(poses, before)
})

test('a rigid drooping tail wagged about the vertical turns as one piece', () => {
  const drooping: Pose = { ...rest, tail1: [0, 0.5, -0.2], tail2: [0, 0.4, -0.28], tail3: [0, 0.4, -0.4] }
  const rig = rigWith({ stiffness: 1, oscillate: { axis: [0, 1, 0], degrees: 60, period: 1, phase: 0 } })
  const poses = animate(rig, frames(1, () => [0, 0, 0]), drooping)
  const angle = Math.PI / 3
  const turned = (p: Vec3): Vec3 => {
    const [x, y, z] = sub(p, drooping.tail1)
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    return [drooping.tail1[0] + x * c + z * s, drooping.tail1[1] + y, drooping.tail1[2] - x * s + z * c]
  }
  for (const name of TAIL) {
    const expected = turned(drooping[name])
    assert.ok(length(sub(poses[6][name], expected)) < 1e-9, `${name}: ${poses[6][name]} vs ${expected}`)
  }
})

test('a soft tail through a half turn in one second keeps its bend changing smoothly', () => {
  const poses = animate(rigWith({ stiffness: 0.2, damping: 0.4 }), frames(3, () => [0, 0, 0], t => {
    return Math.PI * Math.min(1, t)
  }))
  const bends = poses.map(bend)
  const jumps = bends.slice(1).map((b, i) => Math.abs(b - bends[i]))
  assert.ok(Math.max(...jumps) < 25, `largest bend change per frame: ${Math.max(...jumps)}`)
})

test('a body that starts mid-turn starts the tail moving with it', () => {
  const poses = animate(rigWith({}), frames(0.5, () => [0, 0, 0], t => 2 * t))
  assert.ok(Math.max(...poses.slice(0, 8).map(deviation)) < 0.01)
})
