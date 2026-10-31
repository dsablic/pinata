import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chainIk, kneeBendsBackward, kneeFlexionDegrees, twoBoneIk } from '../src/motion/ik.ts'
import { length, sub } from '../src/math/vec.ts'
import type { Vec3 } from '../src/math/vec.ts'
import { assertClose } from './helpers.ts'

const LENGTHS = [0.4, 0.35, 0.3, 0.25]
const pole: Vec3 = [0, 0, 1]

function hanging (lengths: number[]): Vec3[] {
  const joints: Vec3[] = [[0, 1.5, 0]]
  for (const l of lengths) joints.push([0, joints[joints.length - 1][1] - l, 0])
  return joints
}

const rest = hanging(LENGTHS)
const TARGETS: Vec3[] = [
  [0, 0.5, 0.2], [0.2, 0.6, -0.3], [0.1, 0.3, 0.4], [0, 0.45, 0], [-0.3, 0.8, 0.1], [0, 0.3, 0.05]
]

function bonesOf (joints: Vec3[]): number[] {
  return joints.slice(1).map((joint, i) => length(sub(joint, joints[i])))
}

test('two bones give exactly the analytic result', () => {
  const joints = hanging([0.5, 0.45])
  const target: Vec3 = [0.1, 0.5, 0.2]
  const chain = chainIk({ joints, target, pole })
  const analytic = twoBoneIk({ hip: joints[0], target, upper: 0.5, lower: 0.45, pole })
  assert.deepEqual(chain.joints, [joints[0], analytic.knee, analytic.end])
  assert.equal(chain.clamped, analytic.clamped)
})

test('two bones bending away from the pole mirror the analytic result', () => {
  const joints = hanging([0.5, 0.45])
  const chain = chainIk({ joints, target: [0, 0.5, 0], pole, bends: [-1] })
  const analytic = twoBoneIk({ hip: joints[0], target: [0, 0.5, 0], upper: 0.5, lower: 0.45, pole: [0, 0, -1] })
  assert.deepEqual(chain.joints[1], analytic.knee)
})

test('segment lengths are preserved and reachable targets reached', () => {
  for (const target of TARGETS) {
    const result = chainIk({ joints: rest, target, pole })
    assert.equal(result.clamped, false)
    assert.equal(result.joints.length, rest.length)
    assert.deepEqual(result.joints[0], rest[0])
    bonesOf(result.joints).forEach((l, i) => assertClose(l, LENGTHS[i], 1e-9))
    assertClose(length(sub(result.joints[4], target)), 0, 1e-4)
  }
})

test('every intermediate joint bends toward the pole by default', () => {
  for (const target of TARGETS) {
    const { joints } = chainIk({ joints: rest, target, pole })
    for (let i = 1; i < joints.length - 1; i++) {
      const backward = kneeBendsBackward(joints[i - 1], joints[i], joints[i + 1], pole)
      assert.equal(backward, false, `target ${target} joint ${i}`)
    }
  }
})

test('a joint with a negative bend sits on the other side', () => {
  const target: Vec3 = [0, 0.5, 0]
  const { joints } = chainIk({ joints: rest, target, pole, bends: [1, -1, 1] })
  assert.ok(joints[1][2] > 0.01)
  assert.ok(joints[2][2] < joints[1][2])
  assert.equal(kneeBendsBackward(joints[1], joints[2], joints[3], [0, 0, -1]), false)
})

test('the bend side follows the pole', () => {
  const { joints } = chainIk({ joints: rest, target: [0, 0.5, 0], pole: [0, 0, -1] })
  assert.ok(joints[1][2] < -0.01)
  const other = chainIk({ joints: rest, target: [0, 0.5, 0], pole: [1, 0, 0] })
  assert.ok(other.joints[1][0] > 0.01)
})

test('flexion limits are respected', () => {
  const limits = { min: 0, max: 60 }
  for (const target of [[0, 0.7, 0.1], [0.1, 0.6, 0.3], [0, 0.9, 0]] as Vec3[]) {
    const { joints } = chainIk({ joints: rest, target, pole, limits })
    for (let i = 1; i < joints.length - 1; i++) {
      const flexion = kneeFlexionDegrees(joints[i - 1], joints[i], joints[i + 1])
      assert.ok(flexion <= limits.max + 1e-6, `joint ${i} flexion ${flexion}`)
    }
    bonesOf(joints).forEach((l, i) => assertClose(l, LENGTHS[i], 1e-9))
  }
})

test('limits can be given for each joint', () => {
  const limits = [{ min: 0, max: 20 }, { min: 0, max: 150 }, { min: 0, max: 150 }]
  const { joints } = chainIk({ joints: rest, target: [0, 0.4, 0.2], pole, limits })
  assert.ok(kneeFlexionDegrees(joints[0], joints[1], joints[2]) <= 20 + 1e-6)
})

test('an unreachable target is clamped to the full stretch and flagged', () => {
  const result = chainIk({ joints: rest, target: [0, -3, 0], pole })
  assert.equal(result.clamped, true)
  assertClose(length(sub(result.joints[4], rest[0])), 1.3, 1e-5)
  assertClose(result.joints[4][0], 0, 1e-6)
  bonesOf(result.joints).forEach((l, i) => assertClose(l, LENGTHS[i], 1e-9))
})

