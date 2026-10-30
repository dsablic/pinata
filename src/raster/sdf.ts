import { add, cross, dot, length, normalize, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'

export type BoxFrame = { center: Vec3, x: Vec3, y: Vec3, z: Vec3, half: Vec3, rounding: number }

export type BoxOptions = { widthAxis: Vec3, width: number, thickness: number, rounding: number }

export type RoundCone = {
  a: Vec3
  ba: Vec3
  l2: number
  rr: number
  a2: number
  il2: number
  ra: number
  rb: number
}

export function roundCone (a: Vec3, b: Vec3, ra: number, rb: number): RoundCone {
  const ba = sub(b, a)
  const l2 = dot(ba, ba)
  const rr = ra - rb
  return { a, ba, l2, rr, a2: l2 - rr * rr, il2: 1 / l2, ra, rb }
}

export function roundConeDistance (c: RoundCone, px: number, py: number, pz: number): number {
  const { l2, rr, a2, il2, ra, rb } = c
  const pax = px - c.a[0]
  const pay = py - c.a[1]
  const paz = pz - c.a[2]
  if (l2 < 1e-12) return Math.sqrt(pax * pax + pay * pay + paz * paz) - Math.max(ra, rb)
  const bax = c.ba[0]
  const bay = c.ba[1]
  const baz = c.ba[2]
  const y = pax * bax + pay * bay + paz * baz
  const z = y - l2
  const wx = pax * l2 - bax * y
  const wy = pay * l2 - bay * y
  const wz = paz * l2 - baz * y
  const x2 = wx * wx + wy * wy + wz * wz
  const y2 = y * y * l2
  const z2 = z * z * l2
  const k = Math.sign(rr) * rr * rr * x2
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - ra
}

export function sdRoundCone (p: Vec3, a: Vec3, b: Vec3, ra: number, rb: number): number {
  return roundConeDistance(roundCone(a, b, ra, rb), p[0], p[1], p[2])
}

export function boxFrame (a: Vec3, b: Vec3, options: BoxOptions): BoxFrame {
  const segment = sub(b, a)
  const y = normalize(segment)
  const x = normalize(sub(options.widthAxis, scale(y, dot(options.widthAxis, y))))
  return {
    center: scale(add(a, b), 0.5),
    x,
    y,
    z: cross(x, y),
    half: [options.width / 2, length(segment) / 2, options.thickness / 2],
    rounding: options.rounding
  }
}

export function boxDistance (f: BoxFrame, px: number, py: number, pz: number): number {
  const dx = px - f.center[0]
  const dy = py - f.center[1]
  const dz = pz - f.center[2]
  const r = f.rounding
  const qx = Math.abs(dx * f.x[0] + dy * f.x[1] + dz * f.x[2]) - (f.half[0] - r)
  const qy = Math.abs(dx * f.y[0] + dy * f.y[1] + dz * f.y[2]) - (f.half[1] - r)
  const qz = Math.abs(dx * f.z[0] + dy * f.z[1] + dz * f.z[2]) - (f.half[2] - r)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0))
  const inside = Math.min(Math.max(qx, qy, qz), 0)
  return outside + inside - r
}

export function sdBox (p: Vec3, f: BoxFrame): number {
  return boxDistance(f, p[0], p[1], p[2])
}
