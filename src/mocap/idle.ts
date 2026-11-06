import { armsOf, legsOf } from '../formats/rig.ts'
import type { Pose } from '../motion/pose.ts'
import type { Transforms } from '../motion/skeleton.ts'
import type { PerformanceTake } from './database.ts'
import { moveJoints } from './retarget.ts'
import type { Hierarchy, RetargetOptions } from './retarget.ts'

export type IdleLayer = { laps: number, breaths: number }
export type Liven = (pose: Pose, transforms: Transforms, phase: number, weight: number) => void

export const BREATH_SHARE = 0.012
export const SHOULDER_BREATH = 0.5
export const SHIFT_SHARE = 0.15
const SHIFT_SECONDS = 7
const BREATH_SECONDS = 3.5

export function idleLayerOf (take: PerformanceTake, rate: number): IdleLayer {
  const lap = (take.frames.length - 1) / (take.fps * rate)
  const laps = Math.max(1, Math.round(SHIFT_SECONDS / lap))
  return { laps, breaths: Math.max(1, Math.round(laps * lap / BREATH_SECONDS)) }
}

function below (hierarchy: Hierarchy, roots: string[]): string[] {
  const inside = new Set(roots)
  for (const joint of hierarchy.order) {
    const parent = hierarchy.parents[joint]
    if (parent !== undefined && inside.has(parent)) inside.add(joint)
  }
  return hierarchy.order.filter(joint => inside.has(joint))
}

export function livenOf (options: RetargetOptions, hierarchy: Hierarchy, layer: IdleLayer): Liven {
  const { rig, rest, mannequin } = options
  const shoulders = armsOf(rig).map(arm => arm.shoulder)
  const chests = [...new Set(shoulders.map(joint => hierarchy.parents[joint] ?? rig.pelvis))]
    .filter(joint => joint !== rig.pelvis)
  const chest = below(hierarchy, chests.length > 0 ? chests : shoulders)
  const arms = below(hierarchy, shoulders)
  const legs = legsOf(rig)
  const feet = new Set(legs.flatMap(leg => leg.joints.slice(1)))
  const body = hierarchy.order.filter(joint => !feet.has(joint))
  const xs = legs.map(leg => rest[leg.ankle][0])
  const span = Math.max(...xs) - Math.min(...xs)
  const breath = BREATH_SHARE * mannequin.height
  return (pose, transforms, phase, weight) => {
    const rise = weight * breath * (1 - Math.cos(2 * Math.PI * phase * layer.breaths)) / 2
    moveJoints(pose, transforms, chest, [0, rise, 0])
    moveJoints(pose, transforms, arms, [0, SHOULDER_BREATH * rise, 0])
    moveJoints(pose, transforms, body, [weight * SHIFT_SHARE * span * Math.sin(2 * Math.PI * phase), 0, 0])
  }
}
