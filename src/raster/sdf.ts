import { add, cross, dot, length, normalize, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'

export type BoxFrame = { center: Vec3, x: Vec3, y: Vec3, z: Vec3, half: Vec3, rounding: number }

export type BoxOptions = { widthAxis: Vec3, width: number, thickness: number, rounding: number }

export function sdRoundCone (p: Vec3, a: Vec3, b: Vec3, ra: number, rb: number): number {
  const ba = sub(b, a)
  const l2 = dot(ba, ba)
  const pa = sub(p, a)
  if (l2 < 1e-12) return length(pa) - Math.max(ra, rb)
  const rr = ra - rb
  const a2 = l2 - rr * rr
  const il2 = 1 / l2
  const y = dot(pa, ba)
  const z = y - l2
  const w = sub(scale(pa, l2), scale(ba, y))
  const x2 = dot(w, w)
  const y2 = y * y * l2
  const z2 = z * z * l2
  const k = Math.sign(rr) * rr * rr * x2
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - ra
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

export function sdBox (p: Vec3, f: BoxFrame): number {
  const d = sub(p, f.center)
  const r = f.rounding
  const qx = Math.abs(dot(d, f.x)) - (f.half[0] - r)
  const qy = Math.abs(dot(d, f.y)) - (f.half[1] - r)
  const qz = Math.abs(dot(d, f.z)) - (f.half[2] - r)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0))
  const inside = Math.min(Math.max(qx, qy, qz), 0)
  return outside + inside - r
}
