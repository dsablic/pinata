import { legPhases, legsOf, stride } from '../formats/rig.ts'
import type { Mannequin } from '../formats/mannequin.ts'
import type { Gait, Leg, Rig } from '../formats/rig.ts'
import { toWorld } from '../sim/body.ts'
import { smoothstep } from '../math/ease.ts'
import { sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { chainLength, footRadii, soleHeight } from './pose.ts'
import type { Pose } from './pose.ts'
import type { RootState } from './script.ts'

export type FootState = {
  side: 'left' | 'right'
  ankle: Vec3
  toeYaw: number
  planted: boolean
  lift: number
  toePitch: number
  surfacePitch?: number
}
export type GaitFrame = {
  root: RootState
  pelvisOffset: Vec3
  feet: FootState[]
  armSwings: number[]
  phase: number
  pelvisPitch?: number
}

type Ground = (x: number, z: number) => number
type Options = {
  track: (t: number) => RootState
  rig: Rig
  rest: Pose
  mannequin: Mannequin
  duration: number
  fps: number
  ground?: Ground
  initial?: Array<{ ankle: Vec3, yaw: number, pitch?: number }>
}
type Plant = { phase: number, ankle: Vec3, yaw: number, pitch?: number }
type Placement = { ankle: Vec3, yaw: number, pitch?: number }
type Support = { ankle: Vec3, pitch?: number }
type FootShape = { behind: number, ahead: number }
type Foot = {
  side: 'left' | 'right'
  sign: number
  planted: Vec3
  toe: Vec3
  shape: FootShape
  restHip: Vec3
  reach: number
  partner: number
  plants: Plant[]
}
type Cycle = { initial: number[], delay: number[], settled: boolean[], partner: number[], start: number }
type Sample = { u: number, height: number }
type Lean = { base: number, pitch: number }

const TURN_CYCLES_PER_RADIAN = 2 / Math.PI
const REST_EPSILON = 1e-9
const PHASE_EPSILON = 1e-9
const REST_REACH_FRACTION = 0.99
const WALK_REACH_FRACTION = 0.96
const DROP_SMOOTHING_SECONDS = 0.04
const GROUND_SMOOTHING_SECONDS = 0.15
const CLEARANCE = 0.01
const MAX_SWING_EDGE = 0.25
const FOOTPRINT_SAMPLES = 9
const SURFACE_EPSILON = 1e-6
const TREAD_NUDGE = 0.01
const NUDGE_FRACTION = 0.4
const MAX_SURFACE_GRADE = Math.tan(60 * Math.PI / 180)

function swingEdge (stepHeight: number): number {
  return Math.min(MAX_SWING_EDGE, Math.asin(Math.min(1, CLEARANCE / stepHeight)) / Math.PI)
}

function swingEase (s: number, edge: number): number {
  return Math.min(1, Math.max(0, (s - edge) / (1 - 2 * edge)))
}

function lateral (yaw: number): Vec3 {
  return [Math.cos(yaw), 0, -Math.sin(yaw)]
}

function ahead (yaw: number, distance: number): Vec3 {
  return distance === 0 ? [0, 0, 0] : [Math.sin(yaw) * distance, 0, Math.cos(yaw) * distance]
}

function turnedAtOrigin (local: Vec3, yaw: number): Vec3 {
  return toWorld(local, { position: [0, 0, 0], yaw, velocity: [0, 0, 0], angularVelocity: 0 })
}

export function horizontalSpeed (root: RootState): number {
  return Math.hypot(root.velocity[0], root.velocity[2])
}

function isAtRest (root: RootState): boolean {
  return horizontalSpeed(root) < REST_EPSILON && Math.abs(root.angularVelocity) < REST_EPSILON
}

function lastPlant (foot: Foot): Plant {
  return foot.plants[foot.plants.length - 1]
}

function windowAround (values: number[], i: number, radius: number): number[] {
  return values.slice(Math.max(0, i - radius), i + radius + 1)
}

function smoothed (values: number[], radius: number): number[] {
  return values.map((_, i) => {
    const window = windowAround(values, i, radius)
    return window.reduce((sum, v) => sum + v, 0) / window.length
  })
}

function smoothDrops (needed: number[], radius: number): number[] {
  return smoothed(needed.map((_, i) => Math.min(...windowAround(needed, i, radius))), radius)
}

function meanOf (values: number[]): number | undefined {
  return values.length === 0 ? undefined : values.reduce((sum, v) => sum + v, 0) / values.length
}

function partnerOf (legs: Leg[], rest: Pose, leg: number): number {
  const mine = legs[leg]
  const across = legs.map((_, i) => i).filter(i => legs[i].side !== mine.side)
  const gap = (i: number): number => Math.abs(rest[legs[i].hip][2] - rest[mine.hip][2])
  return across.reduce((a, b) => gap(b) < gap(a) ? b : a)
}

function cycleOf (rig: Rig, rest: Pose): Cycle {
  const phases = legPhases(rig)
  const legs = legsOf(rig)
  const { stanceFraction } = rig.gait
  const behind = (from: number, to: number): number => from === to ? 0 : (phases[from] - phases[to] + 1) % 1
  const delay = phases.map((_, f) => Math.min(...phases.map((__, g) => stanceFraction - behind(f, g))))
  const settled = delay.map(d => d >= -PHASE_EPSILON)
  const candidates = phases.map((_, f) => f).filter(f => settled[f] || !settled.some(Boolean))
  const first = candidates.reduce((a, b) => phases[b] < phases[a] ? b : a)
  return {
    initial: phases.map((_, g) => phases[first] - behind(first, g)),
    delay: delay.map(d => Math.max(0, d)),
    settled,
    partner: phases.map((_, f) => partnerOf(legs, rest, f)),
    start: phases[first] + Math.max(0, delay[first])
  }
}

function standingPhase (cycle: Cycle, phase: number): number {
  const events = cycle.initial.flatMap((first, foot) => {
    const next = first + Math.floor(phase + PHASE_EPSILON / 2 - first) + 1
    return [0, 1, 2].map(cycles => ({ foot, landing: next + cycles }))
  }).sort((a, b) => a.landing - b.landing || a.foot - b.foot)
  const pairs = new Set(cycle.partner.map((partner, foot) => Math.min(foot, partner)))
  const seen = new Set<number>()
  for (const { foot, landing } of events) {
    seen.add(Math.min(foot, cycle.partner[foot]))
    if (seen.size === pairs.size && (cycle.settled[foot] || !cycle.settled.some(Boolean))) {
      return landing + cycle.delay[foot]
    }
  }
  return events[events.length - 1].landing
}

function samplePhase (options: Options, count: number, cycle: Cycle): number[] {
  const { track, rig, fps } = options
  const settleRate = rig.gait.referenceSpeed / rig.gait.strideLength
  const phase = [cycle.start]
  let previous = track(0)
  let dirty = false
  let target = 0
  for (let i = 1; i < count; i++) {
    const root = track(i / fps)
    const distance = Math.hypot(root.position[0] - previous.position[0], root.position[2] - previous.position[2])
    const turn = Math.abs(root.yaw - previous.yaw)
    let p = phase[i - 1]
    if (distance + turn > REST_EPSILON) {
      p += Math.max(distance / stride(rig.gait, distance * fps), turn * TURN_CYCLES_PER_RADIAN)
      dirty = true
      target = -1
    } else if (dirty) {
      if (target < 0) target = standingPhase(cycle, p)
      p = Math.min(target, p + settleRate / fps)
      if (p === target) dirty = false
    }
    phase.push(p)
    previous = root
  }
  return phase
}

function timeAtPhase (phase: number[], fps: number, target: number): number {
  const last = phase.length - 1
  if (target <= phase[0]) return 0
  if (target > phase[last]) return last / fps
  let lo = 0
  let hi = last
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (phase[mid] >= target) hi = mid
    else lo = mid
  }
  return (lo + (target - phase[lo]) / (phase[hi] - phase[lo])) / fps
}

