import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Mannequin, Part } from '../src/formats/mannequin.ts'
import type { Chain, SimMaterial } from '../src/formats/sim.ts'
import { bindings, buildCape, buildChain, capeHemIndices, mergeSystems, particleAt } from '../src/sim/cloth.ts'
import { curveOf } from '../src/motion/secondary.ts'
import { cross, length, sub } from '../src/math/vec.ts'
import { toWorld } from '../src/sim/body.ts'
import type { Vec3 } from '../src/math/vec.ts'
import { assertClose } from './helpers.ts'

const body: Mannequin = {
  name: 'test',
  height: 2,
  joints: { left: [-0.3, 1.5, 0], right: [0.3, 1.5, 0], head: [0, 1.8, 0] },
  parts: [],
  decals: []
}

const silk: SimMaterial = {
  name: 'silk', particleMass: 0.02, stretchCompliance: 1e-6, bendCompliance: 1e-3, damping: 0.5, drag: 0.01
}
const wool: SimMaterial = { ...silk, name: 'wool', particleMass: 0.05 }

const cape = { anchorLeft: 'left', anchorRight: 'right', columns: 3, rows: 4, length: 0.9, material: 'silk' }

test('a 3 x 4 cape has 12 particles and the expected constraints', () => {
  const system = buildCape(cape, body, silk)
  assert.equal(system.particles.count, 12)
  assert.equal(system.particles.position.length, 36)
  const structural = 2 * 4 + 3 * 3
  const shear = 2 * (2 * 3)
  const bend = 1 * 4 + 3 * 2
  assert.equal(system.constraints.length, structural + shear + bend)
})

test('cape rest lengths match the grid spacing and compliances match kinds', () => {
  const system = buildCape(cape, body, silk)
  const dx = 0.3
  const dy = 0.3
  const rests = system.constraints.map(c => c.rest)
  assert.ok(rests.some(r => Math.abs(r - dx) < 1e-9))
  assert.ok(rests.some(r => Math.abs(r - Math.hypot(dx, dy)) < 1e-9))
  assert.ok(rests.some(r => Math.abs(r - 2 * dy) < 1e-9))
  for (const c of system.constraints) {
    const p = system.particles.position
    const d = Math.hypot(p[3 * c.a] - p[3 * c.b], p[3 * c.a + 1] - p[3 * c.b + 1], p[3 * c.a + 2] - p[3 * c.b + 2])
    assertClose(d, c.rest, 1e-9)
    assert.ok(c.compliance === silk.stretchCompliance || c.compliance === silk.bendCompliance)
  }
})

test('only the top row of the cape is pinned, at interpolated anchor offsets', () => {
  const system = buildCape(cape, body, silk)
  const pinned = system.pins.map(pin => pin.particle).sort()
  assert.deepEqual(pinned, [0, 1, 2])
  for (let i = 0; i < system.particles.count; i++) {
    assert.equal(system.particles.inverseMass[i] === 0, i < 3)
  }
  assertClose(system.particles.inverseMass[5], 1 / 0.02, 1e-9)
  const middle = system.pins.find(pin => pin.particle === 1)
  assert.ok(middle !== undefined)
  const joint = body.joints[middle.joint]
  assertClose(joint[0] + middle.offset[0], 0, 1e-9)
  assertClose(joint[1] + middle.offset[1], 1.5, 1e-9)
})

test('a chain has links + 1 particles, two pinned particles and structural plus bending constraints', () => {
  const chain: Chain = { anchor: 'head', links: 6, linkLength: 0.05, direction: [0, 2, 0], material: 'wool' }
  const system = buildChain(chain, body, wool)
  assert.equal(system.particles.count, 7)
  assert.equal(system.constraints.length, 6 + 5)
  assert.deepEqual(system.pins.map(pin => pin.particle), [0, 1])
  assert.equal(system.particles.inverseMass[0], 0)
  assert.equal(system.particles.inverseMass[1], 0)
  assert.equal(system.particles.inverseMass[2], 1 / 0.05)
  assertClose(system.pins[1].offset[1], 0.05, 1e-9)
  assertClose(system.particles.position[3 * 6 + 1], 1.8 + 0.3, 1e-9)
  const rests = system.constraints.map(c => c.rest)
  assert.equal(rests.filter(r => Math.abs(r - 0.05) < 1e-9).length, 6)
  assert.equal(rests.filter(r => Math.abs(r - 0.1) < 1e-9).length, 5)
})

