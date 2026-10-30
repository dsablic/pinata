import { cross, dot, length, scale } from './vec.ts'
import type { Vec3 } from './vec.ts'

/** A 3x3 rotation matrix, as rows. */
export type Matrix = [Vec3, Vec3, Vec3]

const PARALLEL_EPSILON = 1e-12

export const IDENTITY: Matrix = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]

export function apply (m: Matrix, v: Vec3): Vec3 {
  return [dot(m[0], v), dot(m[1], v), dot(m[2], v)]
}

export function multiply (a: Matrix, b: Matrix): Matrix {
  const columns: Matrix = [[b[0][0], b[1][0], b[2][0]], [b[0][1], b[1][1], b[2][1]], [b[0][2], b[1][2], b[2][2]]]
  return a.map(row => columns.map(column => dot(row, column))) as Matrix
}

export function transpose (m: Matrix): Matrix {
  return [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]]
}

/** Rotation about the y axis by yaw, matching toWorld. */
export function yawMatrix (yaw: number): Matrix {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]]
}

/** Rotation about the unit axis by angle radians (Rodrigues). */
export function axisAngle (axis: Vec3, angle: number): Matrix {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const t = 1 - c
  const [x, y, z] = axis
  return [
    [c + x * x * t, x * y * t - z * s, x * z * t + y * s],
    [y * x * t + z * s, c + y * y * t, y * z * t - x * s],
    [z * x * t - y * s, z * y * t + x * s, c + z * z * t]
  ]
}

/**
 * The smallest rotation that takes unit vector from onto unit vector to; for opposite vectors, a half turn about an
 * axis at right angles to them.
 */
export function between (from: Vec3, to: Vec3): Matrix {
  const axis = cross(from, to)
  const sin = length(axis)
  if (sin >= PARALLEL_EPSILON) return axisAngle(scale(axis, 1 / sin), Math.atan2(sin, dot(from, to)))
  if (dot(from, to) > 0) return IDENTITY
  const helper: Vec3 = Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const perpendicular = cross(from, helper)
  return axisAngle(scale(perpendicular, 1 / length(perpendicular)), Math.PI)
}

/** The axis and angle of a rotation matrix; the axis is [1, 0, 0] for (near) identity. */
export function toAxisAngle (m: Matrix): { axis: Vec3, angle: number } {
  const axis: Vec3 = [m[2][1] - m[1][2], m[0][2] - m[2][0], m[1][0] - m[0][1]]
  const sin = length(axis) / 2
  const cos = (m[0][0] + m[1][1] + m[2][2] - 1) / 2
  const angle = Math.atan2(sin, cos)
  if (sin < PARALLEL_EPSILON) {
    if (cos > 0) return { axis: [1, 0, 0], angle: 0 }
    const diagonal = [m[0][0], m[1][1], m[2][2]]
    const k = diagonal.indexOf(Math.max(...diagonal))
    const column: Vec3 = [m[0][k] + (k === 0 ? 1 : 0), m[1][k] + (k === 1 ? 1 : 0), m[2][k] + (k === 2 ? 1 : 0)]
    return { axis: scale(column, 1 / length(column)), angle: Math.PI }
  }
  return { axis: scale(axis, 1 / (2 * sin)), angle }
}

/** The rotation a fraction u of the way from a to b, about the single axis that takes a to b. */
export function interpolate (a: Matrix, b: Matrix, u: number): Matrix {
  const { axis, angle } = toAxisAngle(multiply(b, transpose(a)))
  if (angle === 0) return a
  return multiply(axisAngle(axis, angle * u), a)
}

/** Rotation by x, then y, then z radians about the fixed axes (Rz · Ry · Rx), as ASF and AMC files compose them. */
export function eulerXyz (x: number, y: number, z: number): Matrix {
  return multiply(axisAngle([0, 0, 1], z), multiply(axisAngle([0, 1, 0], y), axisAngle([1, 0, 0], x)))
}

/** The rotation of a unit quaternion [w, x, y, z]; the quaternion is normalized first. */
export function fromQuaternion (q: readonly number[]): Matrix {
  const size = Math.hypot(q[0], q[1], q[2], q[3])
  const [w, x, y, z] = q.map(v => v / size)
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]
  ]
}

/** The unit quaternion [w, x, y, z] of a rotation matrix, with w >= 0. */
export function toQuaternion (m: Matrix): [number, number, number, number] {
  const trace = m[0][0] + m[1][1] + m[2][2]
  let q: [number, number, number, number]
  if (trace > 0) {
    const s = 2 * Math.sqrt(trace + 1)
    q = [s / 4, (m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s]
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = 2 * Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2])
    q = [(m[2][1] - m[1][2]) / s, s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s]
  } else if (m[1][1] > m[2][2]) {
    const s = 2 * Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2])
    q = [(m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s]
  } else {
    const s = 2 * Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1])
    q = [(m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4]
  }
  return q[0] < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q
}
