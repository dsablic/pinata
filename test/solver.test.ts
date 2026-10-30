import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Mannequin } from '../src/formats/mannequin.ts'
import type { Chain, SimMaterial, Wind } from '../src/formats/sim.ts'
import { createRootTrack } from '../src/motion/script.ts'
import type { RootState, Script } from '../src/motion/script.ts'
import { anchorWorld, bodyCollider, toWorld } from '../src/sim/body.ts'
import { buildChain } from '../src/sim/cloth.ts'
import type { System } from '../src/sim/cloth.ts'
import { step, windAt } from '../src/sim/solver.ts'
import type { Environment } from '../src/sim/solver.ts'
import { assertClose } from './helpers.ts'

const DT = 1 / 240
const env: Environment = { gravity: [0, -9.81, 0], particleRadius: 0.02 }
const still: RootState = { position: [0, 0, 0], yaw: 0, velocity: [0, 0, 0], angularVelocity: 0 }
const stillTrack = (): RootState => still

const body: Mannequin = {
  name: 'test',
  height: 2,
  joints: { top: [0, 2, 0], origin: [0, 0, 0] },
  parts: [{ name: 'ball', shape: 'capsule', a: 'origin', b: 'origin', radiusA: 0.5, radiusB: 0.5, material: 'm' }],
  decals: []
}

const rope: SimMaterial = {
  name: 'rope', particleMass: 0.05, stretchCompliance: 0, bendCompliance: 1e-4, damping: 1, drag: 0
}

type Track = (t: number) => RootState

function run (system: System, options: Partial<Environment>, seconds: number, track: Track = stillTrack): void {
  const steps = Math.round(seconds / DT)
  for (let k = 1; k <= steps; k++) {
    step(system, { env: { ...env, ...options }, body, exclude: [], track, t: k * DT, dt: DT })
  }
}

function chain (links: number, direction: [number, number, number], material: SimMaterial): System {
  return buildChain({ anchor: 'top', links, linkLength: 0.1, direction, material: material.name }, body, material)
}

function linkLengths (system: System): number[] {
  const p = system.particles.position
  return system.constraints.slice(0, system.particles.count - 1).map(c => (
    Math.hypot(p[3 * c.a] - p[3 * c.b], p[3 * c.a + 1] - p[3 * c.b + 1], p[3 * c.a + 2] - p[3 * c.b + 2])
  ))
}

test('a swinging 10-link chain settles hanging straight down with links near rest length', () => {
  const system = chain(10, [1, 0, 0], { ...rope, damping: 2 })
  run(system, {}, 5)
  const p = system.particles.position
  for (let i = 0; i <= 10; i++) {
    assertClose(p[3 * i], 0, 0.02)
    assertClose(p[3 * i + 1], 2 - 0.1 * i, 0.02)
  }
  for (const length of linkLengths(system)) assert.ok(Math.abs(length - 0.1) <= 0.002, `link ${length}`)
})

test('a free particle dropped on a sphere ends outside it', () => {
  const system = chain(1, [0, 1, 0], rope)
  system.pins.length = 0
  system.particles.inverseMass[0] = 1 / 0.05
  system.constraints.length = 0
  system.particles.position.set([0.1, 1.5, 0, 0.3, 1.5, 0])
  system.particles.previous.set(system.particles.position)
  run(system, {}, 2)
  const collider = bodyCollider(body, [], still)
  for (let i = 0; i < 2; i++) {
    const p = system.particles.position
    const d = collider.distance([p[3 * i], p[3 * i + 1], p[3 * i + 2]])
    assert.ok(d >= env.particleRadius - 1e-6, `distance ${d}`)
    assert.ok(p[3 * i + 1] < 1.5)
  }
})

function pendulumEnergy (damping: number): number {
  const material = { ...rope, damping }
  const pendulum: Chain = { anchor: 'top', links: 1, linkLength: 1, direction: [1, 0, 0], material: 'rope' }
  const system = buildChain(pendulum, body, material)
  run(system, {}, 1)
  const p = system.particles
  const v = Math.hypot(
    p.position[3] - p.previous[3], p.position[4] - p.previous[4], p.position[5] - p.previous[5]
  ) / DT
  const mass = 0.05
  const total = 0.5 * mass * v * v + mass * 9.81 * (p.position[4] - 1)
  return total / (mass * 9.81)
}

test('an undamped pendulum keeps most of its energy over a second and a damped one loses most', () => {
  const free = pendulumEnergy(0)
  const damped = pendulumEnergy(2)
  assert.ok(free > 0.9 && free < 1.05, `undamped ${free}`)
  assert.ok(damped < 0.5, `damped ${damped}`)
})

