import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planGait } from '../src/motion/gait.ts'
import {
  alternationViolations, boneLengthError, footSlidePx, frameHashes, groundPenetrationPx, kneeLimitViolations,
  kneeSpeedDegPerSec, plantedFrames, reachViolations, recordLocomotion, rootSpeedError
} from '../src/motion/metrics.ts'
import type { LocomotionFrame, LocomotionRecording } from '../src/motion/metrics.ts'
import { restPose } from '../src/motion/pose.ts'
import type { Pose } from '../src/motion/pose.ts'
import type { RootState } from '../src/motion/script.ts'
import { assertClose } from './helpers.ts'
import { mannequin, rig, walkTrack } from './locomotion-fixtures.ts'

const geometry = { rig, mannequin }
const rest = restPose(mannequin)
const SCALE = 1.8 / 48

function rootAt (z: number, yaw = 0): RootState {
  return { position: [0, 0, z], yaw, velocity: [0, 0, 0], angularVelocity: 0 }
}

function frame (i: number, joints: Pose, extra: Partial<LocomotionFrame> = {}): LocomotionFrame {
  return { time: i / 24, root: rootAt(0), joints, clamped: 0, planted: { left: false, right: false }, ...extra }
}

function recording (frames: LocomotionFrame[]): LocomotionRecording {
  return { fps: 24, frames }
}

function withFeet (left: number, right: number, dx = 0): Pose {
  const pose = structuredClone(rest)
  pose.ankleL = [0.1 + dx, 0.1 + left, 0]
  pose.toeL = [0.1 + dx, 0.05 + left, 0.15]
  pose.ankleR = [-0.1, 0.1 + right, 0]
  pose.toeR = [-0.1, 0.05 + right, 0.15]
  return pose
}

function pattern (left: string, right: string): LocomotionRecording {
  const frames = [...left].map((l, i) => frame(i, withFeet(l === '1' ? 0 : 0.5, right[i] === '1' ? 0 : 0.5)))
  return recording(frames)
}

test('plantedFrames counts frames whose sole point was low in this and the previous frame, per foot', () => {
  const counts = plantedFrames(pattern('11111', '00000'), geometry)
  assert.deepEqual(counts, { left: 4, right: 0 })
})

test('plantedFrames needs two consecutive low frames', () => {
  assert.deepEqual(plantedFrames(pattern('10101', '01010'), geometry), { left: 0, right: 0 })
})

test('plantedFrames measures at the sole: a raised ankle with the sole within 2 cm counts', () => {
  const frames = [0, 1, 2].map(i => frame(i, withFeet(0.015, 0.5)))
  assert.equal(plantedFrames(recording(frames), geometry).left, 2)
})

test('footSlidePx of a planted foot moving 1 cm per frame is 1 cm over the scale', () => {
  const frames = [0, 1, 2, 3].map(i => frame(i, withFeet(0.015, 0.5, 0.01 * i)))
  assertClose(footSlidePx(recording(frames), geometry, SCALE), 0.01 / SCALE, 1e-9)
})

test('footSlidePx ignores a foot that is off the ground and is zero for a still foot', () => {
  const lifted = [0, 1, 2].map(i => frame(i, withFeet(0.1, 0.5, 0.01 * i)))
  assert.equal(footSlidePx(recording(lifted), geometry, SCALE), 0)
  const still = [0, 1, 2].map(i => frame(i, withFeet(0, 0.5)))
  assert.equal(footSlidePx(recording(still), geometry, SCALE), 0)
})

test('footSlidePx ignores vertical motion', () => {
  const frames = [0, 1, 2].map(i => frame(i, withFeet(0.005 * i, 0.5)))
  assert.equal(footSlidePx(recording(frames), geometry, SCALE), 0)
})

test('groundPenetrationPx is the deepest sole point below y = 0 in pixels', () => {
  const frames = [frame(0, withFeet(0, 0.5)), frame(1, withFeet(-0.01, 0.5)), frame(2, withFeet(-0.003, 0.5))]
  assertClose(groundPenetrationPx(recording(frames), geometry, SCALE), 0.01 / SCALE, 1e-9)
  assert.equal(groundPenetrationPx(recording([frame(0, withFeet(0.001, 0.5))]), geometry, SCALE), 0)
})

test('reachViolations counts frames with a clamped target', () => {
  const frames = [2, 0, 1].map((clamped, i) => frame(i, rest, { clamped }))
  assert.equal(reachViolations(recording(frames)), 2)
})

function legPose (flexion: number, side: 1 | -1 = 1): Pose {
  const pose = structuredClone(rest)
  const a = flexion * Math.PI / 180
  pose.hipL = [0.1, 1, 0]
  pose.kneeL = [0.1, 0.6, 0]
  pose.ankleL = [0.1, 0.6 - 0.4 * Math.cos(a), -0.4 * Math.sin(a) * side]
  return pose
}