function footprint (ankle: Vec3, toe: Vec3, shape: FootShape, yaw: number, ground: Ground): Sample[] {
  const reach = turnedAtOrigin(toe, yaw)
  return Array.from({ length: FOOTPRINT_SAMPLES }, (_, i) => {
    const u = -shape.behind + (1 + shape.behind + shape.ahead) * i / (FOOTPRINT_SAMPLES - 1)
    return { u, height: ground(ankle[0] + reach[0] * u, ankle[2] + reach[2] * u) }
  })
}

function lineSlope (samples: Sample[]): number {
  const first = samples[0]
  const last = samples[samples.length - 1]
  return (last.height - first.height) / (last.u - first.u)
}

function onLine (ankle: Vec3, samples: Sample[]): Vec3 {
  const slope = lineSlope(samples)
  const line = (u: number): number => samples[0].height + slope * (u - samples[0].u)
  const above = Math.max(0, ...samples.map(s => s.height - line(s.u)))
  return [ankle[0], ankle[1] + line(0) + above, ankle[2]]
}

function crossesStairEdge (samples: Sample[], run: number): boolean {
  const spacing = (samples[1].u - samples[0].u) * run
  return samples.some((s, i) => i > 0 && Math.abs(s.height - samples[i - 1].height) > MAX_SURFACE_GRADE * spacing)
}

