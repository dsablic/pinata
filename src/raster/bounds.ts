import type { Mannequin, Part } from '../formats/mannequin.ts'
import { add, length, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { boxFrame } from './sdf.ts'

export type Sphere = { center: Vec3, radius: number }

export function boundingSphere (m: Mannequin, part: Part): Sphere {
  const a = m.joints[part.a]
  const b = m.joints[part.b]
  const center = scale(add(a, b), 0.5)
  if (part.shape === 'capsule') {
    return { center, radius: length(sub(b, a)) / 2 + Math.max(part.radiusA, part.radiusB) }
  }
  return { center, radius: length(boxFrame(a, b, part).half) }
}
