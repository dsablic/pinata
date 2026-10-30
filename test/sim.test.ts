import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkScenario, validateScenario, validateSimMaterials } from '../src/formats/sim.ts'
import type { Scenario, SimMaterial } from '../src/formats/sim.ts'
import { validateMannequin } from '../src/formats/mannequin.ts'

function material (name = 'silk') {
  return { name, particleMass: 0.01, stretchCompliance: 1e-6, bendCompliance: 1e-3, damping: 0.3, drag: 0.02 }
}

function scenario () {
  return {
    name: 'turn-stop',
    body: '../p1-static-style/knight.json',
    bodyExcludeParts: ['cape'],
    script: {
      accelSeconds: 0.3,
      segments: [
        { action: 'move', speed: 1, duration: 2 },
        { action: 'turn', degrees: 90, duration: 1 },
        { action: 'hold', duration: 1 }
      ]
    },
    cape: { anchorLeft: 'base', anchorRight: 'top', columns: 5, rows: 6, length: 0.8, material: 'silk' },
    chains: [{ anchor: 'top', links: 6, linkLength: 0.05, direction: [0, 1, 0], material: 'wool' }],
    wind: { direction: [1, 0, 0], speed: 3, gust: 0.5 },
    gravity: [0, -9.81, 0],
    fps: 24,
    substeps: 10,
    particleRadius: 0.02
  }
}

function paths (input: unknown): string[] {
  return validateScenario(input).errors.map(e => e.path)
}

function mannequin () {
  const input = {
    name: 'blob',
    height: 2,
    joints: { base: [0, 0, 0], top: [0, 1, 0] },
    parts: [{ name: 'cape', shape: 'capsule', a: 'base', b: 'top', radiusA: 0.3, radiusB: 0.2, material: 'skin' }]
  }
  return validateMannequin(input).value!
}

test('accepts a valid scenario and copies it', () => {
  const input = scenario()
  const result = validateScenario(input)
  assert.deepEqual(result.errors, [])
  assert.notEqual(result.value?.script, input.script)
  assert.deepEqual(result.value, input)
})

test('cape, wind and duration are optional', () => {
  const input: Record<string, unknown> = scenario()
  delete input.cape
  delete input.wind
  assert.deepEqual(validateScenario(input).errors, [])
  input.durationSeconds = 4
  assert.equal(validateScenario(input).value?.durationSeconds, 4)
  input.durationSeconds = 0
  assert.deepEqual(paths(input), ['durationSeconds'])
})

test('rejects unknown keys with the known ones listed', () => {
  const input: Record<string, unknown> = scenario()
  input.windy = true
  const [error] = validateScenario(input).errors
  assert.equal(error.path, 'windy')
  assert.match(error.message, /unknown field 'windy'; known fields: name, body/)
})

test('rejects a non-object', () => {
  assert.deepEqual(paths(null), [''])
})

test('rejects bad script segments', () => {
  const input = scenario()
  input.script.segments[0] = { action: 'jump', speed: 1, duration: 1 }
  input.script.segments[1] = { action: 'turn', degrees: 90, duration: 0 }
  input.script.segments[2] = { action: 'hold', duration: 1, speed: 2 } as never
  input.script.accelSeconds = -1
  assert.deepEqual(paths(input).sort(), [
    'script.accelSeconds', 'script.segments[0].action', 'script.segments[1].duration', 'script.segments[2].speed'
  ])
})

test('rejects a cape grid smaller than 2 x 2 or non-integer', () => {
  const input = scenario()
  input.cape.columns = 1
  input.cape.rows = 2.5
  assert.deepEqual(paths(input), ['cape.columns', 'cape.rows'])
})

test('rejects chains with no links or a zero direction', () => {
  const input = scenario()
  input.chains[0].links = 0
  input.chains[0].direction = [0, 0, 0]
  assert.deepEqual(paths(input), ['chains[0].links', 'chains[0].direction'])
})

test('rejects wind with a gust outside 0..1', () => {
  const input = scenario()
  input.wind.gust = 1.5
  assert.deepEqual(paths(input), ['wind.gust'])
})

test('rejects non-positive fps, substeps and particle radius', () => {
  const input = scenario()
  input.fps = 0
  input.substeps = 2.5
  input.particleRadius = -1
  assert.deepEqual(paths(input), ['fps', 'substeps', 'particleRadius'])
})

test('rejects a bad gravity vector', () => {
  const input: Record<string, unknown> = scenario()
  input.gravity = [0, -9.81]
  assert.deepEqual(paths(input), ['gravity'])
})

test('accepts valid materials and rejects bad values and duplicates', () => {
  assert.deepEqual(validateSimMaterials([material('silk'), material('wool')]).errors, [])
  const bad = [{ ...material('silk'), damping: -1 }, { ...material('silk'), particleMass: 0 }]
  assert.deepEqual(validateSimMaterials(bad).errors.map(e => e.path), ['[0].damping', '[1].name', '[1].particleMass'])
  assert.deepEqual(validateSimMaterials({}).errors.map(e => e.path), [''])
})

test('materials with zero compliance are allowed', () => {
  const input = { ...material(), stretchCompliance: 0, bendCompliance: 0, drag: 0 }
  assert.deepEqual(validateSimMaterials([input]).errors, [])
})

test('checkScenario accepts a consistent scenario', () => {
  const s = validateScenario(scenario()).value as Scenario
  const materials = [material('silk'), material('wool')] as SimMaterial[]
  assert.deepEqual(checkScenario(s, mannequin(), materials), [])
})

test('checkScenario reports unknown joints, parts and materials with the known names', () => {
  const s = validateScenario(scenario()).value as Scenario
  s.cape!.anchorLeft = 'hip'
  s.chains[0].anchor = 'toe'
  s.bodyExcludeParts = ['plume']
  s.cape!.material = 'satin'
  const errors = checkScenario(s, mannequin(), [material('silk')] as SimMaterial[])
  assert.deepEqual(errors.map(e => e.path), [
    'bodyExcludeParts[0]', 'cape.anchorLeft', 'cape.material', 'chains[0].anchor', 'chains[0].material'
  ])
  assert.match(errors[0].message, /unknown part 'plume'; known parts: cape/)
  assert.match(errors[1].message, /unknown joint 'hip'; known joints: base, top/)
  assert.match(errors[2].message, /unknown material 'satin'; known materials: silk/)
})
