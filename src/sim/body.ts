import type { Mannequin } from '../formats/mannequin.ts'
import type { RootState } from '../motion/script.ts'
import { compile } from '../raster/gbuffer.ts'
import type { Primitive } from '../raster/gbuffer.ts'
import { normalize } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import type { Pose } from '../motion/pose.ts'

export type Collider = { distance: (p: Vec3) => number, normal: (p: Vec3) => Vec3 }

const NORMAL_STEP = 1e-4

export function toWorld (local: Vec3, root: RootState): Vec3 {
  const c = Math.cos(root.yaw)
  const s = Math.sin(root.yaw)
  return [
    root.position[0] + local[0] * c + local[2] * s,
    root.position[1] + local[1],
    root.position[2] - local[0] * s + local[2] * c
  ]
}

export function toLocal (p: Vec3, root: RootState): Vec3 {
  const c = Math.cos(root.yaw)
  const s = Math.sin(root.yaw)
  const x = p[0] - root.position[0]
  const y = p[1] - root.position[1]
  const z = p[2] - root.position[2]
  return [x * c - z * s, y, x * s + z * c]
}

export function anchorWorld (m: Mannequin, joint: string, root: RootState): Vec3 {
  return toWorld(m.joints[joint], root)
}

function localDistance (parts: Primitive[], p: Vec3): number {
  let best = Infinity
  for (const part of parts) {
    const dx = p[0] - part.center[0]
    const dy = p[1] - part.center[1]
    const dz = p[2] - part.center[2]
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) - part.radius >= best) continue
    const d = part.sdf(p)
    if (d < best) best = d
  }
  return best
}

export function compileParts (m: Mannequin, exclude: string[]): Primitive[] {
  return m.parts.filter(part => !exclude.includes(part.name)).map(part => compile(m, part))
}

const posedCache = new WeakMap<Pose, { exclude: string[], parts: Primitive[] }>()

/** Compiled parts of the mannequin in `pose`, cached by the identity of the pose object. */
export function posedParts (m: Mannequin, exclude: string[], pose: Pose): Primitive[] {
  const cached = posedCache.get(pose)
  if (cached !== undefined && cached.exclude === exclude) return cached.parts
  const parts = compileParts({ ...m, joints: pose }, exclude)
  posedCache.set(pose, { exclude, parts })
  return parts
}

export function bodyCollider (m: Mannequin, exclude: string[], root: RootState): Collider {
  return partsCollider(compileParts(m, exclude), root)
}

export function partsCollider (parts: Primitive[], root: RootState): Collider {
  const c = Math.cos(root.yaw)
  const s = Math.sin(root.yaw)
  const distance = (p: Vec3): number => localDistance(parts, toLocal(p, root))
  const normal = (p: Vec3): Vec3 => {
    const [x, y, z] = toLocal(p, root)
    const h = NORMAL_STEP
    const gx = localDistance(parts, [x + h, y, z]) - localDistance(parts, [x - h, y, z])
    const gy = localDistance(parts, [x, y + h, z]) - localDistance(parts, [x, y - h, z])
    const gz = localDistance(parts, [x, y, z + h]) - localDistance(parts, [x, y, z - h])
    const n = normalize([gx, gy, gz])
    if (n[0] === 0 && n[1] === 0 && n[2] === 0) return [0, 1, 0]
    return [n[0] * c + n[2] * s, n[1], -n[0] * s + n[2] * c]
  }
  return { distance, normal }
}
