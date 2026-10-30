import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Rig } from '../src/formats/rig.ts'
import { planGait } from '../src/motion/gait.ts'
import * as metrics from '../src/motion/metrics.ts'
import type { LocomotionRecording } from '../src/motion/metrics.ts'
import { armLabels, restPose } from '../src/motion/pose.ts'
import { assertClose } from './helpers.ts'
import { hexMannequin as mannequin, hexRig } from './hexapod-fixtures.ts'
import { walkTrack } from './locomotion-fixtures.ts'

const FPS = 24
const rest = restPose(mannequin)

function walk (rig: Rig): LocomotionRecording {
  const frames = planGait({ track: walkTrack(0.5, 5), rig, rest, mannequin, duration: 7, fps: FPS })
  return metrics.recordLocomotion(frames, { rig, rest, mannequin, fps: FPS })
}

test('convexHull drops inner and collinear points and keeps counter-clockwise order', () => {
  const hull = metrics.convexHull([[0, 0], [2, 0], [1, 0], [2, 2], [0, 2], [1, 1]])
  assert.deepEqual(hull, [[0, 0], [2, 0], [2, 2], [0, 2]])
  assert.deepEqual(metrics.convexHull([[0, 0], [1, 1], [2, 2]]), [[0, 0], [2, 2]])
})

test('hullDistance is negative inside, positive outside, and a segment or point has no inside', () => {
  const square = metrics.convexHull([[0, 0], [2, 0], [2, 2], [0, 2]])
  assertClose(metrics.hullDistance([1, 0.5], square), -0.5)
  assertClose(metrics.hullDistance([3, 1], square), 1)
  assertClose(metrics.hullDistance([3, 3], square), Math.SQRT2)
  assertClose(metrics.hullDistance([1, 1], [[0, 0], [2, 0]]), 1)
  assertClose(metrics.hullDistance([1, 0], [[0, 0], [2, 0]]), 0)
  assertClose(metrics.hullDistance([3, 4], [[0, 0]]), 5)
})

test('the hexapod tripod at stanceFraction 0.6 stays balanced; its worst frame is on the hull edge', () => {
  const geometry = { rig: hexRig, mannequin }
  const recording = walk(hexRig)
  assert.equal(metrics.unbalancedFrames(recording, geometry), 0)
  const distances = metrics.balanceDistances(recording, geometry)
  assert.ok(distances.every(d => d !== undefined))
  const worst = Math.max(...distances.map(d => d ?? -Infinity))
  assert.ok(worst <= 0.005, `worst ${worst} m outside`)
  const longer = { ...hexRig, gait: { ...hexRig.gait, stanceFraction: 0.7 } }
  assert.ok(Math.max(...metrics.balanceDistances(walk(longer), geometry).map(d => d ?? -Infinity)) < -0.02)
})

test('control: lifting a whole side together tips the hexapod over', () => {
  const sides = {
    ...hexRig,
    limbs: hexRig.limbs.map(limb => limb.kind === 'leg' ? { ...limb, phase: limb.side === 'left' ? 0 : 0.5 } : limb)
  }
  const unbalanced = metrics.unbalancedFrames(walk(sides), { rig: sides, mannequin })
  assert.ok(unbalanced > 20, `unbalanced frames: ${unbalanced}`)
})

test('bodyCentre weights pelvis-group parts by volume and falls back to the joint mean', () => {
  const geometry = { rig: hexRig, mannequin }
  assertClose(metrics.bodyCentre(rest, geometry)[1], (rest.pelvis[2] + rest.chest[2]) / 2)
  const big = { ...mannequin, parts: [
    ...mannequin.parts,
    { name: 'belly', shape: 'capsule' as const, a: 'pelvis', b: 'pelvis', radiusA: 0.2, radiusB: 0.2, material: 'm' },
    { name: 'neck', shape: 'capsule' as const, a: 'chest', b: 'chest', radiusA: 0.1, radiusB: 0.1, material: 'm' }
  ] }
  assertClose(metrics.bodyCentre(rest, { rig: hexRig, mannequin: big })[1], rest.chest[2] / 9)
})

test('appendage metrics catch a stretched bone and a non-finite joint', () => {
  const geometry = { rig: hexRig, mannequin }
  const recording = walk(hexRig)
  assert.ok(metrics.appendageBoneLengthError(recording, geometry, rest) < 1e-9)
  assert.equal(metrics.appendageNonFinite(recording, geometry), 0)
  recording.frames[5].joints.tail3 = [0, 0, 0]
  recording.frames[6].joints.tail2 = [NaN, 0, 0]
  assert.ok(metrics.appendageBoneLengthError(recording, geometry, rest) > 0.5)
  assert.equal(metrics.appendageBoneLengthError(recording, geometry, rest), Infinity)
  assert.equal(metrics.appendageNonFinite(recording, geometry), 1)
})

test('arm labels name the side, and number arms front to back when a side has several', () => {
  assert.deepEqual(armLabels(hexRig, rest), ['left arm', 'right arm'])
  const extra = { kind: 'arm' as const, name: 'armL2', joints: ['hipLM', 'kneeLM'], side: 'left' as const }
  assert.deepEqual(armLabels({ ...hexRig, limbs: [...hexRig.limbs, extra] }, rest), [
    'left arm 1', 'right arm', 'left arm 2'
  ])
})
