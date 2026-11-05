import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dropFrames, removeWindUp, slideFeet, windUpLength } from '../src/benchmark/degrade.ts'
import { atRate, grid, sliceSheet } from '../src/benchmark/frames.ts'
import type { Clip } from '../src/benchmark/frames.ts'
import { encodeGif } from '../src/benchmark/gif.ts'
import { createImage, getPixel, setPixel, TRANSPARENT } from '../src/image.ts'
import type { Image } from '../src/image.ts'

const frameWith = (x: number, y: number, width = 8, height = 10): Image => {
  const image = createImage(width, height)
  setPixel(image, x, y, 0x112233)
  setPixel(image, x, height - 1, 0x445566)
  return image
}
const clipOf = (frames: Image[]): Clip => ({ name: 'c', frames, fps: 12 })
const drawnAt = (image: Image, y: number): number[] => {
  return Array.from({ length: image.width }, (_, x) => x).filter(x => getPixel(image, x, y) !== TRANSPARENT)
}

const shapeOf = (clip: Clip): unknown[] => [clip.frames.length, clip.fps, clip.frames[0].width, clip.frames[0].height]
const litColumns = (image: Image): number => drawnAt(image, 0).length

test('dropping frames holds every kept frame for two steps and keeps the length, rate and canvas', () => {
  const clip = clipOf([0, 1, 2, 3, 4, 5, 6].map(i => frameWith(i, 0)))
  const { clip: dropped } = dropFrames(clip)
  assert.deepEqual(shapeOf(dropped), shapeOf(clip))
  assert.deepEqual(dropped.frames.map(f => drawnAt(f, 0)), [[0], [0], [2], [2], [4], [4], [6]])
})

test('sliding the feet moves only the lowest rows, back and forth, with no jump at the loop', () => {
  const clip = clipOf([0, 1, 2, 3].map(() => frameWith(2, 3)))
  const { clip: slid } = slideFeet(clip)
  assert.deepEqual(shapeOf(slid), shapeOf(clip))
  assert.deepEqual(slid.frames.map(f => drawnAt(f, 3)), [[2], [2], [2], [2]])
  assert.deepEqual(slid.frames.map(f => drawnAt(f, 9)), [[2], [3], [4], [3]])
  assert.deepEqual(slid.frames.map(f => drawnAt(f, 5)), [[], [], [], []])
})

test('the feet slide towards the side with room and never leave the canvas', () => {
  const nearRight = clipOf([0, 1, 2, 3, 4, 5].map(() => frameWith(6, 3)))
  const { clip } = slideFeet(nearRight)
  const columns = clip.frames.map(f => drawnAt(f, 9))
  assert.deepEqual(columns.map(c => c.length), [1, 1, 1, 1, 1, 1])
  assert.deepEqual(columns.map(c => c[0]), [6, 5, 4, 3, 4, 5])
  const packed = clipOf([0, 1].map(() => {
    const wide = createImage(2, 10)
    setPixel(wide, 0, 9, 1)
    setPixel(wide, 1, 9, 2)
    return wide
  }))
  assert.throws(() => slideFeet(packed), /no room/)
})

test('removing the wind-up holds the strike frame for the removed steps, and removes nothing else', () => {
  const lit = (columns: number): Image => {
    const image = createImage(8, 10)
    for (let x = 0; x < columns; x++) setPixel(image, x, 0, 0x112233)
    return image
  }
  const clip = clipOf([lit(1), lit(2), lit(2), lit(8), lit(7), lit(6)])
  const { clip: cut } = removeWindUp(clip)
  assert.equal(windUpLength(clip), 3)
  assert.deepEqual(shapeOf(cut), shapeOf(clip))
  assert.deepEqual(cut.frames.map(litColumns), [8, 8, 8, 8, 7, 6])
  const early = clipOf([lit(1), lit(8), lit(7), lit(6), lit(5), lit(4)])
  assert.deepEqual(removeWindUp(early).clip.frames.map(litColumns), [8, 8, 7, 6, 5, 4])
  const late = clipOf([lit(1), lit(1), lit(1), lit(1), lit(1), lit(8)])
  assert.equal(windUpLength(late), 3)
})

