import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluate, summarize } from '../src/diagnostics/report.ts'
import { partImage, sheet } from '../src/diagnostics/images.ts'
import type { SheetCell } from '../src/diagnostics/images.ts'
import type { GBuffer } from '../src/raster/gbuffer.ts'
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
  const item: SheetCell = { image: cell, anchor: [0, 0] }
  const out = sheet([[item, item]], { scale: 2, gap: 1, background: 0x000000 })
  assert.equal(out.width, 2 * 2 + 3)
  assert.equal(out.height, 2 + 2)
  assert.equal(getPixel(out, 0, 0), 0x000000)
  assert.equal(getPixel(out, 1, 1), 0xff0000)
  assert.equal(getPixel(out, 2, 2), 0xff0000)
  assert.equal(getPixel(out, 4, 1), 0xff0000)
})

test('sheet aligns every cell on its anchor', () => {
  const small = createImage(2, 2)
  setPixel(small, 1, 1, 0xff0000)
  const large = createImage(4, 3)
  setPixel(large, 3, 2, 0x00ff00)
  const out = sheet([[{ image: small, anchor: [1, 1] }, { image: large, anchor: [3, 2] }]], {
    scale: 1,
    gap: 0,
    background: 0x000000
  })
  assert.equal(out.width, 8)
  assert.equal(out.height, 3)
  assert.equal(getPixel(out, 3, 2), 0xff0000)
  assert.equal(getPixel(out, 4 + 3, 2), 0x00ff00)
})

test('sheet scales the anchor offset with the cells', () => {
  const small = createImage(1, 1)
  setPixel(small, 0, 0, 0xff0000)
  const large = createImage(3, 3)
  setPixel(large, 1, 1, 0x00ff00)
  const out = sheet([[{ image: small, anchor: [0, 0] }, { image: large, anchor: [1, 1] }]], {
    scale: 2,
    gap: 1,
    background: 0x000000
  })
  assert.equal(getPixel(out, 1 + 2, 1 + 2), 0xff0000)
  assert.equal(getPixel(out, 1 + 6 + 1 + 2, 1 + 2), 0x00ff00)
})

test('partImage gives 24 parts 24 distinct colours', () => {
  const g: GBuffer = {
    width: 24,
    height: 1,
    part: Int16Array.from({ length: 24 }, (_, i) => i),
    depth: new Float32Array(24),
    normal: new Float32Array(72),
    coverage: new Float32Array(24)
  }
  const image = partImage(g)
  const colours = new Set(Array.from({ length: 24 }, (_, x) => getPixel(image, x, 0)))
  assert.equal(colours.size, 24)
})
