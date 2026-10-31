import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateStyle } from '../src/formats/style.ts'
import type { Style } from '../src/formats/style.ts'
import { checkReferences } from '../src/formats/references.ts'
import type { Mannequin } from '../src/formats/mannequin.ts'
import { ball } from './rendering-fixtures.ts'

function valid () {
  return {
    name: 'test',
    light: [0, 1, 1],
    bands: [0, 0.6],
    outline: '#101010',
    innerLineDepth: 0.1,
    decalMinFacing: 0.3,
    materials: { skin: ['#300000', '#600000', '#900000'] },
    decalColors: { x: '#000000' }
  }
}

test('accepts a valid style', () => {
  assert.deepEqual(validateStyle(valid()).errors, [])
})

test('rejects a ramp whose length does not match the bands', () => {
  const input = valid()
  input.materials.skin = ['#300000', '#600000']
  const [error] = validateStyle(input).errors
  assert.equal(error.path, 'materials.skin')
  assert.match(error.message, /2 colours but bands define 3 shades/)
})

test('accepts both outline modes and keeps the field', () => {
  for (const outlineMode of ['uniform', 'selective']) {
    const result = validateStyle({ ...valid(), outlineMode })
    assert.deepEqual(result.errors, [])
    assert.equal(result.value?.outlineMode, outlineMode)
  }
})

test('rejects an unknown outline mode with the allowed values', () => {
  const [error] = validateStyle({ ...valid(), outlineMode: 'rainbow' }).errors
  assert.equal(error.path, 'outlineMode')
  assert.match(error.message, /'uniform' or 'selective'/)
})

test('rejects bands that are not ascending', () => {
  const input = valid()
  input.bands = [0.6, 0]
  assert.deepEqual(validateStyle(input).errors.map(e => e.path), ['bands'])
})

test('rejects malformed colours', () => {
  const input = valid()
  input.outline = 'black'
  assert.deepEqual(validateStyle(input).errors.map(e => e.path), ['outline'])
})

test('cross-check reports materials and decal characters the style lacks', () => {
  const style = validateStyle(valid()).value as Style
  const mannequin: Mannequin = {
    name: 'm',
    height: 1,
    joints: { o: [0, 0, 0] },
    parts: [ball('p', 'o', 1, 'metal')],
    decals: [{ name: 'd', anchor: 'o', normal: [0, 0, 1], pattern: ['x.y'] }]
  }
  const errors = checkReferences(mannequin, style)
  assert.deepEqual(errors.map(e => e.path), ['parts[0].material', 'decals[0].pattern'])
  assert.match(errors[1].message, /character 'y'/)
})

test('rejects unknown fields', () => {
  const input: Record<string, unknown> = valid()
  input.bandz = []
  const [error] = validateStyle(input).errors
  assert.equal(error.path, 'bandz')
  assert.match(error.message, /^unknown field 'bandz'; known fields: name, light, bands, /)
})

test('returned value does not alias the input', () => {
  const input = valid()
  const { value } = validateStyle(input)
  assert.notEqual(value, input)
  assert.notEqual(value?.materials, input.materials)
})

test('rejects a light vector whose length overflows', () => {
  const input = valid()
  input.light = [0, 0, 1e200]
  assert.deepEqual(validateStyle(input).errors.map(e => e.path), ['light'])
})
