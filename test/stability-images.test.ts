import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHANGED, differenceMap, differenceStrip, UNCHANGED } from '../src/diagnostics/stability-images.ts'
import { createImage, getPixel, setPixel, TRANSPARENT } from '../src/image.ts'

function frame (cells: Array<[number, number, number]>): ReturnType<typeof createImage> {
  const img = createImage(3, 1)
  for (const [x, y, c] of cells) setPixel(img, x, y, c)
  return img
}

test('a difference map marks changed pixels, appearing or vanishing, and greys the unchanged silhouette', () => {
  const before = frame([[0, 0, 0x111111], [1, 0, 0x222222]])
  const after = frame([[0, 0, 0x111111], [1, 0, 0x333333], [2, 0, 0x444444]])
  const map = differenceMap(before, after)
  assert.equal(getPixel(map, 0, 0), UNCHANGED)
  assert.equal(getPixel(map, 1, 0), CHANGED)
  assert.equal(getPixel(map, 2, 0), CHANGED)
  assert.equal(getPixel(differenceMap(after, before), 2, 0), CHANGED)
  assert.equal(getPixel(differenceMap(before, before), 2, 0), TRANSPARENT)
})

test('a difference strip lays one cell per frame', () => {
  const images = [0, 1, 2, 3].map(k => frame([[k % 3, 0, 0x111111]]))
  const strip = differenceStrip(images, { from: 1, count: 3, scale: 2, gap: 1, background: 0xffffff })
  assert.equal(strip.width, 3 * 3 * 2 + 4)
  assert.equal(strip.height, 2 + 2)
})