test('a clip of one frame cannot be degraded', () => {
  const single = clipOf([frameWith(1, 1)])
  for (const degrade of [dropFrames, slideFeet, removeWindUp]) assert.throws(() => degrade(single), /two frames/)
})

test('a clip is resampled in time and a sheet is cut into non-empty cells', () => {
  const frames = Array.from({ length: 24 }, (_, i) => frameWith(i % 8, 0))
  const sampled = atRate({ name: 'c', frames, fps: 24 }, 12, 16)
  assert.equal(sampled.frames.length, 12)
  assert.equal(sampled.frames[1], frames[2])
  assert.equal(atRate({ name: 'c', frames, fps: 24 }, 12, 5).frames.length, 5)
  const strip = grid([frameWith(0, 0), frameWith(1, 0), frameWith(2, 0)], 2, 1)
  assert.deepEqual([strip.width, strip.height], [17, 21])
  assert.equal(sliceSheet(strip, 8, 10).length, 2)
})

function lzwDecode (codes: Uint8Array, minSize: number): { out: number[], clears: number } {
  const out: number[] = []
  const [clear, end] = [1 << minSize, (1 << minSize) + 1]
  let table: number[][] = []
  let [size, buffer, bits, at, previous, clears] = [minSize + 1, 0, 0, 0, undefined as number[] | undefined, 0]
  const reset = (): void => {
    table = Array.from({ length: end + 1 }, (_, i) => i < clear ? [i] : [])
    size = minSize + 1
    previous = undefined
  }
  for (;;) {
    while (bits < size && at < codes.length) {
      buffer |= codes[at++] << bits
      bits += 8
    }
    const code = buffer & ((1 << size) - 1)
    buffer >>>= size
    bits -= size
    if (code === end) return { out, clears }
    if (code === clear) {
      clears++
      reset()
      continue
    }
    const entry = table[code] ?? [...(previous as number[]), (previous as number[])[0]]
    for (const value of entry) out.push(value)
    if (previous !== undefined) table.push([...previous, entry[0]])
    previous = entry
    if (table.length === (1 << size) && size < 12) size++
  }
}

function indicesOf (gif: Buffer): { out: number[], clears: number } {
  let at = 13 + 768 + 19
  while (gif[at] !== 0x2c) at += gif[at] === 0x21 ? 2 + 1 + gif[at + 2] + 1 : 1
  at += 10
  const minSize = gif[at++]
  const bytes: number[] = []
  for (; gif[at] !== 0; at += gif[at] + 1) bytes.push(...gif.subarray(at + 1, at + 1 + gif[at]))
  return lzwDecode(Uint8Array.from(bytes), minSize)
}

test('a gif decodes back to the pixels it was given, across a code table reset', () => {
  const side = 128
  const noise = createImage(side, side)
  let state = 12345
  for (let i = 0; i < side * side; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    setPixel(noise, i % side, Math.floor(i / side), ((state >>> 8) % 250) * 0x010305)
  }
  const gif = encodeGif([noise], 8, 0)
  assert.equal(gif.subarray(0, 6).toString(), 'GIF89a')
  assert.equal(gif.at(-1), 0x3b)
  const { out, clears } = indicesOf(gif)
  assert.ok(clears >= 3, `${clears} clear codes: the table filled at least twice`)
  const palette = (i: number): number => (gif[13 + i * 3] << 16) | (gif[14 + i * 3] << 8) | gif[15 + i * 3]
  assert.deepEqual(out.map(palette), Array.from({ length: side * side }, (_, i) => {
    return getPixel(noise, i % side, Math.floor(i / side))
  }).map(rgb => rgb === TRANSPARENT ? 0 : rgb))
})
