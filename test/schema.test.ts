import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from '../src/formats/schema.ts'
import type { Schema } from '../src/formats/schema.ts'
import type { ValidationError } from '../src/formats/validate.ts'

const SHAPE: Schema = {
  kind: 'object',
  fields: {
    size: { kind: 'number', min: 1, max: 10, integer: true, note: 'cells' },
    tint: { kind: 'colour' },
    span: { kind: 'range', min: 0, max: 5 },
    tags: { kind: 'array', of: { kind: 'string', oneOf: ['a', 'b'] }, minItems: 1 },
    parts: {
      kind: 'map',
      of: {
        kind: 'union',
        by: 'do',
        cases: {
          move: { fields: { speed: { kind: 'number', min: 0 } } },
          wait: { fields: { seconds: { kind: 'number', min: 0 }, say: { kind: 'string' } }, optional: ['say'] }
        }
      }
    }
  },
  optional: ['tags']
}

function errorsOf (value: unknown): ValidationError[] {
  const errors: ValidationError[] = []
  check(value, SHAPE, '', errors)
  return errors
}

test('a valid value has no errors, and optional fields may be left out', () => {
  const parts = { one: { do: 'move', speed: 1 }, two: { do: 'wait', seconds: 1 } }
  const ok = { size: 3, tint: '#a8642c', span: [1, 2], parts }
  assert.deepEqual(errorsOf(ok), [])
  assert.deepEqual(errorsOf({ ...ok, tags: ['a'] }), [])
})

test('every problem is reported once with its path and an actionable message', () => {
  const errors = errorsOf({
    size: 2.5,
    tint: 'red',
    span: [3, 1],
    tags: ['c'],
    parts: { one: { do: 'fly' }, two: { do: 'wait', seconds: -1, extra: 1 } },
    other: true
  })
  assert.deepEqual(errors.map(e => e.path), [
    'other', 'size', 'tint', 'span', 'tags[0]', 'parts.one.do', 'parts.two.extra', 'parts.two.seconds'
  ])
  assert.equal(errors[1].message, 'expected a whole number from 1 to 10: cells')
  assert.match(errors[5].message, /"do" is one of move, wait/)
  assert.match(errors[0].message, /unknown field; expected size, tint, span, tags, parts/)
})
