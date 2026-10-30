import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Mannequin } from '../src/formats/mannequin.ts'
import { planGait } from '../src/motion/gait.ts'
import {
  alternationViolations, boneLengthError, footSlidePx, frameHashes, groundPenetrationPx, kneeLimitViolations,
  kneeSpeedDegPerSec, partGroundPenetrationPx, plantedFrames, plantedRuns, reachViolations, recordLocomotion,
  rootSpeedError, unsupportedFrames
} from '../src/motion/metrics.ts'
import type { LocomotionFrame, LocomotionRecording } from '../src/motion/metrics.ts'
import { legLabels, restPose } from '../src/motion/pose.ts'
import type { Pose } from '../src/motion/pose.ts'
import type { RootState } from '../src/motion/script.ts'
import { assertClose } from './helpers.ts'
import { hexMannequin, hexRig } from './hexapod-fixtures.ts'
import { mannequin, quadMannequin, quadRig, rig, walkTrack } from './locomotion-fixtures.ts'

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

const withParts: Mannequin = {
  ...mannequin,
  parts: [
    ...mannequin.parts,
    { name: 'sword', shape: 'capsule', a: 'handR', b: 'wristR', radiusA: 0.03, radiusB: 0.02, material: 'm' },
    {
      name: 'plate', shape: 'box', a: 'chest', b: 'head', width: 0.2, thickness: 0.1, rounding: 0,
      widthAxis: [1, 0, 0], material: 'm'
    }
  ]
}
const partOptions = { mannequin: withParts, rig, metresPerPixel: SCALE }

test('partGroundPenetrationPx is the deepest capsule end below y = 0, feet ignored', () => {
  const dip = structuredClone(rest)
  dip.handR = [-0.27, 0.02, 0.06]
  dip.ankleL = [0.1, -0.5, 0]
  dip.toeL = [0.1, -0.5, 0.15]
  assertClose(partGroundPenetrationPx(recording([frame(0, rest), frame(1, dip)]), partOptions), 0.01 / SCALE, 1e-9)
  assert.equal(partGroundPenetrationPx(recording([frame(0, rest)]), partOptions), 0)
})

