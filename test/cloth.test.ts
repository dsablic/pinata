import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Mannequin } from '../src/formats/mannequin.ts'
import type { Chain, SimMaterial } from '../src/formats/sim.ts'
import { buildCape, buildChain, mergeSystems } from '../src/sim/cloth.ts'
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

test('a chain has links + 1 particles, a pinned root and structural plus bending constraints', () => {
  const chain: Chain = { anchor: 'head', links: 6, linkLength: 0.05, direction: [0, 2, 0], material: 'wool' }
  const system = buildChain(chain, body, wool)
  assert.equal(system.particles.count, 7)
  assert.equal(system.constraints.length, 6 + 5)
  assert.deepEqual(system.pins.map(pin => pin.particle), [0])
  assert.equal(system.particles.inverseMass[0], 0)
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
  assert.equal(merged.pins.length, 4)
  assert.equal(merged.pins[3].particle, 12)
  const last = merged.constraints[merged.constraints.length - 1]
  assert.ok(last.a >= 12 && last.b >= 12)
  assert.equal(merged.material[merged.particles.materialIndex[0]].name, 'silk')
  assert.equal(merged.material[merged.particles.materialIndex[14]].name, 'wool')
  assert.equal(merged.particles.previous.length, 45)
})
