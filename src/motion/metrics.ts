import { createHash } from 'node:crypto'
import type { Mannequin, Part } from '../formats/mannequin.ts'
import { armsOf, legPhases, legsOf } from '../formats/rig.ts'
import type { Bend, Leg, Rig } from '../formats/rig.ts'
import { length, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { toWorld } from '../sim/body.ts'
import type { GaitFrame } from './gait.ts'
import { kneeBendsBackward, kneeFlexionDegrees, MAX_FLEXION_DEGREES } from './ik.ts'
import { verticalExtent } from './extent.ts'
import { poseAt } from './locomotion.ts'
import { bendingJoints, footRadii, legLabels, restPose } from './pose.ts'
import type { JointTriple } from './pose.ts'
import type { Pose } from './pose.ts'
import type { RootState, Script } from './script.ts'

type Side = 'left' | 'right'

export type LocomotionFrame = {
  time: number
  root: RootState
  joints: Pose
  clamped: number
  planted: Record<string, boolean>
}
export type LocomotionRecording = { fps: number, frames: LocomotionFrame[] }
export type Geometry = { rig: Rig, mannequin: Mannequin }
export type Window = { start: number, end: number }
export type SteadySegment = Window & { speed: number }
export type PlantedRun = { leg: number, side: Side, start: number, end: number }

const PLANT_HEIGHT = 0.02
export const MAX_KNEE_FLEXION = MAX_FLEXION_DEGREES
const FLEXION_EPSILON = 1e-6
const TIME_EPSILON = 1e-9

export function recordLocomotion (
  frames: GaitFrame[],
  options: { rig: Rig, rest: Pose, mannequin: Mannequin, fps: number }
): LocomotionRecording {
  const { rig, rest, mannequin, fps } = options
  const labels = legLabels(rig, rest)
  return {
    fps,
    frames: frames.map((frame, i) => {
      const { pose, clamped } = poseAt({ frame, rig, rest, mannequin })
      const joints: Pose = {}
      for (const [name, local] of Object.entries(pose)) joints[name] = toWorld(local, frame.root)
      const planted = Object.fromEntries(labels.map((label, k) => [label, frame.feet[k]?.planted ?? false]))
      return { time: i / fps, root: frame.root, joints, clamped, planted }
    })
  }
}

/** World-space sole points of a foot: the ankle and toe joints lowered by the foot capsule's radii. */
export function solePoints (joints: Pose, leg: Leg, mannequin: Mannequin): Vec3[] {
  const radii = footRadii(leg, mannequin)
  const ankle = joints[leg.ankle]
  const toe = joints[leg.toe]
  return [[ankle[0], ankle[1] - radii.ankle, ankle[2]], [toe[0], toe[1] - radii.toe, toe[2]]]
}

function soles (recording: LocomotionRecording, leg: Leg, mannequin: Mannequin): Vec3[][] {
  return recording.frames.map(f => solePoints(f.joints, leg, mannequin))
}

function plantedPairs (points: Vec3[][]): boolean[][] {
  return points.map((now, i) => {
    return now.map((p, k) => i > 0 && p[1] <= PLANT_HEIGHT && points[i - 1][k][1] <= PLANT_HEIGHT)
  })
}

function footPlanted (recording: LocomotionRecording, leg: Leg, mannequin: Mannequin): boolean[] {
  return plantedPairs(soles(recording, leg, mannequin)).map(flags => flags.some(Boolean))
}

/**
 * Per foot, keyed by its leg label (see legLabels), the frames at which a sole point is within 2 cm of the ground in
 * that and the previous frame.
 */
export function plantedFrames (recording: LocomotionRecording, geometry: Geometry): Record<string, number> {
  const labels = legLabels(geometry.rig, restPose(geometry.mannequin))
  const counts: Record<string, number> = {}
  legsOf(geometry.rig).forEach((leg, i) => {
    counts[labels[i]] = footPlanted(recording, leg, geometry.mannequin).filter(Boolean).length
  })
  return counts
}

/** Runs of consecutive planted frames per foot, as inclusive frame indices. */
export function plantedRuns (recording: LocomotionRecording, geometry: Geometry): PlantedRun[] {
  const runs: PlantedRun[] = []
  for (const [index, leg] of legsOf(geometry.rig).entries()) {
    const flags = footPlanted(recording, leg, geometry.mannequin)
    let start = -1
    flags.forEach((planted, i) => {
      if (planted && start < 0) start = i
      if (!planted && start >= 0) {
        runs.push({ leg: index, side: leg.side, start, end: i - 1 })
        start = -1
      }
    })
    if (start >= 0) runs.push({ leg: index, side: leg.side, start, end: flags.length - 1 })
  }
  return runs.sort((a, b) => a.start - b.start || a.end - b.end)
}

/** Largest horizontal movement of a planted sole point between consecutive frames, in pixels. */
export function footSlidePx (recording: LocomotionRecording, geometry: Geometry, metresPerPixel: number): number {
  let worst = 0
  for (const leg of legsOf(geometry.rig)) {
    const points = soles(recording, leg, geometry.mannequin)
    const planted = plantedPairs(points)
    for (let i = 1; i < points.length; i++) {
      points[i].forEach((p, k) => {
        if (!planted[i][k]) return
        const q = points[i - 1][k]
        worst = Math.max(worst, Math.hypot(p[0] - q[0], p[2] - q[2]) / metresPerPixel)
      })
    }
  }
  return worst
}

/** Deepest a sole point goes below y = 0 in any frame, in pixels. */
export function groundPenetrationPx (
  recording: LocomotionRecording,
  geometry: Geometry,
  metresPerPixel: number
): number {
  let lowest = 0
  for (const leg of legsOf(geometry.rig)) {
    for (const points of soles(recording, leg, geometry.mannequin)) {
      for (const p of points) lowest = Math.min(lowest, p[1])
    }
  }
  return Math.max(0, -lowest) / metresPerPixel
}

function isFoot (part: Part, rig: Rig): boolean {
  return part.shape === 'capsule' && legsOf(rig).some(leg => part.a === leg.ankle && part.b === leg.toe)
}

/** Deepest any non-foot part (capsule end spheres, box corners) goes below y = 0 in any frame, in pixels. */
export function partGroundPenetrationPx (
  recording: LocomotionRecording,
  options: { mannequin: Mannequin, rig: Rig, metresPerPixel: number }
): number {
  const parts = options.mannequin.parts.filter(part => !isFoot(part, options.rig))
  let lowest = 0
  for (const { joints } of recording.frames) {
    for (const part of parts) lowest = Math.min(lowest, verticalExtent(part, joints).low)
  }
  return Math.max(0, -lowest) / options.metresPerPixel
}

/** Frames in which at least one IK target was clamped. */
export function reachViolations (recording: LocomotionRecording): number {
  return recording.frames.filter(f => f.clamped > 0).length
}

export function bendDirection (root: RootState, bend: Bend): Vec3 {
  if (bend === 'up') return [0, 1, 0]
  const sign = bend === 'backward' ? -1 : 1
  return [sign * Math.sin(root.yaw), 0, sign * Math.cos(root.yaw)]
}

export type JointSpeed = { leg: number, joint: string, value: number }

function flexions (recording: LocomotionRecording, triple: JointTriple): number[] {
  const [a, b, c] = triple
  return recording.frames.map(f => kneeFlexionDegrees(f.joints[a], f.joints[b], f.joints[c]))
}

/**
 * Joint-frames, over every intermediate joint of every leg, with flexion outside the leg's limits (default
 * [0, 150] degrees) or a joint on the wrong side of its bend direction.
 */
export function kneeLimitViolations (recording: LocomotionRecording, geometry: Geometry): number {
  let count = 0
  for (const leg of legsOf(geometry.rig)) {
    const { min, max } = leg.limits ?? { min: 0, max: MAX_KNEE_FLEXION }
    bendingJoints(leg).forEach((triple, i) => {
      const [a, b, c] = triple
      flexions(recording, triple).forEach((flexion, frame) => {
        const { joints, root } = recording.frames[frame]
        const direction = bendDirection(root, leg.bends[i])
        const backward = min >= 0 && kneeBendsBackward(joints[a], joints[b], joints[c], direction)
        if (flexion < min - FLEXION_EPSILON || flexion > max + FLEXION_EPSILON || backward) count++
      })
    })
  }
  return count
}

/** Largest flexion change between consecutive frames of each intermediate joint of each leg, in degrees per second. */
export function jointSpeedsDegPerSec (recording: LocomotionRecording, geometry: Geometry): JointSpeed[] {
  const speeds: JointSpeed[] = []
  for (const [index, leg] of legsOf(geometry.rig).entries()) {
    for (const triple of bendingJoints(leg)) {
      const values = flexions(recording, triple)
      let peak = 0
      for (let i = 1; i < values.length; i++) peak = Math.max(peak, Math.abs(values[i] - values[i - 1]))
      speeds.push({ leg: index, joint: triple[1], value: peak * recording.fps })
    }
  }
  return speeds
}

/** Largest flexion change of any leg joint between consecutive frames, in degrees per second. */
export function kneeSpeedDegPerSec (recording: LocomotionRecording, geometry: Geometry): number {
  return Math.max(0, ...jointSpeedsDegPerSec(recording, geometry).map(speed => speed.value))
}

function bones (rig: Rig): Array<[string, string]> {
  const pairs = (joints: string[]): Array<[string, string]> => joints.slice(1).map((j, i) => [joints[i], j])
  return [
    ...legsOf(rig).flatMap(leg => pairs(leg.joints)),
    ...armsOf(rig).flatMap(arm => pairs(arm.joints.slice(0, Math.max(2, arm.joints.length - 1))))
  ]
}

/** Largest relative change of any leg bone, or any arm bone other than the last, from the rest pose. */
export function boneLengthError (recording: LocomotionRecording, geometry: Geometry, rest: Pose): number {
  let worst = 0
  for (const [a, b] of bones(geometry.rig)) {
    const expected = length(sub(rest[a], rest[b]))
    for (const { joints } of recording.frames) {
      worst = Math.max(worst, Math.abs(length(sub(joints[a], joints[b])) - expected) / expected)
    }
  }
  return worst
}

function plantCentre (recording: LocomotionRecording, leg: Leg, mannequin: Mannequin, run: PlantedRun) {
  let x = 0
  let z = 0
  let n = 0
  for (let i = run.start; i <= run.end; i++) {
    for (const p of solePoints(recording.frames[i].joints, leg, mannequin)) {
      x += p[0]
      z += p[2]
      n++
    }
  }
  const time = (recording.frames[run.start].time + recording.frames[run.end].time) / 2
  return { time, x: x / n, z: z / n }
}

/**
 * Largest relative difference, over each foot in each steady segment, between the foot's advance along the path
 * from its first to its last plant in the segment, per second between those plants, and the script speed. The path
 * direction is the root's displacement over the segment. A foot or segment without two plants measures nothing and
 * gives Infinity.
 */
export function rootSpeedError (recording: LocomotionRecording, geometry: Geometry, segments: SteadySegment[]): number {
  const runs = plantedRuns(recording, geometry)
  const { frames } = recording
  const at = (time: number): Vec3 => {
    const i = Math.min(frames.length - 1, Math.max(0, Math.round(time * recording.fps)))
    return frames[i].root.position
  }
  let worst = 0
  for (const { start, end, speed } of segments) {
    const from = at(start)
    const to = at(end)
    const travelled = Math.hypot(to[0] - from[0], to[2] - from[2])
    const measured: number[] = []
    for (const [index, leg] of legsOf(geometry.rig).entries()) {
      const plants = runs.filter(run => run.leg === index)
        .map(run => plantCentre(recording, leg, geometry.mannequin, run))
        .filter(c => c.time >= start - TIME_EPSILON && c.time <= end + TIME_EPSILON)
      if (plants.length < 2 || travelled === 0) continue
      const first = plants[0]
      const last = plants[plants.length - 1]
      const advance = ((last.x - first.x) * (to[0] - from[0]) + (last.z - first.z) * (to[2] - from[2])) / travelled
      measured.push(Math.abs(advance / (last.time - first.time) - speed) / speed)
    }
    worst = Math.max(worst, measured.length === 0 ? Infinity : Math.max(...measured))
  }
  return worst
}

/**
 * Windows in which the script walks steadily: each 'move' segment after its first accelSeconds, minus any that
 * overlap a 'turn'.
 */
export function steadySegments (script: Script): SteadySegment[] {
  const turns: Array<[number, number]> = []
  const moves: SteadySegment[] = []
  let t = 0
  for (const segment of script.segments) {
    const end = t + segment.duration
    if (segment.action === 'turn') turns.push([t, end])
    if (segment.action === 'move') moves.push({ start: t + script.accelSeconds, end, speed: segment.speed })
    t = end
  }
  return moves.filter(m => m.end > m.start && !turns.some(([a, b]) => m.start < b && m.end > a))
}

/** Frames in which no sole point of either foot is within 2 cm of the ground. */
export function unsupportedFrames (recording: LocomotionRecording, geometry: Geometry): number {
  return recording.frames.filter(({ joints }) => {
    return !legsOf(geometry.rig).some(leg => {
      return solePoints(joints, leg, geometry.mannequin).some(p => p[1] <= PLANT_HEIGHT)
    })
  }).length
}

/**
 * Plants inside the windows (geometric plants, time of first frame) by a leg other than the one whose phase comes
 * next after the previous plant's leg. With two legs this counts the same foot planting twice in a row.
 */
export function alternationViolations (recording: LocomotionRecording, geometry: Geometry, windows: Window[]): number {
  const phases = legPhases(geometry.rig)
  const order = phases.map((_, leg) => leg).sort((a, b) => phases[a] - phases[b] || a - b)
  const following = (leg: number): number => order[(order.indexOf(leg) + 1) % order.length]
  let count = 0
  for (const { start, end } of windows) {
    const inside = plantedRuns(recording, geometry).filter(run => {
      const time = recording.frames[run.start].time
      return time >= start - TIME_EPSILON && time <= end + TIME_EPSILON
    })
    inside.forEach((run, i) => {
      if (i > 0 && following(inside[i - 1].leg) !== run.leg) count++
    })
  }
  return count
}

/** SHA-256 hex digest of each frame's joint positions, in joint-name order. */
export function frameHashes (recording: LocomotionRecording): string[] {
  return recording.frames.map(f => {
    const names = Object.keys(f.joints).sort()
    const values = Float64Array.from(names.flatMap(name => f.joints[name]))
    const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength)
    return createHash('sha256').update(names.join(',')).update(bytes).digest('hex')
  })
}
