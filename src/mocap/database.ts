import { add, length, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { legsOf } from '../formats/rig.ts'
import {
  aimedDirections, assemble, clipScale, hierarchyOf, legLength, retargetRotations, sourceLegLength, unliftedClearance
} from './retarget.ts'
import type { BodyFrame, Hierarchy, RetargetOptions } from './retarget.ts'
import { GAITS, PERFORMANCE_KINDS } from './clip.ts'
import { closedCycle, cycleOf, mirrorOf, symmetricCycle } from './cycle.ts'
import { loopedFrames } from './performance.ts'
import { applyStyle } from './style.ts'
import { composedAttack } from './attack.ts'
import type { AttackKind, Clip, Gait, PerformanceKind } from './clip.ts'
import { turnBetween, turnToLocal } from '../world/yaw.ts'

export type MotionEntry = {
  name: string
  fps: number
  frames: BodyFrame[]
  ankles: Vec3[][]
  endsAtRest: boolean
  stops: boolean
  starts: boolean
  turns: boolean
  gait?: Gait
  travel?: Vec3
}
export type GaitSpeeds = Record<Gait, number>
export type JumpTake = {
  name: string
  fps: number
  frames: BodyFrame[]
  start: number
  launch: number
  land: number
  settle: number
  run: number
  apex: number
}
export type PerformanceTake = {
  name: string
  kind: PerformanceKind
  fps: number
  frames: BodyFrame[]
  attack?: AttackKind
}
export type JumpPhases = { start: number, crouch: number, launch: number, land: number, settle: number }
export type Intent = 'brake' | 'start' | 'turn'
export type Candidate = { entry: number, frame: number, feature: number[], intent?: Intent }
export type MotionDatabase = {
  entries: MotionEntry[]
  jumpTakes: JumpTake[]
  performances: PerformanceTake[]
  candidates: Candidate[]
  scales: number[]
  hierarchy: Hierarchy
  options: RetargetOptions
  speeds: GaitSpeeds
  pace: number
}

export const HORIZONS = [8, 16]
const REST_SPEED = 0.15
const REST_SECONDS = 0.25
const CROUCH_DROP_SHARE = 0.03
const LEVEL_FRAMES = 3
const LEAD_FRAMES = 3
const DESCENT_SHARE = 0.01
const GRAVITY = 9.81
const TURNING_RADIANS = Math.PI / 4
export const REFERENCE_SPEEDS: GaitSpeeds = { walk: 1.1, run: 3 }

export function featureOf (
  path: Array<{ position: Vec3, yaw: number }>,
  velocity: Vec3,
  ankles: Vec3[],
  ankleVelocities: Vec3[]
): number[] {
  const [now, ...ahead] = path
  const feature: number[] = []
  for (const future of ahead) {
    const offset = turnToLocal(sub(future.position, now.position), now.yaw)
    const turn = turnBetween(now.yaw, future.yaw)
    feature.push(offset[0], offset[2], Math.sin(turn), Math.cos(turn))
  }
  const moving = turnToLocal(velocity, now.yaw)
  feature.push(moving[0], moving[2])
  ankles.forEach((ankle, k) => feature.push(ankle[0], ankle[2], ankleVelocities[k][0], ankleVelocities[k][2]))
  return feature
}

export function featureWeights (legs: number): number[] {
  const weights: number[] = []
  for (let h = 0; h < HORIZONS.length; h++) weights.push(1, 1, 1.5, 1.5)
  weights.push(1, 1)
  for (let k = 0; k < legs; k++) weights.push(1.5, 1.5, 0.75, 0.75)
  return weights
}

function anklesOf (frames: BodyFrame[], options: RetargetOptions, hierarchy: Hierarchy): Vec3[][] {
  const legs = legsOf(options.rig)
  return frames.map(frame => {
    const { pose } = assemble(frame, options, hierarchy)
    return legs.map(leg => pose[leg.ankle])
  })
}

function looped (clip: Clip, options: RetargetOptions): { frames: BodyFrame[], travel?: Vec3 } {
  if (clip.loop !== true) return { frames: retargetRotations(clip, options) }
  const plain = retargetRotations(clip, { ...options, style: undefined })
  const closed = closedCycle(plain, cycleOf(plain, clip.fps), clip.fps)
  const mirror = mirrorOf(options.rig, aimedDirections(options))
  const cycle = mirror === undefined ? closed : symmetricCycle(closed, mirror, clip.fps)
  if (options.style !== undefined) applyStyle(cycle.frames, options.style)
  return cycle
}

function entryOf (clip: Clip, options: RetargetOptions, hierarchy: Hierarchy): MotionEntry {
  const { frames, travel } = looped(clip, options)
  const ankles = anklesOf(frames, options, hierarchy)
  const tail = frames.slice(-Math.max(1, Math.round(REST_SECONDS * clip.fps)))
  const endsAtRest = travel === undefined && tail.every(frame => length(frame.root.velocity) < REST_SPEED)
  const stops = endsAtRest && length(frames[0].root.velocity) >= REST_SPEED
  const starts = travel === undefined && !endsAtRest && length(frames[0].root.velocity) < REST_SPEED
  const turns = Math.abs(turnBetween(frames[0].root.yaw, frames[frames.length - 1].root.yaw)) > TURNING_RADIANS
  const gait = clip.gait === undefined ? {} : { gait: clip.gait }
  return {
    name: clip.name, fps: clip.fps, frames, ankles, endsAtRest, stops, starts, turns, ...gait, ...(travel && { travel })
  }
}

export function lapOf (entry: MotionEntry, frame: number): { frame: number, lap: number } {
  if (entry.travel === undefined) return { frame, lap: 0 }
  const last = entry.frames.length - 1
  const lap = Math.floor(frame / last)
  return { frame: frame - lap * last, lap }
}

export function rootAt (entry: MotionEntry, frame: number): BodyFrame['root'] {
  const { frame: i, lap } = lapOf(entry, frame)
  const root = entry.frames[Math.min(i, entry.frames.length - 1)].root
  return lap === 0 ? root : { ...root, position: add(root.position, scale(entry.travel as Vec3, lap)) }
}

function intentOf (entry: MotionEntry, frame: BodyFrame): Intent | undefined {
  if (entry.turns) return 'turn'
  if (length(frame.root.velocity) < REST_SPEED) return undefined
  return entry.stops ? 'brake' : entry.starts ? 'start' : undefined
}

function candidatesOf (entries: MotionEntry[]): Candidate[] {
  const candidates: Candidate[] = []
  const ahead = HORIZONS[HORIZONS.length - 1]
  entries.forEach((entry, e) => {
    const last = entry.frames.length - 1
    entry.frames.forEach((frame, i) => {
      if (entry.travel !== undefined ? i === last : !entry.endsAtRest && i + ahead > last) return
      const reach = (h: number): number => entry.travel !== undefined ? i + h : Math.min(last, i + h)
      const path = [0, ...HORIZONS].map(h => rootAt(entry, reach(h)))
      const velocities = entry.ankles[i].map((_, k) => ankleVelocity(entry, i, k))
      const feature = featureOf(path, frame.root.velocity, entry.ankles[i], velocities)
      const intent = intentOf(entry, frame)
      candidates.push({ entry: e, frame: i, feature, ...(intent && { intent }) })
    })
  })
  return candidates
}

function featureSpreads (candidates: Candidate[]): number[] {
  const dims = candidates[0]?.feature.length ?? 0
  return Array.from({ length: dims }, (_, d) => {
    const values = candidates.map(c => c.feature[d])
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const spread = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length)
    return spread > 1e-6 ? spread : 1
  })
}

