import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'
import { createImage, setPixel } from '../src/image.ts'
import { crc32, encodePng } from '../src/png/encode.ts'

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
})

test('encodes a 1x1 red pixel', () => {
  const img = createImage(1, 1)
  setPixel(img, 0, 0, 0xff0000)
  const png = encodePng(img)
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  assert.equal(png.toString('ascii', 12, 16), 'IHDR')
  assert.equal(png.readUInt32BE(16), 1)
  assert.equal(png.readUInt32BE(20), 1)
  const idatLength = png.readUInt32BE(33)
  assert.equal(png.toString('ascii', 37, 41), 'IDAT')
  const raw = inflateSync(png.subarray(41, 41 + idatLength))
  assert.deepEqual([...raw], [0, 255, 0, 0, 255])
  assert.equal(png.toString('ascii', png.length - 8, png.length - 4), 'IEND')
})
