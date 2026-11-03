import { legsOf } from '../formats/rig.ts'
import type { Leg } from '../formats/rig.ts'
import type { Pose } from '../motion/pose.ts'
import { dot, length, sub } from '../math/vec.ts'
import { FPS } from '../page/cast.ts'
import { createWalker } from '../page/walker.ts'
import type { WalkerFrame } from '../page/walker.ts'
import type { Ground } from '../page/surfaces.ts'
import { random } from '../world/terrain.ts'
import type { ReadWorld } from '../world/bundle.ts'
import type { CastMember } from '../world/world.ts'
import { MID_AIR_PX, PLANTED_TOLERANCE_PX } from './page-scenarios.ts'

export type Footing = { falling: boolean, pelvis: number, feet: Array<{ planted: boolean, gap: number | null }> }
export type Landing = {
  height: number
  knee: number
  dip: number
  soleDepth: number
  recovery: number
}
export type Landings = { name: string, drops: Landing[] }

export const DROP_HEIGHTS = [0.6, 2, 5]
export const PIXELS_PER_METRE = 54
export const PLANTED_TOLERANCE = PLANTED_TOLERANCE_PX / PIXELS_PER_METRE
export const MID_AIR = MID_AIR_PX / PIXELS_PER_METRE
export const REACTION_SECONDS = 0.5
const SECONDS = 3
export const PELVIS_BACK = 0.03
export const SWING_CLEARANCE = 0.2
const STANDING_SECONDS = 0.5
const SEED = 1
const RESTING_WIDTH = 0.6
const EAST = Math.PI / 2
const FLOOR = 0
const FLOOR_SURFACE = { id: 0, from: -RESTING_WIDTH / 2, to: RESTING_WIDTH / 2, height: FLOOR }
const FLAT: Ground = { surfaces: [FLOOR_SURFACE], walls: [] }

export function kneeFlexion (joints: Pose, leg: Pick<Leg, 'hip' | 'knee' | 'ankle'>): number {
  const up = sub(joints[leg.hip], joints[leg.knee])
  const down = sub(joints[leg.ankle], joints[leg.knee])
  const cosine = dot(up, down) / (length(up) * length(down))
  return 180 - Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI
}

export function isNormal (f: Footing, rest: number): boolean {
  if (f.falling || Math.abs(f.pelvis - rest) > PELVIS_BACK) return false
  const held = f.feet.filter(foot => foot.planted)
  const off = held.some(foot => foot.gap === null || Math.abs(foot.gap) > PLANTED_TOLERANCE)
  const hovering = f.feet.some(foot => !foot.planted && (foot.gap === null || foot.gap > SWING_CLEARANCE))
  const midAir = f.feet.every(foot => foot.gap === null || foot.gap > MID_AIR)
  return held.length > 0 && !off && !hovering && !midAir
}

export function recoverySeconds (frames: Footing[], landing: number, fps: number, rest: number): number {
  if (landing < 0) throw new Error('no landing to recover from')
  const lastBad = frames.findLastIndex((f, i) => i >= landing && !isNormal(f, rest))
  if (lastBad === frames.length - 1) return Infinity
  return lastBad < landing ? 0 : (lastBad + 1 - landing) / fps
}

export function landingFrame (frames: Array<{ falling: boolean }>): number {
  const fell = frames.findIndex(f => f.falling)
  const at = frames.findIndex((f, i) => i > fell && !f.falling)
  return fell < 0 ? -1 : at
}

function median (values: number[]): number {
  return [...values].sort((a, b) => a - b)[values.length >> 1]
}

function footing (frame: WalkerFrame, pelvis: number): Footing {
  const feet = frame.feet.map(foot => {
    const gaps = foot.soles.map(([, y]) => y - FLOOR)
    return { planted: foot.planted, gap: gaps.length === 0 ? null : Math.min(...gaps) }
  })
  return { falling: frame.falling, pelvis, feet }
}

function dropOf (member: CastMember, height: number): Landing {
  const database = member.capture
  if (database === undefined) throw new Error(`${member.name} has no motion database`)
  const place = { x: 0, height: FLOOR }
  const walker = createWalker({ database, fps: FPS, random: random(SEED), ground: FLAT, place, yaw: EAST })
  const pelvis = (f: WalkerFrame): number => f.joints[member.rig.pelvis][1] - FLOOR
  const stood = Array.from({ length: Math.round(STANDING_SECONDS * FPS) }, () => pelvis(walker.step()))
  walker.dropIn(place, height)
  const frames = Array.from({ length: Math.round(SECONDS * FPS) }, () => walker.step())
  const landed = landingFrame(frames)
  if (landed < 0) throw new Error(`${member.name} did not land from ${height} m`)
  const reaction = frames.slice(landed, landed + Math.round(REACTION_SECONDS * FPS) + 1)
  const knees = reaction.flatMap(f => legsOf(member.rig).map(leg => kneeFlexion(f.joints, leg)))
  const lowest = Math.min(...reaction.map(pelvis))
  const depth = Math.min(...frames.flatMap(f => f.feet.flatMap(foot => foot.soles.map(([, y]) => y - FLOOR))))
  return {
    height,
    knee: Math.max(...knees),
    dip: 100 * (median(stood) - lowest),
    soleDepth: 100 * Math.max(0, -depth),
    recovery: recoverySeconds(frames.map(f => footing(f, pelvis(f))), landed, FPS, median(stood))
  }
}

export function landings (world: ReadWorld): Landings[] {
  const skinned = world.cast.filter((m, i) => m.capture !== undefined && world.looks[i].skin !== undefined)
  return skinned.map(member => ({ name: member.name, drops: DROP_HEIGHTS.map(h => dropOf(member, h)) }))
}
