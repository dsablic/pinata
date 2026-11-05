import { test } from 'node:test'
import assert from 'node:assert/strict'
import { widestStride } from '../src/export/stride.ts'
import { feetFrame } from './export-fixtures.ts'

const foot = (x: number, y: number) => ({ planted: false, sole: { x, y }, drawn: { x, y }, level: 0 })
const hidden = { planted: false, sole: undefined, drawn: undefined, level: 0 }

test('the mid-stride frame is the one with the feet furthest apart, in both axes', () => {
  const together = feetFrame([foot(0, 0), foot(1, 0)])
  const apartInDepth = feetFrame([foot(0, 0), foot(1, 2)])
  const apartSideways = feetFrame([foot(0, 0), foot(4, 0)])
  assert.equal(widestStride([together, apartInDepth, apartSideways]), apartSideways)
  assert.equal(widestStride([together, apartInDepth]), apartInDepth)
})

test('frames with a hidden foot lose to frames with both feet, and the first frame wins a tie', () => {
  const seen = feetFrame([foot(0, 0), foot(1, 0)])
  const again = feetFrame([foot(0, 0), foot(1, 0)])
  assert.equal(widestStride([feetFrame([foot(0, 0), hidden]), seen, again]), seen)
  const allHidden = feetFrame([hidden, hidden])
  assert.equal(widestStride([allHidden, feetFrame([hidden, foot(0, 0)])]), allHidden)
})
