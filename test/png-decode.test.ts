import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createImage, getPixel, imageHash, setPixel, TRANSPARENT } from '../src/image.ts'
import { decodePng } from '../src/png/decode.ts'
import { encodePng } from '../src/png/encode.ts'

test('decodePng reads back what encodePng writes', () => {
  const image = createImage(7, 5)
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 7; x++) if ((x + y) % 3 !== 0) setPixel(image, x, y, x * 0x251f + y * 0x3a0b1)
  }
  assert.equal(imageHash(decodePng(encodePng(image))), imageHash(image))
})

test('decodePng reads palette PNGs with 8-bit and 4-bit indices and palette transparency', () => {
  const refs: Array<[string, number[]]> = [
    ['bastianse-pixelknight-48.png', [35, 35]], ['marqueeplier-knight-64.png', [39, 63]]
  ]
  for (const [name, size] of refs) {
    const image = decodePng(readFileSync(new URL(`../refs/p1/${name}`, import.meta.url)))
    assert.deepEqual([image.width, image.height], size)
    assert.equal(getPixel(image, 0, 0), TRANSPARENT, name)
    let opaque = 0
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) if (getPixel(image, x, y) !== TRANSPARENT) opaque++
    }
    assert.ok(opaque > 100, `${name}: ${opaque} opaque pixels`)
  }
})

test('decodePng matches ImageMagick on a palette reference, pixel for pixel', (t) => {
  try {
    execFileSync('magick', ['-version'])
  } catch {
    t.skip('ImageMagick is not installed')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'pinata-png-'))
  try {
    const source = new URL('../refs/p1/marqueeplier-knight-64.png', import.meta.url).pathname
    const rgba = join(dir, 'knight.png')
    execFileSync('magick', [source, '-define', 'png:color-type=6', `PNG32:${rgba}`])
    assert.equal(imageHash(decodePng(readFileSync(source))), imageHash(decodePng(readFileSync(rgba))))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('decodePng rejects files that are not PNGs', () => {
  assert.throws(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), /not a PNG file/)
})