function onOneTread (ankle: Vec3, yaw: number, toe: Vec3, shape: FootShape, ground: Ground): Support | undefined {
  const along = turnedAtOrigin(toe, yaw)
  const length = Math.hypot(along[0], along[2])
  const limit = NUDGE_FRACTION * length * (1 + shape.behind + shape.ahead)
  for (let i = 1; i * TREAD_NUDGE <= limit; i++) {
    for (const sign of [1, -1]) {
      const d = sign * i * TREAD_NUDGE / length
      const moved: Vec3 = [ankle[0] + along[0] * d, ankle[1], ankle[2] + along[2] * d]
      const heights = footprint(moved, toe, shape, yaw, ground).map(s => s.height)
      if (heights.every(h => Math.abs(h - heights[0]) < SURFACE_EPSILON)) {
        return { ankle: [moved[0], moved[1] + heights[0], moved[2]], pitch: 0 }
      }
    }
  }
  return undefined
}

function support (ground: Ground | undefined, ankle: Vec3, yaw: number, toe: Vec3, shape: FootShape): Support {
  if (ground === undefined) return { ankle }
  const run = Math.hypot(toe[0], toe[2])
  const samples = footprint(ankle, toe, shape, yaw, ground)
  if (!crossesStairEdge(samples, run) && run > 0) {
    return { ankle: onLine(ankle, samples), pitch: Math.atan2(lineSlope(samples), run) }
  }
  return onOneTread(ankle, yaw, toe, shape, ground) ??
    { ankle: [ankle[0], ankle[1] + Math.max(...samples.map(s => s.height)), ankle[2]], pitch: 0 }
}

function initialPlant (options: Options, index: number, phase: number, start: RootState, foot: Foot): Plant {
  const given = options.initial?.[index]
  if (given === undefined) {
    const placed = support(options.ground, toWorld(foot.planted, start), start.yaw, foot.toe, foot.shape)
    return { phase, yaw: start.yaw, ...placed }
  }
  return { phase, ankle: given.ankle, yaw: given.yaw, ...(given.pitch === undefined ? {} : { pitch: given.pitch }) }
}

function createFoot (options: Options, leg: Leg, index: number, cycle: Cycle, start: RootState): Foot {
  const { rest, mannequin } = options
  const restAnkle = rest[leg.ankle]
  const toe = sub(rest[leg.toe], restAnkle)
  const length = Math.hypot(toe[0], toe[1], toe[2])
  const radii = footRadii(leg, mannequin)
  const foot: Foot = {
    side: leg.side,
    sign: leg.side === 'left' ? 1 : -1,
    planted: [restAnkle[0], restAnkle[1] - soleHeight(leg, rest, mannequin), restAnkle[2]],
    toe,
    shape: { behind: radii.ankle / length, ahead: radii.toe / length },
    restHip: rest[leg.hip],
    reach: chainLength(leg.chain, rest),
    partner: cycle.partner[index],
    plants: []
  }
  foot.plants.push(initialPlant(options, index, cycle.initial[index], start, foot))
  return foot
}

function landingOrder (cycle: Cycle, phase: number[]): Array<{ index: number, landing: number }> {
  const last = phase[phase.length - 1] + 1 + PHASE_EPSILON
  return cycle.initial.flatMap((first, index) => {
    const found: Array<{ index: number, landing: number }> = []
    for (let cycles = 1; first + cycles <= last; cycles++) found.push({ index, landing: first + cycles })
    return found
  }).sort((a, b) => a.landing - b.landing || a.index - b.index)
}

function besidePartner (options: Options, foot: Foot, partner: Foot, yaw: number): Placement {
  const { gait } = options.rig
  const side = lateral(yaw)
  const partnerPlant = lastPlant(partner)
  const beside = partnerPlant.ankle
  const gap = gait.lateral === 'rest' ? foot.planted[0] - partner.planted[0] : foot.sign * gait.footSpacing
  const ankle: Vec3 = [beside[0] + side[0] * gap, beside[1], beside[2] + side[2] * gap]
  if (options.ground === undefined) return { ankle, yaw }
  const below = support(options.ground, [beside[0], 0, beside[2]], partnerPlant.yaw, partner.toe, partner.shape)
  const level = beside[1] - below.ankle[1]
  const placed = support(options.ground, [ankle[0], level, ankle[2]], yaw, foot.toe, foot.shape)
  return { ankle: placed.ankle, yaw, pitch: placed.pitch }
}