test('partGroundPenetrationPx uses the lowest box corner', () => {
  const low = structuredClone(rest)
  low.chest = [0, -0.01, 0]
  low.head = [0, 0.4, 0]
  assertClose(partGroundPenetrationPx(recording([frame(0, low)]), partOptions), 0.01 / SCALE, 1e-9)
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

const PERIOD = 12
const STANCE = 4

function stepPose (leftZ: number, leftUp: number, rightZ: number, rightUp: number): Pose {
  const pose = structuredClone(rest)
  pose.ankleL = [0.1, 0.1 + leftUp, leftZ]
  pose.toeL = [0.1, 0.05 + leftUp, leftZ + 0.15]
  pose.ankleR = [-0.1, 0.1 + rightUp, rightZ]
  pose.toeR = [-0.1, 0.05 + rightUp, rightZ + 0.15]
  return pose
}

function stepping (step: number, rootSpeed: number, count = 48): LocomotionRecording {
  const frames = Array.from({ length: count }, (_, i) => {
    const left = Math.floor(i / PERIOD)
    const right = Math.floor((i + PERIOD / 2) / PERIOD)
    const leftUp = i % PERIOD < STANCE ? 0 : 0.3
    const rightUp = (i + PERIOD / 2) % PERIOD < STANCE ? 0 : 0.3
    return frame(i, stepPose(left * step, leftUp, right * step, rightUp), { root: rootAt(rootSpeed * i / 24) })
  })
  return recording(frames)
}

const WINDOW = [{ start: 0, end: 2, speed: 1.2 }]

test('rootSpeedError is the advance of the planted feet per second against the script speed', () => {
  assertClose(rootSpeedError(stepping(0.6, 1.2), geometry, WINDOW), 0, 1e-9)
  assertClose(rootSpeedError(stepping(0.5, 1.2), geometry, WINDOW), 0.2 / 1.2, 1e-9)
  assertClose(rootSpeedError(stepping(0.6, 1.2), geometry, [{ start: 0, end: 2, speed: 1 }]), 0.2, 1e-9)
})

test('rootSpeedError does not trust the root: feet that stay put while the root moves are an error of 1', () => {
  assertClose(rootSpeedError(stepping(0, 1.2), geometry, WINDOW), 1, 1e-9)
})

test('rootSpeedError is infinite when a window has no two plants of a foot', () => {
  assert.equal(rootSpeedError(stepping(0.6, 1.2, 10), geometry, WINDOW), Infinity)
})

test('unsupportedFrames counts frames where no sole point of either foot is within 2 cm of the ground', () => {
  assert.equal(unsupportedFrames(pattern('11000', '00110'), geometry), 1)
  assert.equal(unsupportedFrames(pattern('11000', '00000'), geometry), 3)
  assert.equal(unsupportedFrames(pattern('10101', '01010'), geometry), 0)
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

const quadGeometry = { rig: quadRig, mannequin: quadMannequin }
const quadRest = restPose(quadMannequin)
const QUAD_NAMES = ['LH', 'LF', 'RH', 'RF']

function quadFeet (lifts: number[]): Pose {
  const pose = structuredClone(quadRest)
  QUAD_NAMES.forEach((name, i) => {
    pose[`ankle${name}`][1] += lifts[i]
    pose[`toe${name}`][1] += lifts[i]
  })
  return pose
}

function quadPattern (rows: string[]): LocomotionRecording {
  const frames = [...rows[0]].map((_, i) => frame(i, quadFeet(rows.map(row => row[i] === '1' ? 0 : 0.5))))
  return recording(frames)
}

test('legLabels name two legs by side and four legs by side and front or hind', () => {
  assert.deepEqual(legLabels(rig, rest), ['left', 'right'])
  assert.deepEqual(legLabels(quadRig, quadRest), ['left hind', 'left front', 'right hind', 'right front'])
  const [lh, lf, rh, rf] = quadRig.limbs
  const shuffled = { ...quadRig, limbs: [rf, lh, lf, rh] }
  assert.deepEqual(legLabels(shuffled, quadRest), ['right front', 'left hind', 'left front', 'right hind'])
})

test('legLabels number three or more legs per side from front to back, whatever the file order', () => {
  const hexRest = restPose(hexMannequin)
  assert.deepEqual(legLabels(hexRig, hexRest), ['left 1', 'left 2', 'left 3', 'right 1', 'right 2', 'right 3'])
  const [lf, lm, lh, rf, rm, rh] = hexRig.limbs
  const shuffled = { ...hexRig, limbs: [rh, lf, rf, lh, lm, rm] }
  assert.deepEqual(legLabels(shuffled, hexRest), ['right 3', 'left 1', 'right 1', 'left 3', 'left 2', 'right 2'])
})

test('plantedFrames keys and gate names use the leg labels of a hexapod', () => {
  const hexFrames = planGait({
    track: walkTrack(0.5, 3), rig: hexRig, rest: restPose(hexMannequin), mannequin: hexMannequin, duration: 4, fps: 24
  })
  const walked = recordLocomotion(hexFrames, {
    rig: hexRig, rest: restPose(hexMannequin), mannequin: hexMannequin, fps: 24
  })
  const expected = ['left 1', 'left 2', 'left 3', 'right 1', 'right 2', 'right 3']
  assert.deepEqual(Object.keys(plantedFrames(walked, { rig: hexRig, mannequin: hexMannequin })), expected)
  assert.deepEqual(Object.keys(walked.frames[10].planted), expected)
})

test('plantedFrames counts per leg label for four legs', () => {
  const counts = plantedFrames(quadPattern(['11111', '10000', '11000', '00000']), quadGeometry)
  assert.deepEqual(counts, { 'left hind': 4, 'left front': 0, 'right hind': 1, 'right front': 0 })
})

test('plantedRuns carry the leg index', () => {
  const runs = plantedRuns(quadPattern(['11100', '00111', '00000', '11111']), quadGeometry)
  assert.deepEqual(runs.map(r => [r.leg, r.start, r.end]), [[0, 1, 2], [3, 1, 4], [1, 3, 4]])
})

test('footSlidePx, groundPenetrationPx and unsupportedFrames see all four feet', () => {
  const slide = [0, 1, 2].map(i => {
    const pose = quadFeet([0.5, 0.5, 0, 0.5])
    pose.ankleRH[0] += 0.01 * i
    pose.toeRH[0] += 0.01 * i
    return frame(i, pose)
  })
  assertClose(footSlidePx(recording(slide), quadGeometry, SCALE), 0.01 / SCALE, 1e-9)
  const sunk = quadFeet([0, 0, 0, -0.01])
  assertClose(groundPenetrationPx(recording([frame(0, sunk)]), quadGeometry, SCALE), 0.01 / SCALE, 1e-9)
  assert.equal(unsupportedFrames(quadPattern(['110', '000', '000', '011']), quadGeometry), 0)
  assert.equal(unsupportedFrames(quadPattern(['1000', '0000', '0000', '0001']), quadGeometry), 2)
})

test('alternationViolations follows the phase order of four legs', () => {
  const order = quadPattern(['11000000', '00110000', '00001100', '00000011'])
  assert.equal(alternationViolations(order, quadGeometry, [{ start: 0, end: 1 }]), 0)
})

test('alternationViolations counts a leg planting out of phase order and a leg repeating', () => {
  const swapped = quadPattern(['110000000000', '000011000000', '001100000000', '000000110000'])
  assert.equal(alternationViolations(swapped, quadGeometry, [{ start: 0, end: 1 }]), 3)
  const repeated = quadPattern(['110011000000', '000000110000', '000000001100', '000000000011'])
  assert.equal(alternationViolations(repeated, quadGeometry, [{ start: 0, end: 1 }]), 1)
})

test('alternationViolations honours explicit phases on two legs', () => {
  const [left, right, ...others] = rig.limbs
  const swappedRig = { ...rig, limbs: [{ ...left, phase: 0.5 }, { ...right, phase: 0 }, ...others] }
  const fine = pattern('11100011100011', '00011100011100')
  assert.equal(alternationViolations(fine, { rig: swappedRig, mannequin }, [{ start: 0, end: 1 }]), 0)
})

test('kneeLimitViolations uses each leg bend as its forward', () => {
  const rec = recording([frame(0, quadRest)])
  assert.equal(kneeLimitViolations(rec, quadGeometry), 0)
  const wrong = { ...quadRig, limbs: quadRig.limbs.map(leg => ({ ...leg, bend: 'forward' as const })) }
  assert.equal(kneeLimitViolations(rec, { rig: wrong, mannequin: quadMannequin }), 2)
})

test('a recorded quadruped walk has per-leg planted flags and passes the leg metrics', () => {
  const track = walkTrack(0.9, 8)
  const frames = planGait({ track, rig: quadRig, rest: quadRest, mannequin: quadMannequin, duration: 10, fps: 24 })
  const rec = recordLocomotion(frames, { rig: quadRig, rest: quadRest, mannequin: quadMannequin, fps: 24 })
  assert.deepEqual(Object.keys(rec.frames[10].planted), ['left hind', 'left front', 'right hind', 'right front'])
  assert.equal(rec.frames[10].planted['left front'], frames[10].feet[1].planted)
  assert.equal(kneeLimitViolations(rec, quadGeometry), 0)
  assert.equal(reachViolations(rec), 0)
  assert.equal(alternationViolations(rec, quadGeometry, [{ start: 2, end: 7 }]), 0)
  assert.ok(footSlidePx(rec, quadGeometry, 0.8 / 48) < 0.25)
  assert.ok(boneLengthError(rec, quadGeometry, quadRest) < 1e-9)
  assert.ok(rootSpeedError(rec, quadGeometry, [{ start: 2, end: 7, speed: 0.9 }]) < 0.05)
  assert.equal(unsupportedFrames(rec, quadGeometry), 0)
})