function descentStart (heights: number[], launch: number): number {
  const lowest = heights.slice(0, launch).reduce((low, h, i) => h < heights[low] ? i : low, 0)
  const ripple = DESCENT_SHARE * heights[0]
  let top = lowest
  while (top > 0 && heights[top - 1] >= heights[top]) top--
  let last = top
  for (let i = top; i <= lowest; i++) if (heights[i] >= heights[top] - ripple) last = i
  return Math.max(0, last - LEAD_FRAMES)
}

export function jumpPhases (contacts: boolean[][], heights: number[]): JumpPhases {
  const crouch = heights.findIndex(height => height < heights[0] * (1 - CROUCH_DROP_SHARE))
  const launch = contacts.findIndex((down, i) => i > crouch && crouch >= 0 && down.every(d => !d))
  const land = contacts.findIndex((down, i) => i > launch && launch >= 0 && down.some(d => d))
  if (crouch < 0 || launch < 0 || land < 0) throw new Error('a jump take must crouch, fly and land')
  const risen = heights.findIndex((height, i) => i > land && height >= heights[0] * (1 - CROUCH_DROP_SHARE))
  return { start: descentStart(heights, launch), crouch, launch, land, settle: risen < 0 ? heights.length - 1 : risen }
}

function levelFlight (frames: BodyFrame[], phases: JumpPhases, options: RetargetOptions, hierarchy: Hierarchy): void {
  frames.forEach((frame, i) => {
    const away = i < phases.launch ? phases.launch - i : i - phases.land + 1
    const level = i >= phases.launch && i < phases.land ? 1 : Math.max(0, 1 - away / (LEVEL_FRAMES + 1))
    if (level === 0) return
    const flat = unliftedClearance(frame.rotations, options, hierarchy)
    for (const side of ['left', 'right'] as const) {
      frame.clearance[side] += (flat[side] - frame.clearance[side]) * level
    }
  })
}