function underBody (options: Options, foot: Foot, middle: RootState): Placement {
  const { gait } = options.rig
  const rested = gait.lateral === 'rest'
  const side = lateral(middle.yaw)
  const offset = rested ? foot.planted[0] : foot.sign * gait.footSpacing / 2
  const forward = ahead(middle.yaw, rested ? foot.planted[2] : foot.restHip[2])
  const placed = support(options.ground, [
    middle.position[0] + side[0] * offset + forward[0],
    middle.position[1] + foot.planted[1],
    middle.position[2] + side[2] * offset + forward[2]
  ], middle.yaw, foot.toe, foot.shape)
  return { ankle: placed.ankle, yaw: middle.yaw, pitch: placed.pitch }
}

function buildFeet (options: Options, phase: number[], cycle: Cycle): Foot[] {
  const { track, rig, fps } = options
  const start = track(0)
  const feet = legsOf(rig).map((leg, index) => createFoot(options, leg, index, cycle, start))
  for (const { index, landing } of landingOrder(cycle, phase)) {
    const foot = feet[index]
    const landed = track(timeAtPhase(phase, fps, landing))
    const { ankle, yaw, pitch } = isAtRest(landed)
      ? besidePartner(options, foot, feet[foot.partner], landed.yaw)
      : underBody(options, foot, track(timeAtPhase(phase, fps, landing + rig.gait.stanceFraction / 2)))
    foot.plants.push(pitch === undefined ? { phase: landing, ankle, yaw } : { phase: landing, ankle, yaw, pitch })
  }
  return feet
}

function clearance (
  foot: Foot,
  ankle: Vec3,
  swing: { yaw: number, pitch: number },
  ground: Ground,
  stepHeight: number,
  lift: number
): number {
  const run = Math.hypot(foot.toe[0], foot.toe[2])
  const rise = Math.tan(swing.pitch) * run
  const highest = Math.max(...footprint(ankle, foot.toe, foot.shape, swing.yaw, ground).map(s => s.height - rise * s.u))
  return highest + foot.planted[1] + stepHeight * lift
}

function plantedState (foot: Foot, plant: Plant): FootState {
  const state: FootState = {
    side: foot.side, ankle: plant.ankle, toeYaw: plant.yaw, planted: true, lift: 0, toePitch: 0
  }
  if (plant.pitch !== undefined) state.surfacePitch = plant.pitch
  return state
}

function footAt (foot: Foot, phase: number, options: Options): FootState {
  const { stanceFraction, stepHeight } = options.rig.gait
  let k = 0
  while (k + 1 < foot.plants.length && foot.plants[k + 1].phase <= phase) k++
  const plant = foot.plants[k]
  const next = foot.plants[k + 1]
  const liftOff = plant.phase + stanceFraction
  if (next === undefined || phase <= liftOff) return plantedState(foot, plant)
  const s = Math.min(1, (phase - liftOff) / (1 - stanceFraction))
  const e = swingEase(s, swingEdge(stepHeight))
  const h = smoothstep(e)
  const lift = Math.sin(Math.PI * s)
  const ankle: Vec3 = [
    plant.ankle[0] + (next.ankle[0] - plant.ankle[0]) * h,
    plant.ankle[1] + (next.ankle[1] - plant.ankle[1]) * h + stepHeight * lift,
    plant.ankle[2] + (next.ankle[2] - plant.ankle[2]) * h
  ]
  const toeYaw = plant.yaw + (next.yaw - plant.yaw) * h
  const { ground } = options
  const surfacePitch = plant.pitch === undefined ? undefined : plant.pitch + ((next.pitch ?? 0) - plant.pitch) * h
  if (ground !== undefined) {
    const swing = { yaw: toeYaw, pitch: surfacePitch ?? 0 }
    ankle[1] = Math.max(ankle[1], clearance(foot, ankle, swing, ground, stepHeight, lift))
  }
  return {
    side: foot.side,
    ankle,
    toeYaw,
    planted: false,
    lift,
    toePitch: Math.sin(Math.PI * e),
    ...(surfacePitch === undefined ? {} : { surfacePitch })
  }
}

