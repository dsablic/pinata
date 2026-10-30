import { test } from 'node:test'
import assert from 'node:assert/strict'
import { outlineGaps, paletteSize, strayPixels, thinParts } from '../src/diagnostics/metrics.ts'
import { createImage, setPixel } from '../src/image.ts'
import { EMPTY } from '../src/raster/gbuffer.ts'
import type { GBuffer } from '../src/raster/gbuffer.ts'
import type { Mannequin } from '../src/formats/mannequin.ts'

const OUTLINE = 0x101010

test('outline gaps count fill pixels touching transparency or the edge', () => {
  const img = createImage(3, 3)
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) setPixel(img, x, y, OUTLINE)
  setPixel(img, 1, 1, 0xff0000)
  assert.equal(outlineGaps(img, OUTLINE), 0)
  setPixel(img, 1, 0, 0xff0000)
  assert.equal(outlineGaps(img, OUTLINE), 1)
})

test('stray pixels have no same-coloured neighbour, unless masked', () => {
  const img = createImage(3, 3)
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) setPixel(img, x, y, 0x00ff00)
  setPixel(img, 1, 1, 0xff0000)
  assert.equal(strayPixels(img, new Uint8Array(9)), 1)
  const mask = new Uint8Array(9)
  mask[4] = 1
  assert.equal(strayPixels(img, mask), 0)
})

test('palette size counts distinct opaque colours across images', () => {
  const a = createImage(2, 1)
  setPixel(a, 0, 0, 1)
  setPixel(a, 1, 0, 2)
  const b = createImage(1, 1)
  setPixel(b, 0, 0, 2)
  assert.equal(paletteSize([a, b]), 2)
})

test('thin parts are one pixel across in either direction', () => {
  const width = 6
  const g: GBuffer = {
    width,
    height: 4,
    part: new Int16Array(24).fill(EMPTY),
    depth: new Float32Array(24),
    normal: new Float32Array(72),
    coverage: new Float32Array(24)
  }
  for (let y = 0; y < 3; y++) {
    g.part[y * width] = 0
    g.part[y * width + 1] = 0
    g.part[y * width + 4] = 1
  }
  const part = { shape: 'capsule' as const, a: 'o', b: 'o', radiusA: 1, radiusB: 1, material: 'm' }
  const m: Mannequin = {
    name: 'm',
    height: 1,
    joints: { o: [0, 0, 0] },
    parts: [{ ...part, name: 'wide' }, { ...part, name: 'thin' }, { ...part, name: 'sword', allowThin: true }],
    decals: []
  }
  assert.deepEqual(thinParts(g, m), [
    { part: 'wide', pixels: 6, thinFraction: 0 },
    { part: 'thin', pixels: 3, thinFraction: 1 }
  ])
})

test('a part is not thin where nearer parts cover its sides, but is where farther parts or empty space do', () => {
  const part = { shape: 'capsule' as const, a: 'o', b: 'o', radiusA: 1, radiusB: 1, material: 'm' }
  const m: Mannequin = {
    name: 'm',
    height: 1,
    joints: { o: [0, 0, 0] },
    parts: [{ ...part, name: 'mid' }, { ...part, name: 'side' }],
    decals: []
  }
  const strip = (sideDepth: number): GBuffer => {
    const g: GBuffer = {
      width: 3,
      height: 3,
      part: new Int16Array(9).fill(EMPTY),
      depth: new Float32Array(9).fill(1),
      normal: new Float32Array(27),
      coverage: new Float32Array(9)
    }
    for (let y = 0; y < 3; y++) {
      for (const x of [0, 2]) {
        g.part[y * 3 + x] = 1
        g.depth[y * 3 + x] = sideDepth
      }
      g.part[y * 3 + 1] = 0
    }
    return g
  }
  assert.equal(thinParts(strip(0.5), m)[0].thinFraction, 0)
  assert.equal(thinParts(strip(2), m)[0].thinFraction, 1)
})
