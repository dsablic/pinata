import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkSkin, validateSkin } from '../src/formats/skin.ts'
import type { Mannequin } from '../src/formats/mannequin.ts'

function valid () {
  return {
    name: 'tiny',
    view: 'side-right',
    palette: { a: '#102030', b: '#C0D0E0' },
    parts: {
      arm: { rows: ['.aaab', '.aaab'], pivotA: [1, 0], pivotB: [4, 0] },
      head: { rows: ['ab', 'ba'], pivotA: [1, 1], pivotB: [1, 1] },
      cape: { hidden: true }
    }
  }
}

function paths (input: unknown): string[] {
  return [...new Set(validateSkin(input).errors.map(e => e.path))]
}

const mannequin = {
  name: 'm',
  height: 1,
  joints: { s: [0, 0, 0], e: [0, 1, 0] },
  parts: [
    { name: 'arm', shape: 'capsule', a: 's', b: 'e', radiusA: 0.1, radiusB: 0.1, material: 'x' },
    { name: 'head', shape: 'capsule', a: 'e', b: 'e', radiusA: 0.1, radiusB: 0.1, material: 'x' },
    { name: 'cape', shape: 'capsule', a: 's', b: 'e', radiusA: 0.1, radiusB: 0.1, material: 'x' }
  ],
  decals: []
} as Mannequin

test('a valid skin passes and keeps its fields', () => {
  const { value, errors } = validateSkin(valid())
  assert.deepEqual(errors, [])
  assert.equal(value?.parts.arm.rows?.length, 2)
})

test('rejects non-objects and unknown fields', () => {
  assert.deepEqual(paths(null), [''])
  assert.deepEqual(paths({ ...valid(), extra: 1 }), ['extra'])
})

test('rejects another view', () => {
  assert.deepEqual(paths({ ...valid(), view: 'front' }), ['view'])
})

test('palette: single characters, hex colours, at most 16, no transparent key', () => {
  assert.ok(paths({ ...valid(), palette: { ab: '#102030' } }).includes('palette.ab'))
  assert.ok(paths({ ...valid(), palette: { a: 'red' } }).includes('palette.a'))
  assert.ok(paths({ ...valid(), palette: { '.': '#102030' } }).includes('palette..'))
  const many = Object.fromEntries('abcdefghijklmnopq'.split('').map(c => [c, '#102030']))
  assert.ok(paths({ ...valid(), palette: many }).includes('palette'))
})

test('rows must be equal length, known characters, with an opaque pixel', () => {
  const skin = valid()
  skin.parts.arm.rows = ['.aaab', '.aa']
  assert.deepEqual(paths(skin), ['parts.arm.rows'])
  skin.parts.arm.rows = ['.aaxb', '.aaab']
  const [error] = validateSkin(skin).errors
  assert.equal(error.path, 'parts.arm.rows[0]')
  assert.match(error.message, /'x' at column 3.*palette/)
  skin.parts.arm.rows = ['.....', '.....']
  assert.deepEqual(paths(skin), ['parts.arm.rows'])
})

test('pivots must be integer pixels inside the sprite', () => {
  const skin = valid()
  skin.parts.arm.pivotA = [9, 0]
  assert.deepEqual(paths(skin), ['parts.arm.pivotA'])
  skin.parts.arm.pivotA = [0.5, 0]
  assert.deepEqual(paths(skin), ['parts.arm.pivotA'])
})

test('a hidden part needs no rows, a visible one does', () => {
  const skin = valid() as { parts: Record<string, unknown> }
  skin.parts.arm = { pivotA: [0, 0] }
  assert.deepEqual(paths(skin), ['parts.arm.rows'])
})

test('checkSkin passes a complete skin', () => {
  const { value } = validateSkin(valid())
  assert.deepEqual(checkSkin(value as never, mannequin), [])
})

test('checkSkin names a missing part and suggests hidden', () => {
  const skin = valid() as { parts: Record<string, unknown> }
  delete skin.parts.head
  const errors = checkSkin(validateSkin(skin).value as never, mannequin)
  assert.equal(errors.length, 1)
  assert.equal(errors[0].path, 'parts.head')
  assert.match(errors[0].message, /hidden/)
})

test('checkSkin rejects a sprite for an unknown part', () => {
  const skin = valid() as { parts: Record<string, unknown> }
  skin.parts.wing = { rows: ['a'], pivotA: [0, 0] }
  const errors = checkSkin(validateSkin(skin).value as never, mannequin)
  assert.deepEqual(errors.map(e => e.path), ['parts.wing'])
})

test('checkSkin needs pivotB to lie to the right of pivotA on the same row for two-joint parts', () => {
  const skin = valid()
  skin.parts.arm.pivotB = [1, 1]
  const errors = checkSkin(validateSkin(skin).value as never, mannequin)
  assert.deepEqual(errors.map(e => e.path), ['parts.arm.pivotB'])
  const missing = valid() as { parts: Record<string, Record<string, unknown>> }
  delete missing.parts.arm.pivotB
  assert.deepEqual(checkSkin(validateSkin(missing).value as never, mannequin).map(e => e.path), ['parts.arm.pivotB'])
})
