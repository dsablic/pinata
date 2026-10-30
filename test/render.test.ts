import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Scenario } from '../src/formats/sim.ts'
import { checkRenderMaterials, validateScenario } from '../src/formats/sim.ts'
import type { RootState } from '../src/motion/script.ts'
import { toWorld } from '../src/sim/body.ts'
import { clothParts, withClothParts } from '../src/sim/render.ts'
import { assertClose } from './helpers.ts'
import { mannequin } from './locomotion-fixtures.ts'

const scenario: Scenario = {
  name: 'walk',
  body: 'unused.json',
  bodyExcludeParts: [],
  script: { accelSeconds: 0.3, segments: [{ action: 'hold', duration: 1 }] },
  cape: {
    anchorLeft: 'shoulderL', anchorRight: 'shoulderR', columns: 3, rows: 2, length: 0.4, material: 'silk',
    render: { material: 'red', radius: 0.01 }
  },
  chains: [
    { anchor: 'head', links: 3, linkLength: 0.05, direction: [0, 1, 0], material: 'silk' },
    {
      anchor: 'head', links: 4, linkLength: 0.05, direction: [0, 1, 0], material: 'silk',
      render: { material: 'blue', radius: 0.02 }
    }
  ],
  gravity: [0, -9.81, 0],
  fps: 24,
  substeps: 8,
  particleRadius: 0.02
}

const count = 6 + 4 + 5
const positions = Float64Array.from({ length: 3 * count }, (_, i) => i * 0.1)
const root: RootState = { position: [1, 0, 2], yaw: 0.7, velocity: [0, 0, 0], angularVelocity: 0 }

test('draws only strands with a render entry, with one capsule per link and per grid edge', () => {
  const { joints, parts } = clothParts(scenario, positions, root)
  assert.equal(Object.keys(joints).filter(n => n.startsWith('cape.')).length, 6)
  assert.equal(Object.keys(joints).filter(n => n.startsWith('chain0.')).length, 0)
  assert.equal(Object.keys(joints).filter(n => n.startsWith('chain1.')).length, 5)
  assert.equal(parts.filter(p => p.name.startsWith('cape.')).length, 7)
  assert.equal(parts.filter(p => p.name.startsWith('chain1.')).length, 4)
  assert.equal(parts.length, 11)
})

test('parts take the render material and radius, join consecutive particles and are thin', () => {
  const { parts } = clothParts(scenario, positions, root)
  const link = parts.find(p => p.name === 'chain1.2-3')
  assert.deepEqual(
    [link?.a, link?.b, link?.material, link?.radiusA, link?.radiusB, link?.allowThin],
    ['chain1.2', 'chain1.3', 'blue', 0.02, 0.02, true]
  )
  assert.equal(parts.find(p => p.name === 'cape.0-1')?.material, 'red')
})

test('particle joints are expressed in the frame of the root', () => {
  const { joints } = clothParts(scenario, positions, root)
  const first = 6 + 4
  const world = toWorld(joints['chain1.0'], root)
  assertClose(world[0], positions[3 * first], 1e-12)
  assertClose(world[1], positions[3 * first + 1], 1e-12)
  assertClose(world[2], positions[3 * first + 2], 1e-12)
})

test('withClothParts appends to the mannequin without changing it', () => {
  const cloth = clothParts(scenario, positions, root)
  const merged = withClothParts(mannequin, cloth)
  assert.equal(merged.parts.length, mannequin.parts.length + cloth.parts.length)
  assert.deepEqual(merged.parts.slice(0, mannequin.parts.length), mannequin.parts)
  assert.equal(mannequin.parts.length, 2)
  assert.ok('chain1.4' in merged.joints && 'pelvis' in merged.joints)
})

test('render entries are validated and their materials checked against the style', () => {
  const bad = { ...scenario, chains: [{ ...scenario.chains[0], render: { material: '', radius: -1, extra: 1 } }] }
  const paths = validateScenario(bad).errors.map(e => e.path)
  assert.deepEqual(paths, ['chains[0].render.extra', 'chains[0].render.material', 'chains[0].render.radius'])
  assert.equal(validateScenario(scenario).errors.length, 0)
  const errors = checkRenderMaterials(scenario, ['red'])
  assert.deepEqual(errors.map(e => e.path), ['chains[1].render.material'])
})
