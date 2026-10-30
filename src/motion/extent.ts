import type { Part } from '../formats/mannequin.ts'
import { boxFrame } from '../raster/sdf.ts'
import type { Pose } from './pose.ts'

export function verticalExtent (part: Part, joints: Pose): { low: number, high: number } {
  const a = joints[part.a]
  const b = joints[part.b]
  if (part.shape === 'capsule') {
    return {
      low: Math.min(a[1] - part.radiusA, b[1] - part.radiusB),
      high: Math.max(a[1] + part.radiusA, b[1] + part.radiusB)
    }
  }
  const f = boxFrame(a, b, part)
  const reach = f.half[0] * Math.abs(f.x[1]) + f.half[1] * Math.abs(f.y[1]) + f.half[2] * Math.abs(f.z[1])
  return { low: f.center[1] - reach, high: f.center[1] + reach }
}
