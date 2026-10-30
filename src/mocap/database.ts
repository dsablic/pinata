import { length, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { legsOf } from '../formats/rig.ts'
import { assemble, hierarchyOf, retargetRotations } from './retarget.ts'
import type { BodyFrame, Hierarchy, RetargetOptions } from './retarget.ts'
import type { Clip } from './clip.ts'

/** A clip retargeted to one character, with its assembled ankles for matching. */
export type MotionEntry = {
  name: string
  fps: number
  frames: BodyFrame[]
  /** Body-local ankle positions per frame, per leg. */
  ankles: Vec3[][]
  /** The clip ends standing still, so its last frame can be held and its end matched as a stop. */
  endsAtRest: boolean
}
/** A frame that playback may jump to, with its feature vector. */
export type Candidate = { entry: number, frame: number, feature: number[] }
/** Every clip retargeted to one character, and the frames matching searches. */
export type MotionDatabase = {
  entries: MotionEntry[]
  candidates: Candidate[]
  /** Spread of each feature over the candidates, to weigh them alike. */
  scales: number[]
  hierarchy: Hierarchy
  options: RetargetOptions
}

/** Frames ahead at which the root's path and facing are matched (at 24 fps, a third and two thirds of a second). */
export const HORIZONS = [8, 16]
const REST_SPEED = 0.15
const REST_SECONDS = 0.25

function turnBetween (a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a))
}

/** A world vector in the frame of a root facing yaw: the inverse of toWorld's turn. */
export function toLocal (v: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [v[0] * c - v[2] * s, v[1], v[0] * s + v[2] * c]
}

/**
 * The features of a moment, all in the frame of the root then: the root's position and facing (sine and cosine of
 * the turn) at each horizon, its velocity, and each ankle's position and velocity across the ground.
 */
export function featureOf (
  path: Array<{ position: Vec3, yaw: number }>,
  velocity: Vec3,
  ankles: Vec3[],
  ankleVelocities: Vec3[]
): number[] {
  const [now, ...ahead] = path
  const feature: number[] = []
  for (const future of ahead) {
    const offset = toLocal(sub(future.position, now.position), now.yaw)
    const turn = turnBetween(now.yaw, future.yaw)
    feature.push(offset[0], offset[2], Math.sin(turn), Math.cos(turn))
  }
  const moving = toLocal(velocity, now.yaw)
  feature.push(moving[0], moving[2])
  ankles.forEach((ankle, k) => feature.push(ankle[0], ankle[2], ankleVelocities[k][0], ankleVelocities[k][2]))
  return feature
}

/** How much each feature counts: the path, the facing, the velocity, then per ankle position and velocity. */
export function featureWeights (legs: number): number[] {
  const weights: number[] = []
  for (let h = 0; h < HORIZONS.length; h++) weights.push(1, 1, 1.5, 1.5)
  weights.push(1, 1)
  for (let k = 0; k < legs; k++) weights.push(1.5, 1.5, 0.75, 0.75)
  return weights
}

/**
 * Retargets every clip to a character and lists the frames playback may jump to: those with the full path ahead of
 * them, and in a clip that ends standing still, every frame, its path held at the end.
 */
export function buildDatabase (clips: Clip[], options: RetargetOptions): MotionDatabase {
  const hierarchy = hierarchyOf(options.rig, options.map)
  const legs = legsOf(options.rig)
  const entries = clips.map((clip): MotionEntry => {
    const frames = retargetRotations(clip, options)
    const ankles = frames.map(frame => {
      const { pose } = assemble(frame, options, hierarchy)
      return legs.map(leg => pose[leg.ankle])
    })
    const tail = frames.slice(-Math.max(1, Math.round(REST_SECONDS * clip.fps)))
    const endsAtRest = tail.every(frame => length(frame.root.velocity) < REST_SPEED)
    return { name: clip.name, fps: clip.fps, frames, ankles, endsAtRest }
  })
  const candidates: Candidate[] = []
  entries.forEach((entry, e) => {
    const last = entry.frames.length - 1
    entry.frames.forEach((frame, i) => {
      if (!entry.endsAtRest && i + HORIZONS[HORIZONS.length - 1] > last) return
      const path = [0, ...HORIZONS].map(h => entry.frames[Math.min(last, i + h)].root)
      const velocities = entry.ankles[i].map((ankle, k) => ankleVelocity(entry, i, k))
      const feature = featureOf(path, frame.root.velocity, entry.ankles[i], velocities)
      candidates.push({ entry: e, frame: i, feature })
    })
  })
  const dims = candidates[0]?.feature.length ?? 0
  const scales = Array.from({ length: dims }, (_, d) => {
    const values = candidates.map(c => c.feature[d])
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const spread = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length)
    return spread > 1e-6 ? spread : 1
  })
  return { entries, candidates, scales, hierarchy, options }
}

/** Body-local velocity of an ankle at a frame, m/s, from its neighbours. */
export function ankleVelocity (entry: MotionEntry, frame: number, leg: number): Vec3 {
  const before = Math.max(0, frame - 1)
  const after = Math.min(entry.frames.length - 1, frame + 1)
  if (after === before) return [0, 0, 0]
  const d = sub(entry.ankles[after][leg], entry.ankles[before][leg])
  const dt = (after - before) / entry.fps
  return [d[0] / dt, d[1] / dt, d[2] / dt]
}
