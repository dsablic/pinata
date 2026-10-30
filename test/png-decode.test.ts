import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createImage, getPixel, setPixel, TRANSPARENT } from '../src/image.ts'
import { imageHash } from '../src/image-hash.ts'
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

const FORMATS: Array<[string, string[]]> = [
  ['palette', ['-define', 'png:color-type=3']],
  ['RGB with tRNS', ['-define', 'png:color-type=2', '-define', 'png:bit-depth=8']],
  ['grey with tRNS', ['-colorspace', 'Gray', '-define', 'png:color-type=0', '-define', 'png:bit-depth=8']],
  ['grey 2-bit', ['-colorspace', 'Gray', '-alpha', 'off', '-depth', '2']],
  ['grey and alpha', ['-colorspace', 'Gray', '-define', 'png:color-type=4']],
  ['RGBA 16-bit', ['-define', 'png:color-type=6', '-define', 'png:bit-depth=16']]
]

test('decodePng matches ImageMagick on every colour type, pixel for pixel', (t) => {
  try {
    execFileSync('magick', ['-version'])
  } catch {
    t.skip('ImageMagick is not installed')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'pinata-png-'))
  try {
    const source = new URL('../refs/p1/marqueeplier-knight-64.png', import.meta.url).pathname
    FORMATS.forEach(([name, options], i) => {
      const file = join(dir, `${i}.png`)
      const truth = join(dir, `${i}-rgba.png`)
      execFileSync('magick', [source, ...options, file])
      execFileSync('magick', [file, '-define', 'png:color-type=6', '-define', 'png:bit-depth=8', `PNG32:${truth}`])
      const ours = decodePng(readFileSync(file))
      const theirs = decodePng(readFileSync(truth))
      const opaque = (img: typeof ours): number[] => {
        const { width, height } = img
        return Array.from({ length: width * height }, (_, k) => getPixel(img, k % width, Math.floor(k / width)))
      }
      assert.deepEqual(opaque(ours), opaque(theirs), name)
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('decodePng rejects files that are not PNGs', () => {
  assert.throws(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), /not a PNG file/)
})