test('merging offsets particle and pin indices and keeps materials per particle', () => {
  const a = buildCape(cape, body, silk)
  const tail: Chain = { anchor: 'head', links: 2, linkLength: 0.1, direction: [0, 1, 0], material: 'wool' }
  const b = buildChain(tail, body, wool)
  const merged = mergeSystems([a, b])
  assert.equal(merged.particles.count, 15)
  assert.equal(merged.constraints.length, a.constraints.length + b.constraints.length)
  assert.equal(merged.pins.length, 5)
  assert.equal(merged.pins[3].particle, 12)
  assert.equal(merged.pins[4].particle, 13)
  const last = merged.constraints[merged.constraints.length - 1]
  assert.ok(last.a >= 12 && last.b >= 12)
  assert.equal(merged.material[merged.particles.materialIndex[0]].name, 'silk')
  assert.equal(merged.material[merged.particles.materialIndex[14]].name, 'wool')
  assert.equal(merged.particles.previous.length, 45)
})

test('capeHemIndices lists the bottom row, which hangs lowest', () => {
  const hem = capeHemIndices(cape)
  assert.deepEqual(hem, [9, 10, 11])
  const { position } = buildCape(cape, body, silk).particles
  for (const i of hem) assertClose(position[3 * i + 1], 1.5 - 0.9)
})

test('a bound joint follows its cloth along a curve from the joint its part starts at, down its column', () => {
  const hemL: Vec3 = [-0.28, 0.55, 0.02]
  const hemR: Vec3 = [0.31, 0.6, -0.01]
  const flap: Part = {
    name: 'flap', shape: 'capsule', a: 'head', b: 'hemL', radiusA: 0.05, radiusB: 0.05, material: 'cloth'
  }
  const hems: Mannequin = { ...body, joints: { ...body.joints, hemL, hemR }, parts: [flap] }
  const system = buildCape(cape, hems, silk)
  const [left, right] = bindings(system, ['hemL', 'hemR'], hems)
  const column = (first: number): number[] => Array.from({ length: cape.rows }, (_, row) => first + row * cape.columns)
  assert.deepEqual(left.rings.map(ring => ring[0]), column(0))
  assert.deepEqual(right.rings.map(ring => ring[0]), column(cape.columns - 1).slice(1))
  assert.deepEqual([left.from, right.from], ['head', undefined])
  const root = { position: [1, 0.2, -3] as Vec3, yaw: 0.7, velocity: [0, 0, 0] as Vec3, angularVelocity: 0 }
  const p = system.particles.position
  const placed = p.slice()
  for (let i = 0; i < system.particles.count; i++) placed.set(toWorld(particleAt(p, i), root), 3 * i)
  const joints = Object.fromEntries(Object.entries(hems.joints).map(([name, at]) => [name, toWorld(at, root)]))
  const curve = curveOf(left, placed, root.yaw, joints)
  assert.equal(curve.length, cape.rows + 1)
  const [start, end] = [joints.head, joints.hemL]
  for (const point of curve) assertClose(length(cross(sub(point, start), sub(end, start))), 0, 1e-9)
  curve.at(-1)!.forEach((v, k) => { assertClose(v, end[k]) })
  const hem = left.rings.at(-1)!
  const swung = placed.slice()
  for (const i of hem) swung[3 * i + 2] += 0.2
  const bent = curveOf(left, swung, root.yaw, joints)
  assert.ok(bent.at(-1)![2] - end[2] > 0.1, `the end moved ${bent.at(-1)![2] - end[2]} m with its hem`)
  const arc = bent.slice(1).reduce((sum, point, i) => sum + length(sub(point, bent[i])), 0)
  assertClose(arc, length(sub(end, start)), 1e-9)
})