test('kneeLimitViolations counts hyperextension-free flexion outside [0, 150] and backward knees', () => {
  const frames = [0, 90, 150, 160, -20].map((f, i) => frame(i, legPose(Math.abs(f), f < 0 ? -1 : 1)))
  assert.equal(kneeLimitViolations(recording(frames), geometry), 2)
})

test('kneeLimitViolations uses the body yaw as forward', () => {
  assert.equal(kneeLimitViolations(recording([frame(0, legPose(60))]), geometry), 0)
  const turned = [frame(0, legPose(60), { root: rootAt(0, Math.PI) })]
  assert.equal(kneeLimitViolations(recording(turned), geometry), 2)
})

test('kneeSpeedDegPerSec is the largest flexion change between consecutive frames times the frame rate', () => {
  const frames = [0, 10, 40, 45].map((f, i) => frame(i, legPose(f)))
  assertClose(kneeSpeedDegPerSec(recording(frames), geometry), 30 * 24, 1e-6)
})

test('boneLengthError is the largest relative change of a bone from the rest pose', () => {
  const stretched = structuredClone(rest)
  stretched.ankleL = [0.1, 0.5 + (0.1 - 0.5) * 1.02, 0.2 + (0 - 0.2) * 1.02]
  stretched.toeL = [0.1, 0.05 + stretched.ankleL[1] - 0.1, 0.15 + stretched.ankleL[2]]
  const frames = [frame(0, rest), frame(1, stretched)]
  assertClose(boneLengthError(recording(frames), geometry, rest), 0.02, 1e-9)
  assert.equal(boneLengthError(recording([frame(0, rest)]), geometry, rest), 0)
})

function moving (speed: number, count: number, fast = speed): LocomotionRecording {
  const frames = []
  let z = 0
  for (let i = 0; i < count; i++) {
    z += (i < 24 ? speed : fast) / 24
    frames.push(frame(i, rest, { root: rootAt(z) }))
  }
  return recording(frames)
}

test('rootSpeedError compares distance per second with the script speed inside steady segments', () => {
  const rec = moving(1.2, 48, 2)
  assertClose(rootSpeedError(rec, [{ start: 0.2, end: 0.9, speed: 1.2 }]), 0, 1e-9)
  assertClose(rootSpeedError(rec, [{ start: 0.2, end: 0.9, speed: 1.1 }]), 0.1 / 1.1, 1e-9)
  const both = [{ start: 0.2, end: 0.9, speed: 1.2 }, { start: 1.2, end: 1.9, speed: 1.6 }]
  assertClose(rootSpeedError(rec, both), 0.25, 1e-9)
})

test('alternationViolations counts the same foot planting twice in a row inside the windows', () => {
  const fine = pattern('11100011100011', '00011100011100')
  assert.equal(alternationViolations(fine, geometry, [{ start: 0, end: 1 }]), 0)
  const bad = pattern('11100011100011', '00000000000000')
  assert.equal(alternationViolations(bad, geometry, [{ start: 0, end: 1 }]), 2)
})

test('alternationViolations ignores plants outside the windows', () => {
  const bad = pattern('11100011100011', '00000000000000')
  assert.equal(alternationViolations(bad, geometry, [{ start: 0, end: 0.2 }]), 0)
})

test('frameHashes give one stable hash per frame that changes with any joint', () => {
  const a = recording([frame(0, rest), frame(1, rest)])
  const b = recording([frame(0, structuredClone(rest)), frame(1, withFeet(0.1, 0))])
  const hashes = frameHashes(a)
  assert.equal(hashes.length, 2)
  assert.deepEqual(frameHashes(b)[0], hashes[0])
  assert.notEqual(frameHashes(b)[1], hashes[1])
  assert.deepEqual(frameHashes(a), hashes)
})

test('recordLocomotion stores world-space joints, clamp counts and planner planted flags', () => {
  const frames = planGait({ track: walkTrack(1.2, 4), rig, rest, mannequin, duration: 2, fps: 24 })
  const rec = recordLocomotion(frames, { rig, rest, mannequin, fps: 24 })
  assert.equal(rec.frames.length, frames.length)
  assert.equal(rec.fps, 24)
  assertClose(rec.frames[10].time, 10 / 24)
  assertClose(rec.frames[10].joints.chest[2], frames[10].root.position[2] + rest.chest[2], 1e-9)
  assertClose(rec.frames[10].joints.chest[1], rest.chest[1] + frames[10].pelvisOffset[1], 1e-9)
  assert.equal(rec.frames[10].planted.left, frames[10].feet[0].planted)
  assert.equal(rec.frames[10].clamped, 0)
})
