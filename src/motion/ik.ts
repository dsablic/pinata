import { add, cross, dot, length, normalize, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'

const REACH_MARGIN = 1e-6
const MAX_ITERATIONS = 400
const CONVERGED = 1e-10
const INITIAL_BULGE = 0.5
const REST_SHAPE_MINIMUM = 1e-3
const DEGREES = Math.PI / 180

export const MAX_FLEXION_DEGREES = 150

export type IkOptions = { hip: Vec3, target: Vec3, upper: number, lower: number, pole: Vec3 }

export function twoBoneIk (options: IkOptions): { knee: Vec3, end: Vec3, clamped: boolean } {
  const { hip, target, upper, lower, pole } = options
  const toTarget = sub(target, hip)
  const maximum = upper + lower - REACH_MARGIN
  const minimum = Math.abs(upper - lower) + REACH_MARGIN
  const distance = length(toTarget)
  const axis = distance === 0 ? orthogonal(pole) : normalize(toTarget)
  const reach = Math.min(maximum, Math.max(minimum, distance))
  const clamped = reach !== distance
  const along = (upper * upper - lower * lower + reach * reach) / (2 * reach)
  const height = Math.sqrt(Math.max(0, upper * upper - along * along))
  const side = normalize(sub(pole, scale(axis, dot(pole, axis))))
  const bend = length(side) === 0 ? orthogonal(axis) : side
  const knee = add(hip, add(scale(axis, along), scale(bend, height)))
  return { knee, end: add(hip, scale(axis, reach)), clamped }
}

export type FlexionLimits = { min: number, max: number }
export type ChainIkOptions = {
  joints: Vec3[]
  target: Vec3
  pole: Vec3
  root?: Vec3
  bends?: number[]
  limits?: FlexionLimits | FlexionLimits[]
}
type Plane = [number, number]

/**
 * Places a chain of two or more bones with its first joint at `root` (default `joints[0]`) and its last joint at
 * `target`; `joints` supply the bone lengths. Two bones use `twoBoneIk`. More bones use FABRIK in the plane through
 * root, target and pole, started from a zigzag on the bend sides, run for at most MAX_ITERATIONS and ending on a
 * forward pass, so lengths are exact and flexion limits hold. A bend of 1 bulges a joint toward the pole, -1 away
 * from it; flexion is positive when a joint bends toward its bend side.
 */
export function chainIk (options: ChainIkOptions): { joints: Vec3[], clamped: boolean } {
  const { joints, target, pole } = options
  const root = options.root ?? joints[0]
  const bones = joints.length - 1
  if (bones < 2) throw new Error(`a chain needs at least two bones, got ${bones}`)
  const lengths = joints.slice(1).map((joint, i) => length(sub(joint, joints[i])))
  const signs = options.bends ?? lengths.slice(1).map(() => 1)
  if (bones === 2) {
    const flipped = signs[0] < 0 ? sub([0, 0, 0], pole) : pole
    const result = twoBoneIk({ hip: root, target, upper: lengths[0], lower: lengths[1], pole: flipped })
    return { joints: [root, result.knee, result.end], clamped: result.clamped }
  }
  const total = lengths.reduce((sum, l) => sum + l, 0)
  const toTarget = sub(target, root)
  const distance = length(toTarget)
  const axis = distance === 0 ? orthogonal(pole) : normalize(toTarget)
  const maximum = total - REACH_MARGIN
  const minimum = Math.max(0, 2 * Math.max(...lengths) - total) + REACH_MARGIN
  const reach = Math.min(maximum, Math.max(minimum, distance))
  const sideward = sub(pole, scale(axis, dot(pole, axis)))
  const side = length(sideward) === 0 ? orthogonal(axis) : normalize(sideward)
  const ranges = limitRanges(options.limits, bones - 1)
  const start = startShape(joints, { pole, signs, reach, total })
  const flat = fabrik({ lengths, signs, ranges, reach, start })
  const placed = flat.map(([u, v]) => add(root, add(scale(axis, u), scale(side, v))))
  return { joints: placed, clamped: reach !== distance }
}

function limitRanges (limits: FlexionLimits | FlexionLimits[] | undefined, count: number): FlexionLimits[] {
  const fallback = { min: 0, max: 180 }
  return Array.from({ length: count }, (_, i) => Array.isArray(limits) ? limits[i] ?? fallback : limits ?? fallback)
}

type Shape = { pole: Vec3, signs: number[], reach: number, total: number }

/** The rest shape in the solution plane where its joints already bend to their sides, else a zigzag on the sides. */
function startShape (joints: Vec3[], { pole, signs, reach, total }: Shape): Plane[] {
  const count = joints.length - 1
  const slack = Math.sqrt(Math.max(0, total * total - reach * reach))
  const axis = normalize(sub(joints[count], joints[0]))
  const side = normalize(sub(pole, scale(axis, dot(pole, axis))))
  const restReach = dot(sub(joints[count], joints[0]), axis)
  const usable = restReach > 0 && length(side) > 0
  const points: Plane[] = [[0, 0]]
  let along = 0
  for (let i = 1; i <= count; i++) {
    along += length(sub(joints[i], joints[i - 1]))
    const fraction = along / total
    const rel = sub(joints[i], joints[0])
    const [u, v] = usable ? [dot(rel, axis) * reach / restReach, dot(rel, side)] : [0, 0]
    const sign = signs[i - 1] ?? 1
    const keep = usable && i < count && sign * v > REST_SHAPE_MINIMUM * total
    const zigzag = i === count ? 0 : sign * INITIAL_BULGE * slack * Math.sin(Math.PI * fraction)
    points.push(keep ? [u, v] : [reach * fraction, zigzag])
  }
  return points
}

type Problem = { lengths: number[], signs: number[], ranges: FlexionLimits[], reach: number, start: Plane[] }

function fabrik ({ lengths, signs, ranges, reach, start }: Problem): Plane[] {
  const count = lengths.length
  const goal: Plane = [reach, 0]
  let points = start
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    points = forwardPass(backwardPass(points, goal, lengths), lengths, signs, ranges)
    const end = points[count]
    if (Math.hypot(end[0] - goal[0], end[1] - goal[1]) < CONVERGED) break
  }
  return points
}