function neededOffset (foot: Foot, state: FootState, root: RootState, fraction: number, base: number): number {
  const lifted = toWorld(foot.restHip, root)
  const hip: Vec3 = base === 0 ? lifted : [lifted[0], lifted[1] + base, lifted[2]]
  const run = Math.hypot(state.ankle[0] - hip[0], state.ankle[2] - hip[2])
  const limit = foot.reach * fraction
  const room = Math.sqrt(Math.max(0, limit * limit - run * run))
  return room - (hip[1] - state.ankle[1])
}

function groundLeans (options: Options, feet: Foot[], stances: FootState[][]): Lean[] | undefined {
  if (options.ground === undefined) return undefined
  const depths = legsOf(options.rig).map(leg => options.rest[leg.hip][2])
  const middle = (Math.max(...depths) + Math.min(...depths)) / 2
  const span = Math.max(...depths) - Math.min(...depths)
  const front = depths.map(d => d > middle)
  const hind = depths.map(d => d < middle)
  let base = 0
  let pitch = 0
  const raw = stances.map(states => {
    const soles = states.map((state, k) => state.planted ? state.ankle[1] - feet[k].planted[1] : undefined)
    const planted = soles.filter((v): v is number => v !== undefined)
    base = meanOf(planted) ?? base
    const ahead = meanOf(soles.filter((v, k): v is number => v !== undefined && front[k]))
    const behind = meanOf(soles.filter((v, k): v is number => v !== undefined && hind[k]))
    if (span > SURFACE_EPSILON && ahead !== undefined && behind !== undefined) pitch = Math.atan2(ahead - behind, span)
    return { base, pitch }
  })
  const radius = Math.round(GROUND_SMOOTHING_SECONDS * options.fps)
  const bases = smoothed(raw.map(r => r.base), radius)
  const pitches = smoothed(raw.map(r => r.pitch), radius)
  return bases.map((b, i) => ({ base: b, pitch: pitches[i] }))
}

export function pitchLift (point: Vec3, pelvis: Vec3, pitch: number): number {
  const y = point[1] - pelvis[1]
  const z = point[2] - pelvis[2]
  return y * Math.cos(pitch) + z * Math.sin(pitch) - y
}

function stepEffort (root: RootState, ease: number, gait: Gait): number {
  const referenceCadence = gait.referenceSpeed / gait.strideLength
  return Math.max(ease, Math.min(1, Math.abs(root.angularVelocity) * TURN_CYCLES_PER_RADIAN / referenceCadence))
}

export function planGait (options: Options): GaitFrame[] {
  const { track, rig, fps } = options
  const { gait } = rig
  const count = Math.round(options.duration * fps) + 1
  const cycle = cycleOf(rig, options.rest)
  const phase = samplePhase(options, count, cycle)
  const feet = buildFeet(options, phase, cycle)
  const roots = phase.map((_, i) => track(i / fps))
  const stances = phase.map(p => feet.map(foot => footAt(foot, p, options)))
  const eases = roots.map(root => Math.min(1, horizontalSpeed(root) / gait.referenceSpeed))
  const steps = roots.map((root, i) => stepEffort(root, eases[i], gait))
  const leans = groundLeans(options, feet, stances)
  const pelvis = options.rest[rig.pelvis]
  const needed = stances.map((states, i) => {
    const fraction = REST_REACH_FRACTION + (WALK_REACH_FRACTION - REST_REACH_FRACTION) * steps[i]
    return Math.min(0, ...feet.map((foot, k) => {
      const lean = leans?.[i]
      const base = lean === undefined ? 0 : lean.base + pitchLift(foot.restHip, pelvis, lean.pitch)
      return neededOffset(foot, states[k], roots[i], fraction, base)
    }))
  })
  const drops = smoothDrops(needed, Math.round(DROP_SMOOTHING_SECONDS * fps))
  const offsets = legPhases(rig)
  return roots.map((root, i) => {
    const ease = eases[i]
    const bob = ease === 0 ? 0 : -gait.bobAmplitude * Math.cos(4 * Math.PI * phase[i]) * ease
    const offset = Math.min(bob, drops[i])
    const lean = leans?.[i]
    const frame: GaitFrame = {
      root,
      pelvisOffset: [0, lean === undefined ? offset : lean.base + offset, 0],
      feet: stances[i],
      armSwings: offsets.map(leg => gait.armSwingDegrees * Math.cos(2 * Math.PI * (phase[i] - leg)) * ease),
      phase: phase[i]
    }
    if (lean !== undefined) frame.pelvisPitch = lean.pitch
    return frame
  })
}
