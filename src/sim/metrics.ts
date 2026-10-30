import { createHash } from 'node:crypto'
import type { Vec3 } from '../math/vec.ts'
import type { RootState } from '../motion/script.ts'
import { toWorld } from './body.ts'
import type { DistanceConstraint, Particles, System } from './cloth.ts'

export type Frame = { time: number, root: RootState, positions: Float64Array, penetration: Float64Array }
export type Recording = { constraints: DistanceConstraint[], frames: Frame[] }

/** Hem particle indices and the cape's top-centre anchor in body-local space (joint position plus offset). */
export type SwingOptions = { hem: number[], anchorLocal: Vec3 }

export function createRecording (system: System): Recording {
  return { constraints: system.constraints, frames: [] }
}

export type RecordOptions = {
  time: number
  root: RootState
  particles: Particles
  distance: (p: Vec3) => number
  particleRadius: number
}

/**
 * Copies the particle positions and stores per-particle penetration depth, max(0, particleRadius - distance).
 * Pinned particles (inverse mass 0) are placed by the root, not simulated, so their depth is recorded as 0.
 */
export function recordFrame (recording: Recording, options: RecordOptions): void {
  const { particles, distance, particleRadius } = options
  const penetration = new Float64Array(particles.count)
  for (let i = 0; i < particles.count; i++) {
    if (particles.inverseMass[i] === 0) continue
    const p = particles.position
    const d = distance([p[3 * i], p[3 * i + 1], p[3 * i + 2]])
    penetration[i] = Math.max(0, particleRadius - d)
  }
  recording.frames.push({
    time: options.time,
    root: options.root,
    positions: particles.position.slice(0, 3 * particles.count),
    penetration
  })
}

/** Number of NaN or infinite particle coordinates over all frames. */
export function nonFinite (recording: Recording): number {
  let count = 0
  for (const frame of recording.frames) {
    for (const v of frame.positions) if (!Number.isFinite(v)) count++
  }
  return count
}

function frameSpeed (recording: Recording, index: number): number {
  const a = recording.frames[index - 1]
  const b = recording.frames[index]
  const dt = b.time - a.time
  let best = 0
  for (let i = 0; i < b.positions.length; i += 3) {
    const d = Math.hypot(b.positions[i] - a.positions[i], b.positions[i + 1] - a.positions[i + 1],
      b.positions[i + 2] - a.positions[i + 2])
    if (d / dt > best) best = d / dt
  }
  return best
}

/** Largest particle displacement between consecutive frames divided by the frame time step, in m/s. */
export function maxSpeed (recording: Recording): number {
  let best = 0
  for (let i = 1; i < recording.frames.length; i++) best = Math.max(best, frameSpeed(recording, i))
  return best
}

/** Largest (current length - rest length) / rest length over all constraints and frames. */
export function maxStrain (recording: Recording): number {
  let best = -Infinity
  for (const { positions } of recording.frames) {
    for (const { a, b, rest } of recording.constraints) {
      const length = Math.hypot(positions[3 * a] - positions[3 * b], positions[3 * a + 1] - positions[3 * b + 1],
        positions[3 * a + 2] - positions[3 * b + 2])
      best = Math.max(best, (length - rest) / rest)
    }
  }
  return best
}

/** Fraction of frames in which any particle has penetration depth above the threshold (metres). */
export function penetratingFrames (recording: Recording, threshold: number): number {
  if (recording.frames.length === 0) return 0
  const hits = recording.frames.filter(f => f.penetration.some(d => d > threshold)).length
  return hits / recording.frames.length
}

/**
 * Time from fromTime until the frame-to-frame max particle speed is below speedThreshold and stays below for all
 * later frames; Infinity if the final frame is still moving faster.
 */
export function settleSeconds (recording: Recording, options: { fromTime: number, speedThreshold: number }): number {
  const { frames } = recording
  const first = Math.max(1, frames.findIndex(f => f.time >= options.fromTime))
  let settled = frames.length
  for (let i = frames.length - 1; i >= first; i--) {
    if (frameSpeed(recording, i) >= options.speedThreshold) break
    settled = i
  }
  if (settled === frames.length) return Infinity
  return Math.max(0, frames[settled].time - options.fromTime)
}

