import { add, cross, dot, length, normalize, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'

const REACH_MARGIN = 1e-6

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
