import type { Mannequin } from '../formats/mannequin.ts'
import type { Wind } from '../formats/sim.ts'
import { normalize } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import type { Pose } from '../motion/pose.ts'
import type { Transforms } from '../motion/skeleton.ts'
import { apply } from '../math/matrix.ts'
import type { RootState } from '../motion/script.ts'
import { bodyCollider, partsCollider, posedParts, toWorld } from './body.ts'
import type { System } from './cloth.ts'

export type Environment = { gravity: Vec3, wind?: Wind, particleRadius: number }

export type StepOptions = {
  env: Environment
  body: Mannequin
  exclude: string[]
  track: (t: number) => RootState
  pose?: (t: number) => Pose
  transforms?: (t: number) => Transforms
  t: number
  dt: number
}

export function windAt (wind: Wind | undefined, t: number): Vec3 {
  if (wind === undefined) return [0, 0, 0]
  const gust = 1 + wind.gust * (0.6 * Math.sin(1.3 * t) + 0.3 * Math.sin(3.1 * t + 1) + 0.1 * Math.sin(7.7 * t + 2))
  const d = normalize(wind.direction)
  const s = wind.speed * gust
  return [d[0] * s, d[1] * s, d[2] * s]
}

/**
 * Advances the system by one substep of length dt. `t` is the simulation time at the end of the substep: the pinned
 * particles move to the root pose at `t` and the wind is sampled there. The caller loops substeps. With `pose`, the
 * collider and pins use that body-local pose instead of the rest mannequin; it must return the same object for every
 * `t` within a frame so the collider is compiled once per frame. With `transforms`, a pin's offset also turns with
 * its joint's rotation.
 */
export function step (system: System, options: StepOptions): void {
  const { env, dt } = options
  const root = options.track(options.t)
  const { position, previous, inverseMass, materialIndex, count } = system.particles
  const pose = options.pose?.(options.t)
  const joints = pose ?? options.body.joints
  const transforms = options.transforms?.(options.t)
  for (const pin of system.pins) {
    const joint = joints[pin.joint]
    const rotation = transforms?.[pin.joint]?.rotation
    const offset = rotation === undefined ? pin.offset : apply(rotation, pin.offset)
    const world = toWorld([joint[0] + offset[0], joint[1] + offset[1], joint[2] + offset[2]], root)
    position.set(world, 3 * pin.particle)
    previous.set(world, 3 * pin.particle)
  }
  const wind = windAt(env.wind, options.t)
  const [gx, gy, gz] = env.gravity
  for (let i = 0; i < count; i++) {
    const w = inverseMass[i]
    if (w === 0) continue
    const material = system.material[materialIndex[i]]
    const keep = Math.max(0, 1 - material.damping * dt)
    const o = 3 * i
    const k = material.drag * w
    const bx = root.velocity[0] + root.angularVelocity * (position[o + 2] - root.position[2])
    const bz = root.velocity[2] - root.angularVelocity * (position[o] - root.position[0])
    const by = root.velocity[1]
    let vx = (position[o] - previous[o]) / dt
    let vy = (position[o + 1] - previous[o + 1]) / dt
    let vz = (position[o + 2] - previous[o + 2]) / dt
    vx = (vx + gx * dt + k * dt * wind[0]) / (1 + k * dt)
    vy = (vy + gy * dt + k * dt * wind[1]) / (1 + k * dt)
    vz = (vz + gz * dt + k * dt * wind[2]) / (1 + k * dt)
    previous[o] = position[o]
    previous[o + 1] = position[o + 1]
    previous[o + 2] = position[o + 2]
    position[o] += (bx + (vx - bx) * keep) * dt
    position[o + 1] += (by + (vy - by) * keep) * dt
    position[o + 2] += (bz + (vz - bz) * keep) * dt
  }
  solveConstraints(system, dt)
  collide(system, options, root, pose)
}

// Each constraint is solved once per substep, so its multiplier starts at zero and never needs storing.
function solveConstraints (system: System, dt: number): void {
  const { position, inverseMass } = system.particles
  const inverseDtSquared = 1 / (dt * dt)
  for (const c of system.constraints) {
    const wa = inverseMass[c.a]
    const wb = inverseMass[c.b]
    const alphaTilde = c.compliance * inverseDtSquared
    const denominator = wa + wb + alphaTilde
    if (denominator === 0) continue
    const a = 3 * c.a
    const b = 3 * c.b
    const dx = position[a] - position[b]
    const dy = position[a + 1] - position[b + 1]
    const dz = position[a + 2] - position[b + 2]
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (length < 1e-12) continue
    const factor = -(length - c.rest) / denominator / length
    position[a] += wa * factor * dx
    position[a + 1] += wa * factor * dy
    position[a + 2] += wa * factor * dz
    position[b] -= wb * factor * dx
    position[b + 1] -= wb * factor * dy
    position[b + 2] -= wb * factor * dz
  }
}

function collide (system: System, options: StepOptions, root: RootState, pose: Pose | undefined): void {
  const { position, inverseMass, count } = system.particles
  const radius = options.env.particleRadius
  const collider = pose === undefined
    ? bodyCollider(options.body, options.exclude, root)
    : partsCollider(posedParts(options.body, options.exclude, pose), root)
  for (let i = 0; i < count; i++) {
    if (inverseMass[i] === 0) continue
    const o = 3 * i
    const p: Vec3 = [position[o], position[o + 1], position[o + 2]]
    const d = collider.distance(p)
    if (d >= radius) continue
    const n = collider.normal(p)
    const push = radius - d
    position[o] += n[0] * push
    position[o + 1] += n[1] * push
    position[o + 2] += n[2] * push
  }
}
