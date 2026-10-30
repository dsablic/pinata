import { legPhases, legsOf, stride } from '../formats/rig.ts'
import type { Mannequin } from '../formats/mannequin.ts'
import type { Leg, Rig } from '../formats/rig.ts'
import { toWorld } from '../sim/body.ts'
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
  /** Pitch of the surface the foot stands on, radians, toe up positive; absent on flat ground. */
  surfacePitch?: number
}
export type GaitFrame = {
  root: RootState
  pelvisOffset: Vec3
  feet: FootState[]
  armSwings: number[]
  phase: number
  /** Nose-up pitch of the body about the pelvis, radians, on terrain; absent on flat ground. */
  pelvisPitch?: number
}

type Options = {
  track: (t: number) => RootState
  rig: Rig
  rest: Pose
  mannequin: Mannequin
  duration: number
  fps: number
  /** Height of the walking surface under a point; absent, the ground is the plane y = 0. */
  ground?: (x: number, z: number) => number
}
type Plant = { phase: number, ankle: Vec3, yaw: number, pitch?: number }
type Foot = {
  side: 'left' | 'right'
  sign: number
  planted: Vec3
  /** The toe's offset from the ankle at rest, body-local, and how far the foot capsule reaches past each end. */
  toe: Vec3
  shape: FootShape
  restHip: Vec3
  reach: number
  partner: number
  plants: Plant[]
}
/** Fractions of the ankle-to-toe length that the foot capsule's ends reach behind the ankle and past the toe. */
type FootShape = { behind: number, ahead: number }
type Cycle = { initial: number[], delay: number[], settled: boolean[], partner: number[], start: number }

const TURN_CYCLES_PER_RADIAN = 2 / Math.PI
const REST_EPSILON = 1e-9
const PHASE_EPSILON = 1e-9
const REST_REACH_FRACTION = 0.99
const WALK_REACH_FRACTION = 0.96
const DROP_SMOOTHING_SECONDS = 0.04
const CLEARANCE = 0.01
const MAX_SWING_EDGE = 0.25

function smoothstep (x: number): number {
  return x * x * (3 - 2 * x)
}

function swingEdge (stepHeight: number): number {
  return Math.min(MAX_SWING_EDGE, Math.asin(Math.min(1, CLEARANCE / stepHeight)) / Math.PI)
}

function swingEase (s: number, edge: number): number {
  return Math.min(1, Math.max(0, (s - edge) / (1 - 2 * edge)))
}

function lateral (yaw: number): Vec3 {
  return [Math.cos(yaw), 0, -Math.sin(yaw)]
}

function horizontalSpeed (root: RootState): number {
  return Math.hypot(root.velocity[0], root.velocity[2])
}

