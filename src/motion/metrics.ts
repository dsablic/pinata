import { createHash } from 'node:crypto'
import type { Mannequin, Part } from '../formats/mannequin.ts'
import { armsOf, legPhases, legsOf } from '../formats/rig.ts'
import type { Bend, Leg, Rig } from '../formats/rig.ts'
import { length, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { toWorld } from '../sim/body.ts'
import type { GaitFrame } from './gait.ts'
import { appendagesOf } from './appendages.ts'
import { kneeBendsBackward, kneeFlexionDegrees, MAX_FLEXION_DEGREES } from './ik.ts'
import { verticalExtent } from './extent.ts'
import { poseSequence } from './sequence.ts'
import { bendingJoints, legLabels, restPose, solePoints } from './pose.ts'
import type { JointTriple } from './pose.ts'
import type { Pose } from './pose.ts'

export { solePoints } from './pose.ts'
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
  options: { rig: Rig, rest: Pose, mannequin: Mannequin, fps: number, substeps?: number }
): LocomotionRecording {
  const { rig, rest, mannequin, fps } = options
  const labels = legLabels(rig, rest)
  const { poses, clamped: clamps } = poseSequence(frames, options)
  return {
    fps,
    frames: frames.map((frame, i) => {
      const pose = poses[i]
      const clamped = clamps[i]
      const joints: Pose = {}
      for (const [name, local] of Object.entries(pose)) joints[name] = toWorld(local, frame.root)
      const planted = Object.fromEntries(labels.map((label, k) => [label, frame.feet[k]?.planted ?? false]))
      return { time: i / fps, root: frame.root, joints, clamped, planted }
    })
  }
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

export function plantedFrames (recording: LocomotionRecording, geometry: Geometry): Record<string, number> {
  const labels = legLabels(geometry.rig, restPose(geometry.mannequin))
  const counts: Record<string, number> = {}
  legsOf(geometry.rig).forEach((leg, i) => {
    counts[labels[i]] = footPlanted(recording, leg, geometry.mannequin).filter(Boolean).length
  })
  return counts
}

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

export function kneeSpeedDegPerSec (recording: LocomotionRecording, geometry: Geometry): number {
  return Math.max(0, ...jointSpeedsDegPerSec(recording, geometry).map(speed => speed.value))
}

type Bone = [string, string]

function consecutivePairs (joints: string[]): Bone[] {
  return joints.slice(1).map((j, i) => [joints[i], j])
}

function bones (rig: Rig): Bone[] {
  return [
    ...legsOf(rig).flatMap(leg => consecutivePairs(leg.joints)),
    ...armsOf(rig).flatMap(arm => consecutivePairs(arm.joints.slice(0, Math.max(2, arm.joints.length - 1))))
  ]
}

function worstBoneChange (
  pairs: Bone[],
  recording: LocomotionRecording,
  rest: Pose,
  score: (error: number) => number
): number {
  let worst = 0
  for (const [a, b] of pairs) {
    const expected = length(sub(rest[a], rest[b]))
    for (const { joints } of recording.frames) {
      worst = Math.max(worst, score(Math.abs(length(sub(joints[a], joints[b])) - expected) / expected))
    }
  }
  return worst
}

export function boneLengthError (recording: LocomotionRecording, geometry: Geometry, rest: Pose): number {
  return worstBoneChange(bones(geometry.rig), recording, rest, error => error)
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

export function unsupportedFrames (recording: LocomotionRecording, geometry: Geometry): number {
  return recording.frames.filter(({ joints }) => {
    return !legsOf(geometry.rig).some(leg => {
      return solePoints(joints, leg, geometry.mannequin).some(p => p[1] <= PLANT_HEIGHT)
    })
  }).length
}

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

export function frameHashes (recording: LocomotionRecording): string[] {
  return recording.frames.map(f => {
    const names = Object.keys(f.joints).sort()
    const values = Float64Array.from(names.flatMap(name => f.joints[name]))
    const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength)
    return createHash('sha256').update(names.join(',')).update(bytes).digest('hex')
  })
}

const BALANCE_TOLERANCE = 0.02

type Point = [number, number]

function cross2 (o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

export function convexHull (points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (sorted.length <= 2) return sorted
  const half = (list: Point[]): Point[] => {
    const hull: Point[] = []
    for (const p of list) {
      while (hull.length >= 2 && cross2(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop()
      hull.push(p)
    }
    hull.pop()
    return hull
  }
  return [...half(sorted), ...half([...sorted].reverse())]
}

function segmentDistance (p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const span = dx * dx + dy * dy
  const t = span === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / span))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

export function hullDistance (p: Point, hull: readonly Point[]): number {
  if (hull.length === 1) return Math.hypot(p[0] - hull[0][0], p[1] - hull[0][1])
  const edges = hull.map((a, i): [Point, Point] => [a, hull[(i + 1) % hull.length]])
  const nearest = Math.min(...edges.map(([a, b]) => segmentDistance(p, a, b)))
  if (hull.length === 2) return nearest
  return edges.every(([a, b]) => cross2(a, b, p) >= 0) ? -nearest : nearest
}

function partVolume (part: Part, joints: Pose): number {
  const span = length(sub(joints[part.a], joints[part.b]))
  if (part.shape === 'box') return part.width * part.thickness * span
  const radius = (part.radiusA + part.radiusB) / 2
  return Math.PI * radius * radius * (span + 4 / 3 * radius)
}

export function bodyCentre (joints: Pose, geometry: Geometry): Point {
  const group = new Set([geometry.rig.pelvis, ...geometry.rig.upperBody])
  const parts = geometry.mannequin.parts.filter(part => group.has(part.a) && group.has(part.b))
  let weight = 0
  let x = 0
  let z = 0
  for (const part of parts) {
    const volume = partVolume(part, joints)
    weight += volume
    x += volume * (joints[part.a][0] + joints[part.b][0]) / 2
    z += volume * (joints[part.a][2] + joints[part.b][2]) / 2
  }
  if (weight > 0) return [x / weight, z / weight]
  const names = [...group]
  const sum = names.reduce((s, name) => [s[0] + joints[name][0], s[1] + joints[name][2]], [0, 0])
  return [sum[0] / names.length, sum[1] / names.length]
}

export function balanceDistances (recording: LocomotionRecording, geometry: Geometry): Array<number | undefined> {
  const legs = legsOf(geometry.rig)
  return recording.frames.map(({ joints }) => {
    const support: Point[] = legs.flatMap(leg => solePoints(joints, leg, geometry.mannequin))
      .filter(p => p[1] <= PLANT_HEIGHT).map(p => [p[0], p[2]])
    if (support.length === 0) return undefined
    return hullDistance(bodyCentre(joints, geometry), convexHull(support))
  })
}

export function unbalancedFrames (recording: LocomotionRecording, geometry: Geometry): number {
  return balanceDistances(recording, geometry).filter(d => d !== undefined && d > BALANCE_TOLERANCE).length
}

export function appendageBoneLengthError (recording: LocomotionRecording, geometry: Geometry, rest: Pose): number {
  const pairs = appendagesOf(geometry.rig).flatMap(limb => consecutivePairs(limb.joints))
  return worstBoneChange(pairs, recording, rest, error => Number.isFinite(error) ? error : Infinity)
}

export function appendageNonFinite (recording: LocomotionRecording, geometry: Geometry): number {
  const names = appendagesOf(geometry.rig).flatMap(limb => limb.joints)
  return recording.frames.reduce((count, { joints }) => {
    return count + names.filter(name => !joints[name].every(Number.isFinite)).length
  }, 0)
}
