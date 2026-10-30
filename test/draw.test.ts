import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createImage, getPixel, TRANSPARENT } from '../src/image.ts'
import { disc, line, plot } from '../src/diagnostics/draw.ts'

function painted (img: ReturnType<typeof createImage>, rgb: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) if (getPixel(img, x, y) === rgb) out.push([x, y])
  }
  return out
}

test('line paints both endpoints and a connected run of pixels', () => {
  const img = createImage(20, 20)
  line(img, 2, 3, 15, 9, 0xff0000)
  assert.equal(getPixel(img, 2, 3), 0xff0000)
  assert.equal(getPixel(img, 15, 9), 0xff0000)
  assert.equal(painted(img, 0xff0000).length, 14)
})

test('line handles steep, reversed and degenerate segments', () => {
  const img = createImage(10, 10)
  line(img, 5, 8, 5, 1, 1)
  assert.equal(painted(img, 1).length, 8)
  line(img, 4, 4, 4, 4, 2)
  assert.deepEqual(painted(img, 2), [[4, 4]])
})

test('line clips instead of throwing when endpoints are outside the image', () => {
  const img = createImage(10, 10)
  line(img, -5, 5, 20, 5, 3)
  assert.equal(painted(img, 3).length, 10)
})

test('disc fills a round area around its centre and stays in bounds', () => {
  const img = createImage(20, 20)
  disc(img, 10, 10, 3, 0x00ff00)
  assert.equal(getPixel(img, 10, 10), 0x00ff00)
  assert.equal(getPixel(img, 13, 10), 0x00ff00)
  assert.equal(getPixel(img, 14, 10), TRANSPARENT)
  assert.equal(getPixel(img, 13, 13), TRANSPARENT)
  disc(img, 0, 0, 5, 0x0000ff)
  assert.equal(getPixel(img, 0, 0), 0x0000ff)
})

test('plot returns an image of the requested size with traces inside the plot area', () => {
  const img = plot(
    [{ values: [0, 1, 2, 1, 0], rgb: 0xff0000 }, { values: [-1, -1, -1], rgb: 0x0000ff }],
    { width: 200, height: 100, yMin: -2, yMax: 2 }
  )
  assert.equal(img.width, 200)
  assert.equal(img.height, 100)
  const red = painted(img, 0xff0000)
  assert.ok(red.length > 0)
  const blue = painted(img, 0x0000ff)
  assert.ok(blue.length >= 100)
  for (const [x, y] of [...red, ...blue]) {
    assert.ok(x > 0 && x < 200 && y > 0 && y < 100)
  }
  const ys = blue.map(p => p[1])
  assert.equal(new Set(ys).size, 1)
  assert.ok(ys[0] > 50)
})

test('plot draws axes in the left and bottom margins and clamps out-of-range values', () => {
  const img = plot([{ values: [10, -10], rgb: 0xff0000 }], { width: 100, height: 100, yMin: 0, yMax: 1 })
  const axis = painted(img, 0x000000)
  assert.ok(axis.length >= 150)
  for (const [x, y] of painted(img, 0xff0000)) assert.ok(x >= 0 && x < 100 && y >= 0 && y < 100)
})
