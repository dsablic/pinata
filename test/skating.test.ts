import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planGait } from '../src/motion/gait.ts'
import {
  footSlidePx, groundPenetrationPx, plantedFrames, reachViolations, recordLocomotion, unsupportedFrames
} from '../src/motion/metrics.ts'
import { restPose } from '../src/motion/pose.ts'
import { planSkating } from '../src/motion/skating.ts'
import { assertClose } from './helpers.ts'
import { mannequin, rig, walkTrack } from './locomotion-fixtures.ts'

const rest = restPose(mannequin)
const SCALE = 1.8 / 48
const options = { track: walkTrack(1.2, 8), rig, rest, mannequin, duration: 6, fps: 24 }
const geometry = { rig, mannequin }

test('the skating control keeps the root, pelvis and arms of the planned gait', () => {
  const planned = planGait(options)
  const skating = planSkating(options)
  assert.equal(skating.length, planned.length)
  skating.forEach((frame, i) => {
    assert.deepEqual(frame.root, planned[i].root)
    assert.deepEqual(frame.pelvisOffset, planned[i].pelvisOffset)
    assert.equal(frame.armSwing, planned[i].armSwing)
  })
})

test('the skating control swings each ankle about its rest position under the hip', () => {
  const [first, second] = planSkating(options)
  const stride = rig.gait.strideLength
  const ankle = first.feet.find(f => f.side === 'left')!.ankle
  assertClose(ankle[0], rest.ankleL[0], 1e-9)
  assert.ok(Math.abs(ankle[2] - rest.ankleL[2]) <= stride / 4 + 1e-9)
  assert.ok(second.feet.every(f => !f.planted))
})

test('the skating control lifts a foot only while it moves forward relative to the body', () => {
  const frames = planSkating(options)
  frames.forEach(frame => {
    for (const foot of frame.feet) {
      const phase = frame.phase + (foot.side === 'left' ? 0 : 0.5) + 0.25
      assertClose(foot.lift, Math.max(0, Math.cos(2 * Math.PI * phase)), 1e-12)
    }
  })
  assert.ok(frames.some(f => f.feet.some(foot => foot.lift === 0)))
  assert.ok(frames.some(f => f.feet.some(foot => foot.lift > 0.9)))
})

test('the skating control slides more than 1 px per frame on a steady walk, ours does not', () => {
  const steady = (frames: ReturnType<typeof planGait>) => {
    return recordLocomotion(frames.slice(24, 120), { rig, rest, mannequin, fps: 24 })
  }
  const control = steady(planSkating(options))
  const ours = steady(planGait(options))
  const slide = footSlidePx(control, geometry, SCALE)
  assert.ok(slide > 1, `control slid ${slide} px per frame`)
  assert.ok(plantedFrames(control, geometry).left > 0)
  assert.ok(footSlidePx(ours, geometry, SCALE) < 0.25)
  assert.ok(groundPenetrationPx(control, geometry, SCALE) < 0.5)
  assert.equal(reachViolations(control), 0)
  assert.equal(unsupportedFrames(control, geometry), 0)
})
