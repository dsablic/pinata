import { legsOf } from '../formats/rig.ts'
import type { Rig } from '../formats/rig.ts'
import { chainLength } from '../motion/pose.ts'
import type { Pose } from '../motion/pose.ts'

export const GRAVITY = 9.81
export const JUMP_HEIGHT_SHARE = 1
export const JUMP_REACH = 1
export const SUPER_JUMP_HEIGHT = 6
export const SUPER_JUMP_REACH = 2
export const SUPER_JUMP_CLEARANCE = 1
export const JUMP_CLEARANCE = 0.1
export const MOST_JUMP_SPEED = 3.5
export const LAND_IN = 0.25
const EDGE_MARGIN = 0.3

export type JumpKind = 'leg' | 'super'
export const DEFAULT_JUMP_KIND: JumpKind = 'leg'
export type JumpReach = { height: number, reach: number, clearance?: number }
export type Arc = { launch: number, seconds: number, speed: number, clearance: number }

export function arcOver (rise: number, run: number, clearance = JUMP_CLEARANCE): Arc {
  const apex = Math.max(rise, 0) + clearance
  const launch = Math.sqrt(2 * GRAVITY * apex)
  const seconds = launch / GRAVITY + Math.sqrt(2 * (apex - rise) / GRAVITY)
  return { launch, seconds, speed: run / seconds, clearance }
}

export function heightAt (arc: Arc, seconds: number): number {
  return arc.launch * seconds - GRAVITY * seconds * seconds / 2
}

export function jumpHeightOf (legLength: number): number {
  return JUMP_HEIGHT_SHARE * legLength
}

export function runUp (rise: number, clearance = JUMP_CLEARANCE): number {
  const { launch, seconds } = arcOver(rise, 0, clearance)
  const crossing = (launch - Math.sqrt(launch * launch - 2 * GRAVITY * rise)) / GRAVITY
  const share = crossing / seconds
  return (LAND_IN * share + EDGE_MARGIN) / (1 - share)
}

export function legLengthOf (rig: Rig, rest: Pose): number {
  return Math.min(...legsOf(rig).map(leg => chainLength(leg.chain, rest)))
}

export function jumpOf (rig: Rig, rest: Pose, kind: JumpKind = DEFAULT_JUMP_KIND): JumpReach {
  if (kind === 'super') return { height: SUPER_JUMP_HEIGHT, reach: SUPER_JUMP_REACH, clearance: SUPER_JUMP_CLEARANCE }
  return { height: jumpHeightOf(legLengthOf(rig, rest)), reach: JUMP_REACH }
}