test('wind pushes free particles toward the wind direction through drag', () => {
  const system = chain(3, [0, -1, 0], { ...rope, drag: 0.05 })
  run(system, { wind: { direction: [1, 0, 0], speed: 5, gust: 0 }, gravity: [0, -9.81, 0] }, 2)
  assert.ok(system.particles.position[9] > 0.05, `x = ${system.particles.position[9]}`)
})

test('windAt is zero without wind, normalises the direction and is deterministic', () => {
  assert.deepEqual(windAt(undefined, 1), [0, 0, 0])
  const steady = windAt({ direction: [3, 0, 4], speed: 10, gust: 0 }, 2)
  assertClose(steady[0], 6, 1e-9)
  assertClose(steady[2], 8, 1e-9)
  const t = 0.7
  const gust = 1 + 0.5 * (0.6 * Math.sin(1.3 * t) + 0.3 * Math.sin(3.1 * t + 1) + 0.1 * Math.sin(7.7 * t + 2))
  assertClose(windAt({ direction: [0, 0, 2], speed: 4, gust: 0.5 }, t)[2], 4 * gust, 1e-9)
})

test('two identical systems step to identical bytes', () => {
  const wind: Wind = { direction: [1, 0, 0.5], speed: 4, gust: 0.5 }
  const a = chain(6, [1, 0, 0], { ...rope, drag: 0.02 })
  const b = chain(6, [1, 0, 0], { ...rope, drag: 0.02 })
  run(a, { wind }, 1)
  run(b, { wind }, 1)
  assert.ok(Buffer.from(a.particles.position.buffer).equals(Buffer.from(b.particles.position.buffer)))
  assert.ok(a.particles.position.every(Number.isFinite))
})

test('pinned particles follow a moving root', () => {
  const walk: Script = {
    segments: [{ action: 'move', speed: 1, duration: 1 }, { action: 'hold', duration: 1 }],
    accelSeconds: 0.2
  }
  const turn: Script = {
    segments: [{ action: 'turn', degrees: 90, duration: 1 }, { action: 'hold', duration: 1 }],
    accelSeconds: 0.2
  }
  for (const t of [createRootTrack(walk), createRootTrack(turn)]) {
    const system = chain(3, [0, -1, 0], rope)
    system.pins[0].offset = [0.1, 0, 0.05]
    run(system, {}, 1.5, t)
    const root = t(1.5)
    const expected = toWorld([0.1, 2, 0.05], root)
    const p = system.particles.position
    assertClose(p[0], expected[0], 1e-9)
    assertClose(p[1], expected[1], 1e-9)
    assertClose(p[2], expected[2], 1e-9)
    assertClose(anchorWorld(body, 'top', root)[1], 2, 1e-9)
  }
})

function freeParticle (mass: number, material: Partial<SimMaterial>): System {
  const system = chain(1, [0, 1, 0], { ...rope, particleMass: mass, ...material })
  system.pins.length = 0
  system.particles.inverseMass.fill(1 / mass)
  system.constraints.length = 0
  system.particles.position.set([2, 5, 0, 3, 5, 0])
  system.particles.previous.set(system.particles.position)
  return system
}

test('drag on a very light particle stays stable and approaches the wind speed', () => {
  const system = freeParticle(0.001, { damping: 0, drag: 1 })
  const wind: Wind = { direction: [1, 0, 0], speed: 5, gust: 0 }
  run(system, { wind, gravity: [0, 0, 0] }, 1)
  const p = system.particles
  const speed = Math.hypot(p.position[0] - p.previous[0], p.position[1] - p.previous[1]) / DT
  assert.ok(Number.isFinite(speed))
  assertClose(speed, 5, 0.1)
})

test('damping acts on the velocity relative to the moving body only', () => {
  const moving: RootState = { position: [0, 0, 0], yaw: 0, velocity: [1, 0, 0], angularVelocity: 0.5 }
  const system = freeParticle(0.05, { damping: 120, drag: 0 })
  system.particles.position.set([2, 5, 0, 2, 5, 0])
  system.particles.previous.set([2 - DT, 5, DT, 2, 5, 0])
  step(system, { env: { ...env, gravity: [0, 0, 0] }, body, exclude: [], track: () => moving, t: DT, dt: DT })
  const p = system.particles.position
  assertClose((p[0] - 2) / DT, 1, 1e-9)
  assertClose(p[2] / DT, -1, 1e-9)
  assertClose((p[3] - 2) / DT, 0.5, 1e-9)
  assertClose(p[5] / DT, -0.5, 1e-9)
})
