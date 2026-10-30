import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flickerFraction, partAreaJump } from '../src/diagnostics/stability.ts'
import { createImage, setPixel } from '../src/image.ts'
import type { Image } from '../src/image.ts'
import { EMPTY } from '../src/raster/gbuffer.ts'

const RED = 0xff0000
const BLUE = 0x0000ff

function filled (size: number, colour: number, edits: Array<[number, number, number]> = []): Image {
  const img = createImage(size, size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) setPixel(img, x, y, colour)
  for (const [x, y, c] of edits) setPixel(img, x, y, c)
  return img
}

test('flicker fraction is the share of silhouette pixels that change and change back', () => {
  const frames = [filled(4, RED), filled(4, RED, [[1, 1, BLUE], [2, 2, BLUE]]), filled(4, RED)]
  assert.equal(flickerFraction(frames), 2 / 16)
})

test('flicker fraction ignores a change that persists', () => {
  const frames = [filled(4, RED), filled(4, RED, [[1, 1, BLUE]]), filled(4, RED, [[1, 1, BLUE]])]
  assert.equal(flickerFraction(frames), 0)
})

test('flicker fraction ignores a band that grows and stays', () => {
  const band = (k: number): Array<[number, number, number]> => Array.from({ length: k }, (_, x) => [x, 0, BLUE])
  const frames = [0, 1, 2, 3].map(k => filled(4, RED, band(k)))
  assert.equal(flickerFraction(frames), 0)
})

test('flicker fraction counts a pixel appearing for one frame', () => {
  const blank = createImage(4, 4)
  const lit = createImage(4, 4)
  setPixel(lit, 0, 0, RED)
  setPixel(lit, 1, 0, RED)
  assert.equal(flickerFraction([blank, lit, blank]), 1)
})

test('flicker fraction takes the worst frame and is zero for fewer than three frames', () => {
  const quiet = filled(4, RED)
  const noisy = filled(4, RED, [[0, 0, BLUE], [1, 0, BLUE], [2, 0, BLUE], [3, 0, BLUE]])
  assert.equal(flickerFraction([quiet, noisy, quiet, quiet, noisy, noisy]), 4 / 16)
  assert.equal(flickerFraction([quiet, noisy]), 0)
})

function partMap (width: number, height: number, cells: Array<[number, number, number]>): {
  width: number, height: number, part: Int16Array
} {
  const part = new Int16Array(width * height).fill(EMPTY)
  for (const [x, y, p] of cells) part[y * width + x] = p
  return { width, height, part }
}

function block (x0: number, y0: number, w: number, h: number, part: number): Array<[number, number, number]> {
  const cells: Array<[number, number, number]> = []
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) cells.push([x, y, part])
  return cells
}

test('part area jump is the relative change in pixel count when the bounding box is still', () => {
  const cells = block(2, 2, 4, 5, 0)
  const a = partMap(20, 20, cells)
  const b = partMap(20, 20, cells.slice(0, 19))
  const c = partMap(20, 20, cells.slice(0, 17))
  assert.equal(partAreaJump([a, a]), 0)
  assert.equal(partAreaJump([a, b]), 1 / 20)
  assert.equal(partAreaJump([a, c]), 3 / 20)
})

test('part area jump skips frames where the bounding box moves by a pixel or more', () => {
  const a = partMap(20, 20, block(2, 2, 4, 4, 0))
  const wider = partMap(20, 20, block(2, 2, 5, 4, 0))
  const shifted = partMap(20, 20, block(3, 2, 4, 4, 0))
  assert.equal(partAreaJump([a, wider]), 0)
  assert.equal(partAreaJump([a, shifted]), 0)
})

test('part area jump ignores parts under 8 pixels and takes the worst part and frame', () => {
  const tiny = partMap(20, 20, block(0, 0, 2, 3, 1))
  const tinyLess = partMap(20, 20, block(0, 0, 2, 3, 1).slice(0, 4))
  assert.equal(partAreaJump([tiny, tinyLess]), 0)
  const big = block(5, 5, 4, 4, 0)
  const small = block(12, 12, 4, 4, 1)
  const frames = [
    partMap(20, 20, [...big, ...small]),
    partMap(20, 20, [...big, ...small.slice(0, 14)]),
    partMap(20, 20, [...big.slice(0, 8), ...small])
  ]
  assert.equal(partAreaJump(frames), 2 / 14)
})
