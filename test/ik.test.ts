import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kneeBendsBackward, kneeFlexionDegrees, twoBoneIk } from '../src/motion/ik.ts'
import { posedMannequin, restPose } from '../src/motion/pose.ts'
import { validateMannequin } from '../src/formats/mannequin.ts'
import { cross, dot, length, sub } from '../src/math/vec.ts'
import type { Vec3 } from '../src/math/vec.ts'
import { assertClose } from './helpers.ts'

const hip: Vec3 = [0, 1, 0]
const pole: Vec3 = [0, 0, 1]

test('preserves bone lengths for reachable targets', () => {
  for (const target of [[0, 0.2, 0.3], [0.2, 0.3, -0.3], [0, 0.35, 0], [0.5, 0.5, 0.1]] as Vec3[]) {
    const r = twoBoneIk({ hip, target, upper: 0.5, lower: 0.45, pole })
    assert.equal(r.clamped, false)
    assertClose(length(sub(r.knee, hip)), 0.5)
    assertClose(length(sub(r.end, r.knee)), 0.45)
    assertClose(length(sub(r.end, target)), 0)
  }
})

test('the knee lies on the pole side', () => {
  const r = twoBoneIk({ hip, target: [0, 0.2, 0], upper: 0.5, lower: 0.5, pole })
  assert.ok(r.knee[2] > 0.1)
  const back = twoBoneIk({ hip, target: [0, 0.2, 0], upper: 0.5, lower: 0.5, pole: [0, 0, -1] })
  assert.ok(back.knee[2] < -0.1)
})

test('the knee stays in the plane of hip, target and pole', () => {
  const target: Vec3 = [0.3, 0.2, 0.1]
  const r = twoBoneIk({ hip, target, upper: 0.5, lower: 0.5, pole })
  assertClose(dot(sub(r.knee, hip), cross(sub(target, hip), pole)), 0)
})

test('clamps and flags an unreachable target', () => {
  const r = twoBoneIk({ hip, target: [0, -3, 0], upper: 0.5, lower: 0.45, pole })
  assert.equal(r.clamped, true)
  assertClose(r.end[1], 1 - 0.95, 2e-6)
  assertClose(r.end[0], 0)
  assertClose(length(sub(r.knee, hip)), 0.5, 1e-6)
})

test('pushes out a target that is too close', () => {
  const r = twoBoneIk({ hip, target: [0, 1, 0.01], upper: 0.5, lower: 0.3, pole })
  assert.equal(r.clamped, true)
  assertClose(length(sub(r.end, hip)), 0.2, 2e-6)
  assertClose(length(sub(r.knee, hip)), 0.5, 1e-6)
})

test('flexion is 0 straight and 90 at a right angle', () => {
  assertClose(kneeFlexionDegrees([0, 1, 0], [0, 0.5, 0], [0, 0, 0]), 0)
  assertClose(kneeFlexionDegrees([0, 1, 0], [0, 0.5, 0], [0.5, 0.5, 0]), 90)
})

test('detects a knee that bends backward', () => {
  assert.equal(kneeBendsBackward([0, 1, 0], [0, 0.5, 0.2], [0, 0, 0], [0, 0, 1]), false)
  assert.equal(kneeBendsBackward([0, 1, 0], [0, 0.5, -0.2], [0, 0, 0], [0, 0, 1]), true)
  assert.equal(kneeBendsBackward([0, 1, 0], [0, 0.5, 0], [0, 0, 0], [0, 0, 1]), false)
})

test('restPose copies joints and posedMannequin replaces them', () => {
  const m = validateMannequin({
    name: 'm',
    height: 2,
    joints: { a: [0, 0, 0], b: [0, 1, 0] },
    parts: [{ name: 'p', shape: 'capsule', a: 'a', b: 'b', radiusA: 0.1, radiusB: 0.1, material: 'x' }]
  }).value!
  const pose = restPose(m)
  assert.deepEqual(pose, m.joints)
  pose.b[1] = 5
  assert.equal(m.joints.b[1], 1)
  const posed = posedMannequin(m, { a: [1, 1, 1], b: [2, 2, 2] })
  assert.deepEqual(posed.joints, { a: [1, 1, 1], b: [2, 2, 2] })
  assert.deepEqual(posed.parts, m.parts)
  assert.deepEqual(m.joints.a, [0, 0, 0])
})
