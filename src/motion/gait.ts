import { stride } from '../formats/rig.ts'
import type { Rig } from '../formats/rig.ts'
import { toWorld } from '../sim/body.ts'
import { length, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import type { Pose } from './pose.ts'
import type { RootState } from './script.ts'

export type FootState = { side: 'left' | 'right', ankle: Vec3, toeYaw: number, planted: boolean, lift: number }
export type GaitFrame = {
  root: RootState
  pelvisOffset: Vec3
  feet: FootState[]
  armSwing: number
  phase: number
}

type Options = { track: (t: number) => RootState, rig: Rig, rest: Pose, duration: number, fps: number }
type Plant = { phase: number, ankle: Vec3, yaw: number }
type Foot = { side: 'left' | 'right', sign: number, restAnkle: Vec3, restHip: Vec3, reach: number, plants: Plant[] }

const TURN_CYCLES_PER_RADIAN = 2 / Math.PI
const REST_EPSILON = 1e-9
const PHASE_EPSILON = 1e-9
const REACH_FRACTION = 0.95
const DROP_SMOOTHING_SECONDS = 0.125

function smoothstep (x: number): number {
  return x * x * (3 - 2 * x)
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

function samplePhase (options: Options, count: number): number[] {
  const { track, rig, fps } = options
  const settleRate = rig.gait.referenceSpeed / rig.gait.strideLength
  const restOffset = rig.gait.stanceFraction - 0.5
  const phase = [restOffset]
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
      if (target < 0) target = (Math.floor(2 * p + PHASE_EPSILON) + 1) / 2 + restOffset
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

function buildFeet (options: Options, phase: number[]): Foot[] {
  const { track, rig, rest, fps } = options
  const { gait } = rig
  const start = track(0)
  const feet = rig.legs.map((leg): Foot => {
    const restAnkle = rest[leg.ankle]
    const upper = length(sub(rest[leg.knee], rest[leg.hip]))
    const lower = length(sub(rest[leg.ankle], rest[leg.knee]))
    const initial: Plant = {
      phase: leg.side === 'left' ? 0 : -0.5,
      ankle: toWorld(restAnkle, start),
      yaw: start.yaw
    }
    return {
      side: leg.side,
      sign: restAnkle[0] >= 0 ? 1 : -1,
      restAnkle,
      restHip: rest[leg.hip],
      reach: upper + lower,
      plants: [initial]
    }
  })
  const left = feet.findIndex(f => f.side === 'left')
  const landings = Math.floor(2 * phase[phase.length - 1] + PHASE_EPSILON) + 2
  for (let m = 1; m <= landings; m++) {
    const foot = feet[m % 2 === 0 ? left : 1 - left]
    const other = feet[m % 2 === 0 ? 1 - left : left]
    const landing = m / 2
    const landed = track(timeAtPhase(phase, fps, landing))
    let ankle: Vec3
    let yaw: number
    if (isAtRest(landed)) {
      const side = lateral(landed.yaw)
      const beside = other.plants[other.plants.length - 1].ankle
      const gap = foot.sign * gait.footSpacing
      ankle = [beside[0] + side[0] * gap, beside[1], beside[2] + side[2] * gap]
      yaw = landed.yaw
    } else {
      const middle = track(timeAtPhase(phase, fps, landing + gait.stanceFraction / 2))
      const side = lateral(middle.yaw)
      const offset = foot.sign * gait.footSpacing / 2
      ankle = [
        middle.position[0] + side[0] * offset,
        middle.position[1] + foot.restAnkle[1],
        middle.position[2] + side[2] * offset
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
    return { side: foot.side, ankle: plant.ankle, toeYaw: plant.yaw, planted: true, lift: 0 }
  }
  const s = Math.min(1, (phase - liftOff) / (1 - stanceFraction))
  const h = smoothstep(s)
  const lift = Math.sin(Math.PI * s)
  const ankle: Vec3 = [
    plant.ankle[0] + (next.ankle[0] - plant.ankle[0]) * h,
    plant.ankle[1] + (next.ankle[1] - plant.ankle[1]) * h + stepHeight * lift,
    plant.ankle[2] + (next.ankle[2] - plant.ankle[2]) * h
  ]
  return { side: foot.side, ankle, toeYaw: plant.yaw + (next.yaw - plant.yaw) * h, planted: false, lift }
}

function neededOffset (foot: Foot, state: FootState, root: RootState): number {
  const hip = toWorld(foot.restHip, root)
  const run = Math.hypot(state.ankle[0] - hip[0], state.ankle[2] - hip[2])
  const limit = foot.reach * REACH_FRACTION
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
  const phase = samplePhase(options, count)
  const feet = buildFeet(options, phase)
  const roots = phase.map((_, i) => track(i / fps))
  const stances = phase.map((p, i) => feet.map(foot => footAt(foot, p, options)))
  const needed = stances.map((states, i) => {
    return Math.min(0, ...feet.map((foot, k) => neededOffset(foot, states[k], roots[i])))
  })
  const drops = smoothDrops(needed, Math.round(DROP_SMOOTHING_SECONDS * fps))
  const frames: GaitFrame[] = []
  for (let i = 0; i < count; i++) {
    const root = roots[i]
    const states = stances[i]
    const ease = Math.min(1, horizontalSpeed(root) / gait.referenceSpeed)
    const bob = ease === 0 ? 0 : -gait.bobAmplitude * Math.cos(4 * Math.PI * phase[i]) * ease
    const offset = Math.min(bob, drops[i])
    frames.push({
      root,
      pelvisOffset: [0, offset, 0],
      feet: states,
      armSwing: gait.armSwingDegrees * Math.cos(2 * Math.PI * phase[i]) * ease,
      phase: phase[i]
    })
  }
  return frames
}
