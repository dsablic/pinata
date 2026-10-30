import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateMannequin } from '../src/formats/mannequin.ts'

function valid () {
  return {
    name: 'blob',
    height: 2,
    joints: { base: [0, 0, 0], top: [0, 1, 0] },
    parts: [
      { name: 'body', shape: 'capsule', a: 'base', b: 'top', radiusA: 0.3, radiusB: 0.2, material: 'skin' },
      {
        name: 'cape',
        shape: 'box',
        a: 'top',
        b: 'base',
        width: 0.5,
        thickness: 0.05,
        rounding: 0.02,
        widthAxis: [1, 0, 0],
        material: 'cloth'
      }
    ],
    decals: [{ name: 'eye', anchor: 'top', normal: [0, 0, 1], pattern: ['x.x'] }]
  }
}

function paths (input: unknown): string[] {
  return validateMannequin(input).errors.map(e => e.path)
}

test('accepts a valid mannequin', () => {
  const result = validateMannequin(valid())
  assert.deepEqual(result.errors, [])
  assert.equal(result.value?.parts.length, 2)
})

test('decals default to an empty list', () => {
  const input: Record<string, unknown> = valid()
  delete input.decals
  assert.deepEqual(validateMannequin(input).value?.decals, [])
})

test('reports unknown joints with the known joint names', () => {
  const input = valid()
  input.parts[0].b = 'neck'
  const [error] = validateMannequin(input).errors
  assert.equal(error.path, 'parts[0].b')
  assert.match(error.message, /unknown joint 'neck'; known joints: base, top/)
})

test('rejects a joint called toString instead of matching the prototype', () => {
  const input = valid()
  input.parts[0].a = 'toString'
  assert.deepEqual(paths(input), ['parts[0].a'])
})

test('rejects duplicate part names', () => {
  const input = valid()
  input.parts[1].name = 'body'
  assert.deepEqual(paths(input), ['parts[1].name'])
})

test('rejects rounding larger than half the thinnest box side', () => {
  const input = valid()
  input.parts[1].rounding = 0.1
  assert.deepEqual(paths(input), ['parts[1].rounding'])
})

test('rejects a width axis parallel to the box', () => {
  const input = valid()
  input.parts[1].widthAxis = [0, 1, 0]
  assert.deepEqual(paths(input), ['parts[1].widthAxis'])
})

test('rejects a capsule whose end spheres swallow each other', () => {
  const input = valid()
  input.parts[0].radiusA = 2
  assert.deepEqual(paths(input), ['parts[0]'])
})

test('rejects ragged decal patterns', () => {
  const input = valid()
  input.decals[0].pattern = ['x.x', 'x']
  assert.deepEqual(paths(input), ['decals[0].pattern'])
})

test('rejects unknown shapes', () => {
  const input = valid()
  input.parts[0].shape = 'cone'
  assert.deepEqual(paths(input), ['parts[0].shape'])
})

test('rejects unknown fields at the root, parts and decals', () => {
  const input: Record<string, any> = valid()
  input.decal = []
  input.parts[0].allowthin = true
  input.parts[0].width = 1
  input.parts[1].radiusA = 1
  input.decals[0].colour = 'x'
  assert.deepEqual(
    paths(input),
    ['decal', 'parts[0].allowthin', 'parts[0].width', 'parts[1].radiusA', 'decals[0].colour']
  )
})

test('unknown field message lists the known fields', () => {
  const input: Record<string, any> = valid()
  input.decal = []
  assert.equal(
    validateMannequin(input).errors[0].message,
    "unknown field 'decal'; known fields: name, height, joints, parts, decals"
  )
})

test('returned value does not alias the input', () => {
  const input = valid()
  const { value } = validateMannequin(input)
  assert.notEqual(value, input)
  assert.notEqual(value?.joints, input.joints)
  assert.notEqual(value?.parts[0], input.parts[0])
})
