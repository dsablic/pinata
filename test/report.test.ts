import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluate, summarize } from '../src/diagnostics/report.ts'
import { sheet } from '../src/diagnostics/images.ts'
import { createImage, getPixel, setPixel } from '../src/image.ts'

test('evaluate applies each gate operator', () => {
  const results = evaluate([
    { name: 'a', value: 1, op: '<=', threshold: 1, rationale: '' },
    { name: 'b', value: 1, op: '>=', threshold: 2, rationale: '' }
  ])
  assert.deepEqual(results.map(r => r.pass), [true, false])
})

test('summary lists every gate and the overall verdict', () => {
  const text = summarize('P1', evaluate([{ name: 'gaps', value: 0.5, op: '<=', threshold: 0, rationale: '' }]))
  assert.match(text, /FAIL {2}gaps: 0\.500 <= 0/)
  assert.match(text, /automated gates: FAIL$/)
})

test('sheet upscales cells onto a background grid', () => {
  const cell = createImage(1, 1)
  setPixel(cell, 0, 0, 0xff0000)
  const out = sheet([[cell, cell]], { scale: 2, gap: 1, background: 0x000000 })
  assert.equal(out.width, 2 * 2 + 3)
  assert.equal(out.height, 2 + 2)
  assert.equal(getPixel(out, 0, 0), 0x000000)
  assert.equal(getPixel(out, 1, 1), 0xff0000)
  assert.equal(getPixel(out, 2, 2), 0xff0000)
  assert.equal(getPixel(out, 4, 1), 0xff0000)
})