function jumpTakeOf (clip: Clip, options: RetargetOptions, hierarchy: Hierarchy): JumpTake {
  const ratio = clipScale(clip, options)
  const frames = retargetRotations(clip, options)
  const heights = clip.frames.map(frame => ratio * frame.root[1])
  const phases = jumpPhases(frames.map(frame => frame.contact), heights)
  levelFlight(frames, phases, options, hierarchy)
  const [from, to] = [frames[phases.launch].root.position, frames[phases.land].root.position]
  const flight = heights.slice(phases.launch, phases.land)
  return {
    name: clip.name,
    fps: clip.fps,
    frames,
    start: phases.start,
    launch: phases.launch,
    land: phases.land,
    settle: phases.settle,
    run: Math.hypot(to[0] - from[0], to[2] - from[2]),
    apex: Math.max(...flight) - heights[phases.launch]
  }
}

type Performed = Clip & { kind: PerformanceKind }

function isPerformance (clip: Clip): clip is Performed {
  return PERFORMANCE_KINDS.some(kind => kind === clip.kind)
}

function performanceOf (clip: Performed, options: RetargetOptions): PerformanceTake {
  const style = clip.kind === 'attack' ? {} : { style: options.style }
  const frames = retargetRotations(clip, { ...options, ...style })
  const played = clip.kind === 'idle' ? loopedFrames(frames) : frames
  const attack = clip.kind === 'attack' ? { attack: clip.attack ?? 'punch' } : {}
  return { name: clip.name, kind: clip.kind, fps: clip.fps, frames: played, ...attack }
}

function performancesOf (clips: Clip[], options: RetargetOptions, attack: AttackKind): PerformanceTake[] {
  const takes = clips.filter(isPerformance).map(clip => performanceOf(clip, options))
  const others = takes.filter(take => take.kind !== 'attack')
  const own = takes.find(take => take.attack === attack) ?? composedAttack(others, options, attack)
  return own === undefined ? others : [...others, own]
}

export function gaitSpeeds (clips: Clip[], options: RetargetOptions): GaitSpeeds {
  const speed = (gait: Gait): number => {
    const loops = clips.filter(clip => clip.gait === gait && clip.loop === true)
    if (loops.length === 0) return REFERENCE_SPEEDS[gait]
    const froude = mean(loops.map(clip => clipSpeed(clip) ** 2 / (GRAVITY * sourceLegLength(clip, options))))
    return Math.sqrt(froude * GRAVITY * legLength(options))
  }
  return Object.fromEntries(GAITS.map(gait => [gait, speed(gait)])) as GaitSpeeds
}

function mean (values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

export function wholeLapSpeed (database: MotionDatabase, gait: Gait, fps: number, shift = 0): number {
  const speed = database.speeds[gait]
  const laps = database.entries.flatMap(entry => {
    if (entry.gait !== gait || entry.travel === undefined) return []
    const lap = Math.hypot(entry.travel[0], entry.travel[2])
    return [{ lap, speed: lap * entry.fps * database.pace / (entry.frames.length - 1) }]
  })
  if (laps.length === 0) return speed
  const { lap } = laps.reduce((a, b) => Math.abs(b.speed - speed) < Math.abs(a.speed - speed) ? b : a)
  return lap * fps / Math.max(1, Math.round(lap * fps / speed) + shift)
}

export function paceOf (clips: Clip[], options: RetargetOptions): number {
  const loops = clips.filter(clip => clip.loop === true)
  if (loops.length === 0) return 1
  const similar = Math.sqrt(mean(loops.map(clip => sourceLegLength(clip, options))) / legLength(options))
  return similar / (options.style?.stride ?? 1)
}

export function clipSpeed (clip: Clip): number {
  const [first, last] = [clip.frames[0].root, clip.frames[clip.frames.length - 1].root]
  return Math.hypot(last[0] - first[0], last[2] - first[2]) / ((clip.frames.length - 1) / clip.fps)
}

export function buildDatabase (clips: Clip[], options: RetargetOptions, attack: AttackKind = 'punch'): MotionDatabase {
  const hierarchy = hierarchyOf(options.rig, options.map)
  const walking = clips.filter(clip => clip.kind === undefined)
  const entries = walking.map(clip => entryOf(clip, options, hierarchy))
  const jumpTakes = clips.filter(clip => clip.kind === 'jump').map(clip => jumpTakeOf(clip, options, hierarchy))
  const performances = performancesOf(clips, options, attack)
  const candidates = candidatesOf(entries)
  return {
    entries,
    jumpTakes,
    performances,
    candidates,
    scales: featureSpreads(candidates),
    hierarchy,
    options,
    speeds: gaitSpeeds(walking, options),
    pace: paceOf(walking, options)
  }
}

export function ankleVelocity (entry: MotionEntry, frame: number, leg: number): Vec3 {
  const wraps = entry.travel !== undefined && frame === 0
  const before = wraps ? entry.frames.length - 2 : Math.max(0, frame - 1)
  const after = Math.min(entry.frames.length - 1, frame + 1)
  if (after === before) return [0, 0, 0]
  const d = sub(entry.ankles[after][leg], entry.ankles[before][leg])
  const dt = (wraps ? 2 : after - before) / entry.fps
  return [d[0] / dt, d[1] / dt, d[2] / dt]
}
