import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'
import { createImage, setPixel } from '../src/image.ts'
import { crc32, encodeApng, encodePng } from '../src/png/encode.ts'

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

function chunkTypes (png: Buffer): Array<{ type: string, body: Buffer }> {
  const out: Array<{ type: string, body: Buffer }> = []
  let at = 8
  while (at < png.length) {
    const length = png.readUInt32BE(at)
    const type = png.toString('ascii', at + 4, at + 8)
    const body = png.subarray(at + 8, at + 8 + length)
    assert.equal(png.readUInt32BE(at + 8 + length), crc32(png.subarray(at + 4, at + 8 + length)))
    out.push({ type, body })
    at += 12 + length
  }
  return out
}

function solid (rgb: number): ReturnType<typeof createImage> {
  const img = createImage(3, 2)
  for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) setPixel(img, x, y, rgb)
  return img
}

test('encodes an animated PNG with a control chunk and sequenced frame chunks', () => {
  const frames = [solid(0xff0000), solid(0x00ff00), solid(0x0000ff)]
  const chunks = chunkTypes(encodeApng(frames, { delayNum: 1, delayDen: 12 }))
  assert.deepEqual(chunks.map(c => c.type), ['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'fcTL', 'fdAT', 'IEND'])
  const actl = chunks[1].body
  assert.equal(actl.readUInt32BE(0), 3)
  assert.equal(actl.readUInt32BE(4), 0)
  const sequences = chunks.filter(c => c.type === 'fcTL' || c.type === 'fdAT').map(c => c.body.readUInt32BE(0))
  assert.deepEqual(sequences, [0, 1, 2, 3, 4])
  const fctl = chunks[2].body
  assert.equal(fctl.readUInt32BE(4), 3)
  assert.equal(fctl.readUInt32BE(8), 2)
  assert.equal(fctl.readUInt16BE(20), 1)
  assert.equal(fctl.readUInt16BE(22), 12)
  const second = inflateSync(chunks[5].body.subarray(4))
  assert.deepEqual([...second.subarray(0, 5)], [0, 0, 255, 0, 255])
})

test('rejects an empty or mixed-size animation', () => {
  assert.throws(() => encodeApng([], { delayNum: 1, delayDen: 24 }), RangeError)
  assert.throws(() => encodeApng([solid(0), createImage(1, 1)], { delayNum: 1, delayDen: 24 }), RangeError)
})
