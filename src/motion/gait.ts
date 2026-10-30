import { legPhases, legsOf, stride } from '../formats/rig.ts'
import type { Mannequin } from '../formats/mannequin.ts'
import type { Leg, Rig } from '../formats/rig.ts'
import { toWorld } from '../sim/body.ts'
import type { Vec3 } from '../math/vec.ts'
import { chainLength, soleHeight } from './pose.ts'
import type { Pose } from './pose.ts'
import type { RootState } from './script.ts'

export type FootState = {
  side: 'left' | 'right'
  ankle: Vec3
  toeYaw: number
  planted: boolean
  lift: number
  toePitch: number
}
export type GaitFrame = {
  root: RootState
  pelvisOffset: Vec3
  feet: FootState[]
  armSwings: number[]
  phase: number
}

type Options = {
  track: (t: number) => RootState
  rig: Rig
  rest: Pose
  mannequin: Mannequin
  duration: number
  fps: number
}
type Plant = { phase: number, ankle: Vec3, yaw: number }
type Foot = {
  side: 'left' | 'right'
  sign: number
  planted: Vec3
  restHip: Vec3
  reach: number
  partner: number
  plants: Plant[]
}
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
  const { track, rig, rest, mannequin, fps } = options
  const { gait } = rig
  const start = track(0)
  const rested = gait.lateral === 'rest'
  const feet = legsOf(rig).map((leg, index): Foot => {
    const restAnkle = rest[leg.ankle]
    const planted: Vec3 = [restAnkle[0], restAnkle[1] - soleHeight(leg, rest, mannequin), restAnkle[2]]
    const initial: Plant = { phase: cycle.initial[index], ankle: toWorld(planted, start), yaw: start.yaw }
    return {
      side: leg.side,
      sign: leg.side === 'left' ? 1 : -1,
      planted,
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
    if (isAtRest(landed)) {
      const side = lateral(landed.yaw)
      const beside = feet[foot.partner].plants[feet[foot.partner].plants.length - 1].ankle
      const gap = rested ? foot.planted[0] - feet[foot.partner].planted[0] : foot.sign * gait.footSpacing
      ankle = [beside[0] + side[0] * gap, beside[1], beside[2] + side[2] * gap]
      yaw = landed.yaw
    } else {
      const middle = track(timeAtPhase(phase, fps, landing + gait.stanceFraction / 2))
      const side = lateral(middle.yaw)
      const offset = rested ? foot.planted[0] : foot.sign * gait.footSpacing / 2
      const forward = ahead(middle.yaw, rested ? foot.planted[2] : foot.restHip[2])
      ankle = [
        middle.position[0] + side[0] * offset + forward[0],
        middle.position[1] + foot.planted[1],
        middle.position[2] + side[2] * offset + forward[2]
      ]
      yaw = middle.yaw
    }
    foot.plants.push({ phase: landing, ankle, yaw })
  }
  return feet
}

function footAt (foot: Foot, phase: number, options: Options): FootState {
  const { stanceFraction, stepHeight } = options.rig.gait
  let k = 0
  while (k + 1 < foot.plants.length && foot.plants[k + 1].phase <= phase) k++
  const plant = foot.plants[k]
  const next = foot.plants[k + 1]
  const liftOff = plant.phase + stanceFraction
  if (next === undefined || phase <= liftOff) {
    return { side: foot.side, ankle: plant.ankle, toeYaw: plant.yaw, planted: true, lift: 0, toePitch: 0 }
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
  return {
    side: foot.side,
    ankle,
    toeYaw: plant.yaw + (next.yaw - plant.yaw) * h,
    planted: false,
    lift,
    toePitch: Math.sin(Math.PI * e)
  }
}

function neededOffset (foot: Foot, state: FootState, root: RootState, fraction: number): number {
  const hip = toWorld(foot.restHip, root)
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
  const needed = stances.map((states, i) => {
    const fraction = REST_REACH_FRACTION + (WALK_REACH_FRACTION - REST_REACH_FRACTION) * steps[i]
    return Math.min(0, ...feet.map((foot, k) => neededOffset(foot, states[k], roots[i], fraction)))
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
    frames.push({
      root,
      pelvisOffset: [0, offset, 0],
      feet: states,
      armSwings: offsets.map(leg => gait.armSwingDegrees * Math.cos(2 * Math.PI * (phase[i] - leg)) * ease),
      phase: phase[i]
    })
  }
  return frames
}