function isAtRest (root: RootState): boolean {
  return horizontalSpeed(root) < REST_EPSILON && Math.abs(root.angularVelocity) < REST_EPSILON
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

/**
 * The phase at which a stopped walker stands still: once every left-right pair of feet has had a landing, at the
 * first landing after which no foot has lifted off yet.
 */
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

function ahead (yaw: number, distance: number): Vec3 {
  return distance === 0 ? [0, 0, 0] : [Math.sin(yaw) * distance, 0, Math.cos(yaw) * distance]
}

function buildFeet (options: Options, phase: number[], cycle: Cycle): Foot[] {
  const { track, rig, rest, mannequin, fps, ground } = options
  const support = (ankle: Vec3, yaw: number, toe: Vec3, shape: FootShape): { ankle: Vec3, pitch?: number } => {
    if (ground === undefined) return { ankle }
    const samples = footprint(ankle, toe, shape, yaw, ground)
    const heel = ground(ankle[0], ankle[2])
    const first = samples[0]
    const last = samples[samples.length - 1]
    const slope = (last.height - first.height) / (last.u - first.u)
    const straight = samples.every(s => Math.abs(s.height - (first.height + slope * (s.u - first.u))) < SURFACE_EPSILON)
    const run = Math.hypot(toe[0], toe[2])
    if (straight && run > 0) {
      return { ankle: [ankle[0], ankle[1] + heel, ankle[2]], pitch: Math.atan2(slope, run) }
    }
    const along = toWorld(toe, { position: [0, 0, 0], yaw, velocity: [0, 0, 0], angularVelocity: 0 })
    const length = Math.hypot(along[0], along[2])
    const limit = length * (1 + shape.behind + shape.ahead)
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
    return { ankle: [ankle[0], ankle[1] + Math.max(...samples.map(s => s.height)), ankle[2]], pitch: 0 }
  }
  const { gait } = rig
  const start = track(0)
  const rested = gait.lateral === 'rest'
  const feet = legsOf(rig).map((leg, index): Foot => {
    const restAnkle = rest[leg.ankle]
    const planted: Vec3 = [restAnkle[0], restAnkle[1] - soleHeight(leg, rest, mannequin), restAnkle[2]]
    const toe = sub(rest[leg.toe], restAnkle)
    const length = Math.hypot(toe[0], toe[1], toe[2])
    const radii = footRadii(leg, mannequin)
    const shape: FootShape = { behind: radii.ankle / length, ahead: radii.toe / length }
    const initial: Plant = {
      phase: cycle.initial[index], yaw: start.yaw, ...support(toWorld(planted, start), start.yaw, toe, shape)
    }
    return {
      side: leg.side,
      sign: leg.side === 'left' ? 1 : -1,
      planted,
      toe,
      shape,
      restHip: rest[leg.hip],
      reach: chainLength(leg.chain, rest),
      partner: cycle.partner[index],
      plants: [initial]
    }
  })
  const last = phase[phase.length - 1] + 1 + PHASE_EPSILON
  const landings = cycle.initial.flatMap((first, index) => {
    const found: Array<{ index: number, landing: number }> = []
    for (let cycles = 1; first + cycles <= last; cycles++) found.push({ index, landing: first + cycles })
    return found
  }).sort((a, b) => a.landing - b.landing || a.index - b.index)
  for (const { index, landing } of landings) {
    const foot = feet[index]
    const landed = track(timeAtPhase(phase, fps, landing))
    let ankle: Vec3
    let yaw: number
    let pitch: number | undefined
    if (isAtRest(landed)) {
      const side = lateral(landed.yaw)
      const beside = feet[foot.partner].plants[feet[foot.partner].plants.length - 1].ankle
      const gap = rested ? foot.planted[0] - feet[foot.partner].planted[0] : foot.sign * gait.footSpacing
      ankle = [beside[0] + side[0] * gap, beside[1], beside[2] + side[2] * gap]
      yaw = landed.yaw
      if (ground !== undefined) {
        const partner = feet[foot.partner]
        const partnerYaw = partner.plants[partner.plants.length - 1].yaw
        const below = support([beside[0], 0, beside[2]], partnerYaw, partner.toe, partner.shape)
        const level = beside[1] - below.ankle[1]
        const placed = support([ankle[0], level, ankle[2]], yaw, foot.toe, foot.shape)
        ankle = placed.ankle
        pitch = placed.pitch
      }
    } else {
      const middle = track(timeAtPhase(phase, fps, landing + gait.stanceFraction / 2))
      const side = lateral(middle.yaw)
      const offset = rested ? foot.planted[0] : foot.sign * gait.footSpacing / 2
      const forward = ahead(middle.yaw, rested ? foot.planted[2] : foot.restHip[2])
      const placed = support([
        middle.position[0] + side[0] * offset + forward[0],
        middle.position[1] + foot.planted[1],
        middle.position[2] + side[2] * offset + forward[2]
      ], middle.yaw, foot.toe, foot.shape)
      ankle = placed.ankle
      pitch = placed.pitch
      yaw = middle.yaw
    }
    foot.plants.push(pitch === undefined ? { phase: landing, ankle, yaw } : { phase: landing, ankle, yaw, pitch })
  }
  return feet
}

/**
 * The lowest the swinging ankle may be: its sole above the highest ground under the foot by as much as the swing
 * rises over flat ground (stepHeight scaled by the lift, none at lift-off and touch-down).
 */
function clearance (
  foot: Foot,
  ankle: Vec3,
  yaw: number,
  ground: (x: number, z: number) => number,
  stepHeight: number,
  lift: number
): number {
  const highest = Math.max(...footprint(ankle, foot.toe, foot.shape, yaw, ground).map(s => s.height))
  return highest + foot.planted[1] + stepHeight * lift
}

function footAt (foot: Foot, phase: number, options: Options): FootState {
  const { stanceFraction, stepHeight } = options.rig.gait
  let k = 0
  while (k + 1 < foot.plants.length && foot.plants[k + 1].phase <= phase) k++
  const plant = foot.plants[k]
  const next = foot.plants[k + 1]
  const liftOff = plant.phase + stanceFraction
  if (next === undefined || phase <= liftOff) {
    const state: FootState = {
      side: foot.side, ankle: plant.ankle, toeYaw: plant.yaw, planted: true, lift: 0, toePitch: 0
    }
    if (plant.pitch !== undefined) state.surfacePitch = plant.pitch
    return state
  }
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
  if (ground !== undefined) ankle[1] = Math.max(ankle[1], clearance(foot, ankle, toeYaw, ground, stepHeight, lift))
  return {
    side: foot.side,
    ankle,
    toeYaw,
    planted: false,
    lift,
    toePitch: Math.sin(Math.PI * e),
    ...(plant.pitch === undefined ? {} : { surfacePitch: plant.pitch + ((next.pitch ?? 0) - plant.pitch) * h })
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

function smoothDrops (needed: number[], radius: number): number[] {
  const slice = (values: number[], i: number): number[] => values.slice(Math.max(0, i - radius), i + radius + 1)
  const eroded = needed.map((_, i) => Math.min(...slice(needed, i)))
  return eroded.map((_, i) => {
    const window = slice(eroded, i)
    return window.reduce((sum, v) => sum + v, 0) / window.length
  })
}

const FOOTPRINT_SAMPLES = 9

/** Ground heights under a foot, from the back of the heel to the front of the toe, evenly spaced. */
function footprint (
  ankle: Vec3,
  toe: Vec3,
  shape: FootShape,
  yaw: number,
  ground: (x: number, z: number) => number
): Array<{ u: number, height: number }> {
  const reach = toWorld(toe, { position: [0, 0, 0], yaw, velocity: [0, 0, 0], angularVelocity: 0 })
  return Array.from({ length: FOOTPRINT_SAMPLES }, (_, i) => {
    const u = -shape.behind + (1 + shape.behind + shape.ahead) * i / (FOOTPRINT_SAMPLES - 1)
    return { u, height: ground(ankle[0] + reach[0] * u, ankle[2] + reach[2] * u) }
  })
}

const GROUND_SMOOTHING_SECONDS = 0.15
const SURFACE_EPSILON = 1e-6
/** Step, in metres, of the search that moves a plant onto a single stair tread. */
const TREAD_NUDGE = 0.01

type Lean = { base: number, pitch: number }

function smoothed (values: number[], radius: number): number[] {
  return values.map((_, i) => {
    const window = values.slice(Math.max(0, i - radius), i + radius + 1)
    return window.reduce((sum, v) => sum + v, 0) / window.length
  })
}

/**
 * The body's lean on terrain per frame, smoothed: its base height (the mean ground under the hips) and its nose-up
 * pitch (from the ground under the front and the hind hips over their distance); undefined without ground or with
 * hips all at one depth.
 */
function groundLeans (options: Options, roots: RootState[]): Lean[] | undefined {
  const { ground } = options
  if (ground === undefined) return undefined
  const hips = legsOf(options.rig).map(leg => options.rest[leg.hip])
  const depths = hips.map(hip => hip[2])
  const [front, hind] = [Math.max(...depths), Math.min(...depths)]
  const radius = Math.round(GROUND_SMOOTHING_SECONDS * options.fps)
  const under = roots.map(root => hips.map(hip => toWorld(hip, root)).map(p => ground(p[0], p[2])))
  const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length
  const bases = smoothed(under.map(mean), radius)
  const pitches = smoothed(under.map(heights => {
    if (front - hind < SURFACE_EPSILON) return 0
    const at = (depth: number): number => mean(heights.filter((_, k) => depths[k] === depth))
    return Math.atan2(at(front) - at(hind), front - hind)
  }), radius)
  return bases.map((base, i) => ({ base, pitch: pitches[i] }))
}

/** How much a body pitch lifts a rest point, rotating it about the pelvis (nose up for a positive pitch). */
export function pitchLift (point: Vec3, pelvis: Vec3, pitch: number): number {
  const y = point[1] - pelvis[1]
  const z = point[2] - pelvis[2]
  return y * Math.cos(pitch) + z * Math.sin(pitch) - y
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
  const referenceCadence = gait.referenceSpeed / gait.strideLength
  const eases = roots.map(root => Math.min(1, horizontalSpeed(root) / gait.referenceSpeed))
  const steps = roots.map((root, i) => {
    return Math.max(eases[i], Math.min(1, Math.abs(root.angularVelocity) * TURN_CYCLES_PER_RADIAN / referenceCadence))
  })
  const leans = groundLeans(options, roots)
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
  const frames: GaitFrame[] = []
  for (let i = 0; i < count; i++) {
    const root = roots[i]
    const states = stances[i]
    const ease = eases[i]
    const bob = ease === 0 ? 0 : -gait.bobAmplitude * Math.cos(4 * Math.PI * phase[i]) * ease
    const offset = Math.min(bob, drops[i])
    const lean = leans?.[i]
    const frame: GaitFrame = {
      root,
      pelvisOffset: [0, lean === undefined ? offset : lean.base + offset, 0],
      feet: states,
      armSwings: offsets.map(leg => gait.armSwingDegrees * Math.cos(2 * Math.PI * (phase[i] - leg)) * ease),
      phase: phase[i]
    }
    if (lean !== undefined) frame.pelvisPitch = lean.pitch
    frames.push(frame)
  }
  return frames
}
