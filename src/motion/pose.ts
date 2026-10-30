import { armsOf, legsOf } from '../formats/rig.ts'
import type { Leg, Rig } from '../formats/rig.ts'
import type { Mannequin } from '../formats/mannequin.ts'
import { length, sub } from '../math/vec.ts'
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

export type JointTriple = [string, string, string]

/** Every intermediate joint of the leg's hip-to-ankle chain with the joints on either side of it. */
export function bendingJoints (leg: Leg): JointTriple[] {
  return leg.chain.slice(1, -1).map((joint, i): JointTriple => [leg.chain[i], joint, leg.chain[i + 2]])
}

export function chainLength (chain: string[], rest: Pose): number {
  return chain.slice(1).reduce((total, joint, i) => total + length(sub(rest[joint], rest[chain[i]])), 0)
}

/** For each arm, the index in legsOf of the leg on its side whose hip is nearest the shoulder along the body. */
export function nearestLegs (rig: Rig, rest: Pose): number[] {
  const legs = legsOf(rig)
  return armsOf(rig).map(arm => {
    const gap = (leg: Leg): number => Math.abs(rest[leg.hip][2] - rest[arm.shoulder][2])
    const onSide = legs.filter(leg => leg.side === arm.side)
    const pool = onSide.length > 0 ? onSide : legs
    return legs.indexOf(pool.reduce((a, b) => gap(b) < gap(a) ? b : a))
  })
}

export function soleHeight (leg: Leg, rest: Pose, mannequin: Mannequin): number {
  const radii = footRadii(leg, mannequin)
  return Math.min(rest[leg.ankle][1] - radii.ankle, rest[leg.toe][1] - radii.toe)
}

/** Leg names for messages and keys: the side for two legs, side and front or hind (by hip z) for more. */
export function legLabels (rig: Rig, rest: Pose): string[] {
  if (legsOf(rig).length <= 2) return legsOf(rig).map(leg => leg.side)
  return legsOf(rig).map((leg, i) => {
    const z = rest[leg.hip][2]
    const behind = legsOf(rig).filter((other, k) => {
      const otherZ = rest[other.hip][2]
      return other.side === leg.side && (otherZ < z || (otherZ === z && k < i))
    })
    return `${leg.side} ${behind.length === 0 ? 'hind' : 'front'}`
  })
}
