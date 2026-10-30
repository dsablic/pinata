import type { Leg } from '../formats/rig.ts'
import type { Mannequin } from '../formats/mannequin.ts'
import type { Vec3 } from '../math/vec.ts'

export type Pose = Record<string, Vec3>

export function restPose (m: Mannequin): Pose {
  return structuredClone(m.joints)
}

export function posedMannequin (m: Mannequin, pose: Pose): Mannequin {
  return { ...m, joints: structuredClone(pose) }
}

export function footRadii (leg: Leg, mannequin: Mannequin): { ankle: number, toe: number } {
  const foot = mannequin.parts.find(part => {
    return part.shape === 'capsule' && part.a === leg.ankle && part.b === leg.toe
  })
  if (foot === undefined || foot.shape !== 'capsule') {
    throw new Error(`no capsule part spans ankle '${leg.ankle}' and toe '${leg.toe}'`)
  }
  return { ankle: foot.radiusA, toe: foot.radiusB }
}

export function soleHeight (leg: Leg, rest: Pose, mannequin: Mannequin): number {
  const radii = footRadii(leg, mannequin)
  return Math.min(rest[leg.ankle][1] - radii.ankle, rest[leg.toe][1] - radii.toe)
}