test('a target that is too close is pushed out and flagged', () => {
  const joints = hanging([0.9, 0.1, 0.1, 0.1])
  const result = chainIk({ joints, target: [0, 1.49, 0], pole })
  assert.equal(result.clamped, true)
  bonesOf(result.joints).forEach((l, i) => assertClose(l, [0.9, 0.1, 0.1, 0.1][i], 1e-9))
})

test('a target at the root still gives a valid chain', () => {
  const result = chainIk({ joints: hanging([0.3, 0.3, 0.3]), target: [0, 1.5, 0], pole })
  for (const joint of result.joints) assert.ok(joint.every(Number.isFinite))
})

test('the root can be moved without changing the shape lengths', () => {
  const root: Vec3 = [0, 1.45, 0]
  const result = chainIk({ joints: rest, root, target: [0, 0.5, 0.2], pole })
  assert.deepEqual(result.joints[0], root)
  bonesOf(result.joints).forEach((l, i) => assertClose(l, LENGTHS[i], 1e-9))
})

test('a target at the rest end of a bent chain gives back the rest shape', () => {
  const bent: Vec3[] = [[0, 1, 0], [0, 0.75, 0.12], [0, 0.6, -0.05], [0, 0.5, 0.05], [0, 0.4, 0.05]]
  const result = chainIk({ joints: bent, target: bent[4], pole, bends: [1, -1, 1] })
  bent.forEach((joint, i) => {
    for (let k = 0; k < 3; k++) assertClose(result.joints[i][k], joint[k], 1e-9)
  })
})

function missOf (joints: Vec3[], target: Vec3): number {
  return length(sub(joints[joints.length - 1], target))
}

function twoBoneFlexion (joints: Vec3[]): number {
  return kneeFlexionDegrees(joints[0], joints[1], joints[2])
}

test('missed is the distance from the end to the target after the solve', () => {
  for (const target of TARGETS) {
    const result = chainIk({ joints: rest, target, pole })
    assert.ok(result.missed < 1e-4)
  }
  const far = chainIk({ joints: rest, target: [0, -3, 0], pole })
  assertClose(far.missed, missOf(far.joints, [0, -3, 0]), 1e-12)
  assert.ok(far.missed > 1.5)
  const two = chainIk({ joints: hanging([0.5, 0.45]), target: [0, -3, 0], pole })
  assertClose(two.missed, 4.5 - 0.95, 1e-5)
})

test('missed reports targets that joint limits make unreachable', () => {
  const cases: Array<[Vec3, { min: number, max: number }]> = [
    [[0, 1.35, 0.3], { min: 0, max: 60 }],
    [[0, 1.48, 0], { min: 0, max: 150 }],
    [[0, 0.6, 0.3], { min: -30, max: 30 }],
    [[0, 0.25, 0], { min: 20, max: 150 }]
  ]
  for (const [target, limits] of cases) {
    const result = chainIk({ joints: rest, target, pole, limits })
    assert.ok(result.missed > 0.01, `target ${target} missed ${result.missed}`)
    assertClose(result.missed, missOf(result.joints, target), 1e-12)
  }
})

test('zero-length bones throw a clear error', () => {
  const doubled: Vec3[] = [[0, 1.5, 0], [0, 1.1, 0], [0, 1.1, 0], [0, 0.8, 0], [0, 0.55, 0]]
  const solve = (joints: Vec3[], target: Vec3) => () => chainIk({ joints, target, pole })
  assert.throws(solve(doubled, [0, 0.8, 0.2]), /zero-length bone between joints 1 and 2/)
  const first: Vec3[] = [[0, 1.5, 0], [0, 1.5, 0], [0, 1.1, 0]]
  assert.throws(solve(first, [0, 1.2, 0.1]), /zero-length bone between joints 0 and 1/)
  const flat: Vec3[] = [[0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]]
  assert.throws(solve(flat, [0, 0.5, 0]), /zero-length bone/)
})

test('limits on two bones clamp the knee flexion and report the miss', () => {
  const joints = hanging([0.5, 0.45])
  const target: Vec3 = [0, 0.8, 0.1]
  const free = chainIk({ joints, target, pole })
  assert.ok(twoBoneFlexion(free.joints) > 60)
  assert.ok(free.missed < 1e-9)
  const limited = chainIk({ joints, target, pole, limits: { min: 0, max: 30 } })
  const flexion = twoBoneFlexion(limited.joints)
  assertClose(flexion, 30, 1e-6)
  assert.equal(limited.clamped, true)
  assertClose(limited.missed, missOf(limited.joints, target), 1e-12)
  assert.ok(limited.missed > 0.1)
  bonesOf(limited.joints).forEach((l, i) => assertClose(l, [0.5, 0.45][i], 1e-9))
})

test('a minimum flexion on two bones holds the knee bent at full reach', () => {
  const joints = hanging([0.5, 0.45])
  const result = chainIk({ joints, target: [0, 0.56, 0], pole, limits: { min: 20, max: 150 } })
  assertClose(twoBoneFlexion(result.joints), 20, 1e-6)
  assert.ok(result.missed > 0.001)
})

test('limits that are all negative put the two-bone knee on the other side', () => {
  const joints = hanging([0.5, 0.45])
  const result = chainIk({ joints, target: [0, 0.8, 0], pole, limits: { min: -90, max: -20 } })
  assert.ok(result.joints[1][2] < 0)
  const flexion = twoBoneFlexion(result.joints)
  assert.ok(flexion >= 20 - 1e-6 && flexion <= 90 + 1e-6)
})
