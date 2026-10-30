import { test } from 'node:test'
import assert from 'node:assert/strict'
import { add, cross, dot, length, normalize, scale, sub } from '../src/math/vec.ts'
import { assertClose } from './helpers.ts'

test('add, sub and scale work per component', () => {
  assert.deepEqual(add([1, 2, 3], [4, 5, 6]), [5, 7, 9])
  assert.deepEqual(sub([4, 5, 6], [1, 2, 3]), [3, 3, 3])
  assert.deepEqual(scale([1, 2, 3], 2), [2, 4, 6])
})

test('cross of x and y is z', () => {
  assert.deepEqual(cross([1, 0, 0], [0, 1, 0]), [0, 0, 1])
})

test('dot and length', () => {
  assert.equal(dot([1, 2, 3], [4, 5, 6]), 32)
  assert.equal(length([3, 4, 0]), 5)
})

test('normalize returns a unit vector and leaves zero alone', () => {
  assertClose(length(normalize([3, 4, 12])), 1)
  assert.deepEqual(normalize([0, 0, 0]), [0, 0, 0])
})
