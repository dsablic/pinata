import { armsOf, legsOf, rankFromFront } from '../formats/rig.ts'
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

export function bendingJoints (leg: Leg): JointTriple[] {
  return leg.chain.slice(1, -1).map((joint, i): JointTriple => [leg.chain[i], joint, leg.chain[i + 2]])
}

export function chainLength (chain: string[], rest: Pose): number {
  return chain.slice(1).reduce((total, joint, i) => total + length(sub(rest[joint], rest[chain[i]])), 0)
}

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

export function legLabels (rig: Rig, rest: Pose): string[] {
  const legs = legsOf(rig)
  if (legs.length <= 2) return legs.map(leg => leg.side)
  const labels: string[] = []
  for (const side of ['left', 'right']) {
    const mine = legs.filter(leg => leg.side === side)
    const ranks = rankFromFront(mine.map(leg => rest[leg.hip][2]))
    mine.forEach((leg, k) => {
      const name = mine.length === 2 ? ['front', 'hind'][ranks[k]] : `${ranks[k] + 1}`
      labels[leg.index] = `${side} ${name}`
    })
  }
  return legs.map(leg => labels[leg.index])
}

export function armLabels (rig: Rig, rest: Pose): string[] {
  const arms = armsOf(rig)
  const labels: string[] = []
  for (const side of ['left', 'right']) {
    const mine = arms.map((arm, i) => ({ arm, i })).filter(({ arm }) => arm.side === side)
    const ranks = rankFromFront(mine.map(({ arm }) => rest[arm.shoulder][2]))
    mine.forEach(({ i }, k) => {
      labels[i] = mine.length === 1 ? `${side} arm` : `${side} arm ${ranks[k] + 1}`
    })
  }
  return labels
}