function backwardPass (points: Plane[], goal: Plane, lengths: number[]): Plane[] {
  const next: Plane[] = [...points]
  next[points.length - 1] = goal
  for (let i = points.length - 2; i >= 0; i--) {
    const dx = points[i][0] - next[i + 1][0]
    const dy = points[i][1] - next[i + 1][1]
    const size = Math.hypot(dx, dy)
    const [ux, uy] = size === 0 ? [-1, 0] : [dx / size, dy / size]
    next[i] = [next[i + 1][0] + ux * lengths[i], next[i + 1][1] + uy * lengths[i]]
  }
  return next
}

function forwardPass (points: Plane[], lengths: number[], signs: number[], ranges: FlexionLimits[]): Plane[] {
  const next: Plane[] = [[0, 0]]
  let previous: Plane = [1, 0]
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - next[i - 1][0]
    const dy = points[i][1] - next[i - 1][1]
    const size = Math.hypot(dx, dy)
    let direction: Plane = size === 0 ? previous : [dx / size, dy / size]
    if (i >= 2) direction = limited(previous, direction, signs[i - 2] ?? 1, ranges[i - 2])
    next.push([next[i - 1][0] + direction[0] * lengths[i - 1], next[i - 1][1] + direction[1] * lengths[i - 1]])
    previous = direction
  }
  return next
}

function limited (previous: Plane, direction: Plane, sign: number, range: FlexionLimits): Plane {
  const turn = Math.atan2(previous[0] * direction[1] - previous[1] * direction[0],
    previous[0] * direction[0] + previous[1] * direction[1])
  const flexion = -sign * turn / DEGREES
  const clamped = Math.min(range.max, Math.max(range.min, flexion))
  if (clamped === flexion) return direction
  const angle = -sign * clamped * DEGREES
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [previous[0] * c - previous[1] * s, previous[0] * s + previous[1] * c]
}

function orthogonal (v: Vec3): Vec3 {
  const helper: Vec3 = Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  return normalize(cross(v, helper))
}

export function kneeFlexionDegrees (hip: Vec3, knee: Vec3, ankle: Vec3): number {
  const upper = normalize(sub(knee, hip))
  const lower = normalize(sub(ankle, knee))
  const cosine = Math.min(1, Math.max(-1, dot(upper, lower)))
  return Math.acos(cosine) * 180 / Math.PI
}

export function kneeBendsBackward (hip: Vec3, knee: Vec3, ankle: Vec3, forward: Vec3): boolean {
  const chord = sub(ankle, hip)
  const axis = normalize(chord)
  const offset = sub(sub(knee, hip), scale(axis, dot(sub(knee, hip), axis)))
  return dot(offset, forward) < -REACH_MARGIN
}
