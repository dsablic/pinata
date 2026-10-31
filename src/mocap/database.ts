import { length, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { legsOf } from '../formats/rig.ts'
import { assemble, hierarchyOf, retargetRotations } from './retarget.ts'
import type { BodyFrame, Hierarchy, RetargetOptions } from './retarget.ts'
import type { Clip } from './clip.ts'
import { turnBetween, turnToLocal } from '../world/yaw.ts'

export type MotionEntry = {
  name: string
  fps: number
  frames: BodyFrame[]
  ankles: Vec3[][]
  endsAtRest: boolean
}
export type Candidate = { entry: number, frame: number, feature: number[] }
export type MotionDatabase = {
  entries: MotionEntry[]
  candidates: Candidate[]
  scales: number[]
  hierarchy: Hierarchy
  options: RetargetOptions
}

export const HORIZONS = [8, 16]
const REST_SPEED = 0.15
const REST_SECONDS = 0.25

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

function entryOf (clip: Clip, options: RetargetOptions, hierarchy: Hierarchy): MotionEntry {
  const legs = legsOf(options.rig)
  const frames = retargetRotations(clip, options)
  const ankles = frames.map(frame => {
    const { pose } = assemble(frame, options, hierarchy)
    return legs.map(leg => pose[leg.ankle])
  })
  const tail = frames.slice(-Math.max(1, Math.round(REST_SECONDS * clip.fps)))
  const endsAtRest = tail.every(frame => length(frame.root.velocity) < REST_SPEED)
  return { name: clip.name, fps: clip.fps, frames, ankles, endsAtRest }
}

function candidatesOf (entries: MotionEntry[]): Candidate[] {
  const candidates: Candidate[] = []
  entries.forEach((entry, e) => {
    const last = entry.frames.length - 1
    entry.frames.forEach((frame, i) => {
      if (!entry.endsAtRest && i + HORIZONS[HORIZONS.length - 1] > last) return
      const path = [0, ...HORIZONS].map(h => entry.frames[Math.min(last, i + h)].root)
      const velocities = entry.ankles[i].map((_, k) => ankleVelocity(entry, i, k))
      const feature = featureOf(path, frame.root.velocity, entry.ankles[i], velocities)
      candidates.push({ entry: e, frame: i, feature })
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

export function buildDatabase (clips: Clip[], options: RetargetOptions): MotionDatabase {
  const hierarchy = hierarchyOf(options.rig, options.map)
  const entries = clips.map(clip => entryOf(clip, options, hierarchy))
  const candidates = candidatesOf(entries)
  return { entries, candidates, scales: featureSpreads(candidates), hierarchy, options }
}

export function ankleVelocity (entry: MotionEntry, frame: number, leg: number): Vec3 {
  const before = Math.max(0, frame - 1)
  const after = Math.min(entry.frames.length - 1, frame + 1)
  if (after === before) return [0, 0, 0]
  const d = sub(entry.ankles[after][leg], entry.ankles[before][leg])
  const dt = (after - before) / entry.fps
  return [d[0] / dt, d[1] / dt, d[2] / dt]
}
