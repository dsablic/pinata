import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createImage, getPixel, neighbours4, parseHex, setPixel, TRANSPARENT, upscale } from '../src/image.ts'
import { imageHash } from '../src/image-hash.ts'

test('pixels round-trip as packed RGB and start transparent', () => {
  const img = createImage(2, 2)
  assert.equal(getPixel(img, 0, 0), TRANSPARENT)
  setPixel(img, 1, 0, 0x123456)
  assert.equal(getPixel(img, 1, 0), 0x123456)
  setPixel(img, 1, 0, TRANSPARENT)
  assert.equal(getPixel(img, 1, 0), TRANSPARENT)
})

test('reads outside the image are transparent', () => {
  assert.equal(getPixel(createImage(1, 1), -1, 0), TRANSPARENT)
})

test('neighbours4 returns right, left, down, up', () => {
  const img = createImage(3, 3)
  setPixel(img, 2, 1, 1)
  setPixel(img, 0, 1, 2)
  setPixel(img, 1, 2, 3)
  setPixel(img, 1, 0, 4)
  assert.deepEqual(neighbours4(img, 1, 1), [1, 2, 3, 4])
})

test('parseHex reads #rrggbb', () => {
  assert.equal(parseHex('#ff8000'), 0xff8000)
})

test('imageHash changes when a pixel changes', () => {
  const img = createImage(2, 2)
  const before = imageHash(img)
  setPixel(img, 0, 0, 0xffffff)
  assert.notEqual(imageHash(img), before)
})

test('writes outside the image are ignored', () => {
  const img = createImage(2, 2)
  setPixel(img, -1, 0, 0xffffff)
  setPixel(img, 2, 0, 0xffffff)
  setPixel(img, 0, 2, 0xffffff)
  assert.ok(img.data.every((v) => v === 0))
})

test('upscale repeats each pixel factor times in both directions', () => {
  const img = createImage(2, 1)
  setPixel(img, 0, 0, 0xff0000)
  const big = upscale(img, 3)
  assert.equal(big.width, 6)
  assert.equal(big.height, 3)
  assert.equal(getPixel(big, 2, 2), 0xff0000)
  assert.equal(getPixel(big, 3, 0), TRANSPARENT)
})
