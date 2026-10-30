import type { Mannequin } from '../formats/mannequin.ts'
import type { Wind } from '../formats/sim.ts'
import { normalize } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import type { RootState } from '../motion/script.ts'
import { bodyCollider, toWorld } from './body.ts'
import type { System } from './cloth.ts'

export type Environment = { gravity: Vec3, wind?: Wind, particleRadius: number }

export type StepOptions = {
  env: Environment
  body: Mannequin
  exclude: string[]
  track: (t: number) => RootState
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
 * particles move to the root pose at `t` and the wind is sampled there. The caller loops substeps.
 */
export function step (system: System, options: StepOptions): void {
  const { env, dt } = options
  const root = options.track(options.t)
  const { position, previous, inverseMass, materialIndex, count } = system.particles
  for (const pin of system.pins) {
    const joint = options.body.joints[pin.joint]
    const world = toWorld([joint[0] + pin.offset[0], joint[1] + pin.offset[1], joint[2] + pin.offset[2]], root)
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
    const k = material.drag * w
    const o = 3 * i
    let vx = (position[o] - previous[o]) / dt
    let vy = (position[o + 1] - previous[o + 1]) / dt
    let vz = (position[o + 2] - previous[o + 2]) / dt
    vx += (gx + k * (wind[0] - vx)) * dt
    vy += (gy + k * (wind[1] - vy)) * dt
    vz += (gz + k * (wind[2] - vz)) * dt
    previous[o] = position[o]
    previous[o + 1] = position[o + 1]
    previous[o + 2] = position[o + 2]
    position[o] += vx * keep * dt
    position[o + 1] += vy * keep * dt
    position[o + 2] += vz * keep * dt
  }
  solveConstraints(system, dt)
  collide(system, options, root)
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

function collide (system: System, options: StepOptions, root: RootState): void {
  const { position, inverseMass, count } = system.particles
  const radius = options.env.particleRadius
  const collider = bodyCollider(options.body, options.exclude, root)
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