/**
 * Per frame, in radians, the pendulum angles of the hem centroid about the anchor in body-local space with
 * d = R(-yaw) * (hem - anchor): forward = atan2(d.z, -d.y), sideways = atan2(d.x, -d.y).
 */
export function swingAngles (recording: Recording, options: SwingOptions): { forward: number[], sideways: number[] } {
  const forward: number[] = []
  const sideways: number[] = []
  for (const { positions, root } of recording.frames) {
    const hem = centroid(positions, options.hem)
    const anchor = toWorld(options.anchorLocal, root)
    const x = hem[0] - anchor[0]
    const z = hem[2] - anchor[2]
    const c = Math.cos(root.yaw)
    const s = Math.sin(root.yaw)
    const down = -(hem[1] - anchor[1])
    forward.push(Math.atan2(x * s + z * c, down))
    sideways.push(Math.atan2(x * c - z * s, down))
  }
  return { forward, sideways }
}

/** Max forward swing over frames at or after stopTime minus the forward swing of the last frame, in degrees. */
export function overshootDegrees (recording: Recording, options: { stopTime: number, swing: SwingOptions }): number {
  const { forward } = swingAngles(recording, options.swing)
  const after = forward.filter((_, i) => recording.frames[i].time >= options.stopTime)
  if (after.length === 0) return 0
  return (Math.max(...after) - forward[forward.length - 1]) * 180 / Math.PI
}

type LagOptions = { turnStart: number, turnEnd: number, swing: SwingOptions }

function peakIndex (values: number[], recording: Recording, from: number, to: number): number {
  let best = -1
  recording.frames.forEach((f, i) => {
    if (f.time < from || f.time > to) return
    if (best === -1 || values[i] > values[best]) best = i
  })
  return best
}

/**
 * Frame index of peak |sideways swing| in [turnStart, turnEnd + 1 s] minus frame index of peak |body angular
 * velocity| in [turnStart, turnEnd]; first frame wins ties.
 */
export function lagFrames (recording: Recording, options: LagOptions): number {
  const side = swingAngles(recording, options.swing).sideways.map(Math.abs)
  const omega = recording.frames.map(f => Math.abs(f.root.angularVelocity))
  const sidePeak = peakIndex(side, recording, options.turnStart, options.turnEnd + 1)
  const turnPeak = peakIndex(omega, recording, options.turnStart, options.turnEnd)
  return sidePeak - turnPeak
}

export type WindAlignmentOptions = { hem: number[], restHem: Vec3, windDirection: Vec3 }

/**
 * Mean over frames of the cosine between the horizontal (x, z) hem-centroid displacement from restHem and the
 * horizontal wind direction; a frame with zero displacement counts as 0.
 */
export function windAlignment (recording: Recording, options: WindAlignmentOptions): number {
  const wind = Math.hypot(options.windDirection[0], options.windDirection[2])
  if (recording.frames.length === 0 || wind === 0) return 0
  let total = 0
  for (const { positions } of recording.frames) {
    const hem = centroid(positions, options.hem)
    const dx = hem[0] - options.restHem[0]
    const dz = hem[2] - options.restHem[2]
    const length = Math.hypot(dx, dz)
    if (length < 1e-12) continue
    total += (dx * options.windDirection[0] + dz * options.windDirection[2]) / (length * wind)
  }
  return total / recording.frames.length
}

/** SHA-256 hex digest of each frame's particle position bytes. */
export function frameHashes (recording: Recording): string[] {
  return recording.frames.map(f => {
    const bytes = new Uint8Array(f.positions.buffer, f.positions.byteOffset, f.positions.byteLength)
    return createHash('sha256').update(bytes).digest('hex')
  })
}

function centroid (positions: Float64Array, indices: number[]): Vec3 {
  let x = 0
  let y = 0
  let z = 0
  for (const i of indices) {
    x += positions[3 * i]
    y += positions[3 * i + 1]
    z += positions[3 * i + 2]
  }
  return [x / indices.length, y / indices.length, z / indices.length]
}
