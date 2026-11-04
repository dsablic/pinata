import { test } from 'node:test'
import assert from 'node:assert/strict'
import { worldBundle } from '../src/cli/world-bundle.ts'
import { readWorld } from '../src/diagnostics/page-scenarios.ts'
import { heldOf } from '../src/export/gates.ts'
import { measured, seamless, seamOf } from '../src/export/loops.ts'
import { BEHAVIOURS, DIRECTIONS, record, SKINNED_HUMANOIDS, subjectOf } from '../src/export/record.ts'
import type { Frame, Recording, Track } from '../src/export/record.ts'
import { checksOf } from '../src/export/report.ts'
import { exportFiles, MOST_SHEET_PX } from '../src/export/sheet.ts'
import { createImage, setPixel } from '../src/image.ts'
import { decodePng } from '../src/png/decode.ts'

const MISSED_GATES = ['feet', 'mirroredGround']
const world = readWorld(worldBundle())
const recordings = new Map<string, Recording>()

function recorded (name: string): Recording {
  const kept = recordings.get(name) ?? record(subjectOf(world, name))
  recordings.set(name, kept)
  return kept
}

function frameWith (foot: { x: number, y: number }, travel: [number, number]): Frame {
  const image = createImage(4, 4)
  return { image, sector: 2, travel, feet: [{ planted: true, sole: foot }] }
}

test('a planted sole that slides against the root motion is caught, one that is held is not', () => {
  const at = (x: number, travel: number): Frame => frameWith({ x, y: 0 }, [travel, 0])
  const held = [at(5, 0), at(3.5, 1.5), at(2, 1.5)]
  const sliding = [at(5, 0), at(4, 0), at(3, 0)]
  const track = (frames: Frame[]): Track => ({ behaviour: 'walk', direction: 'right', loop: false, frames })
  assert.ok(heldOf(track(held)).worst < 1e-9)
  assert.equal(heldOf(track(sliding)).worst, 1)
  assert.equal(heldOf(track(sliding)).pairs, 2)
})

test('a one-frame planted flicker and a hidden foot are counted, not skipped silently', () => {
  const planted = (on: boolean, visible = true): Frame => {
    const frame = frameWith({ x: 0, y: 0 }, [0, 0])
    frame.feet[0] = { planted: on, sole: visible ? { x: 0, y: 0 } : undefined }
    return frame
  }
  const frames = [planted(true), planted(false), planted(true), planted(true, false), planted(true)]
  const held = heldOf({ behaviour: 'walk', direction: 'right', loop: false, frames })
  assert.equal(held.flickers, 1)
  assert.equal(held.hidden, 2)
  assert.equal(held.pairs, 0)
})

test('a loop whose last frame differs from the first by more than a usual step is not seamless', () => {
  const bar = (length: number): ReturnType<typeof createImage> => {
    const image = createImage(8, 1)
    for (let x = 0; x < length; x++) setPixel(image, x, 0, 1)
    return image
  }
  assert.equal(seamless(seamOf([bar(1), bar(2), bar(3), bar(4), bar(5)])), false)
  assert.equal(seamless(seamOf([bar(1), bar(2), bar(3), bar(2)])), true)
})

test('a repeated frame at the seam fails, and identical frames are not measured', () => {
  const bar = (length: number): ReturnType<typeof createImage> => {
    const image = createImage(8, 1)
    for (let x = 0; x < length; x++) setPixel(image, x, 0, 1)
    return image
  }
  assert.equal(seamless(seamOf([bar(1), bar(2), bar(3), bar(1)])), false)
  assert.equal(measured(seamOf([bar(2), bar(2), bar(2)])), false)
  assert.equal(seamless(seamOf([bar(2), bar(2), bar(2)])), false)
})

for (const name of SKINNED_HUMANOIDS) {
  const title = `${name}: every animation is recorded in eight directions and passes every export gate but the ` +
    'recorded misses (feet, the mirrored view\'s ground)'
  test(title, () => {
    const recording = recorded(name)
    assert.equal(recording.tracks.length, BEHAVIOURS.length * DIRECTIONS.length)
    const failed = checksOf(recording).filter(check => check.measured && !check.pass)
    assert.deepEqual(failed.filter(check => !MISSED_GATES.includes(check.gate)).map(check => check.line), [])
    assert.equal(checksOf(recording).filter(check => !check.measured).length, DIRECTIONS.length)
  })
}

test('exporting a character twice gives byte-identical files', () => {
  const [first, second] = [exportFiles(recorded('knight')), exportFiles(record(subjectOf(world, 'knight')))]
  assert.deepEqual(Object.keys(first), ['knight.png', 'knight.json'])
  for (const file of Object.keys(first)) assert.deepEqual(Buffer.from(first[file]), Buffer.from(second[file]))
})

test('every frame is rebuilt bit-exactly from the sheet and the JSON alone', () => {
  const recording = recorded('knight')
  const files = exportFiles(recording)
  const sheet = decodePng(files['knight.png'] as Uint8Array)
  const json = JSON.parse(files['knight.json'] as string)
  assert.equal(json.meta.size.w, sheet.width)
  assert.equal(json.meta.size.h, sheet.height)
  const expected = recording.tracks.flatMap(track => track.frames.map(frame => ({ track, frame })))
  assert.equal(json.frames.length, expected.length)
  json.frames.forEach((entry: { frame: { x: number, y: number, w: number, h: number } }, i: number) => {
    const { x, y, w, h } = entry.frame
    const { frame } = expected[i]
    assert.equal(w, frame.image.width)
    assert.equal(h, frame.image.height)
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const at = ((y + row) * sheet.width + x + col) * 4
        const from = (row * w + col) * 4
        assert.deepEqual(
          Array.from(sheet.data.subarray(at, at + 4)),
          Array.from(frame.image.data.subarray(from, from + 4)),
          `frame ${i} pixel ${col},${row}`
        )
      }
    }
  })
  const tagged = json.meta.frameTags.map((tag: { name: string, from: number, to: number }) => tag.name)
  assert.deepEqual(tagged, recording.tracks.map(track => `${track.behaviour}-${track.direction}`))
  const covered = json.meta.frameTags.flatMap((tag: { from: number, to: number }) => {
    return Array.from({ length: tag.to - tag.from + 1 }, (_, k) => tag.from + k)
  })
  assert.deepEqual(covered, expected.map((_, i) => i))
  assert.deepEqual(json.meta.slices[0].keys[0].pivot, { x: recording.cell.pivot[0], y: recording.cell.pivot[1] })
})

for (const name of SKINNED_HUMANOIDS) {
  test(`${name}: the sheet is at most ${MOST_SHEET_PX} px each way and every frame rectangle lies inside it`, () => {
    const json = JSON.parse(exportFiles(recorded(name))[`${name}.json`] as string)
    assert.ok(json.meta.size.w <= MOST_SHEET_PX && json.meta.size.h <= MOST_SHEET_PX)
    for (const { frame } of json.frames) {
      assert.ok(frame.x + frame.w <= json.meta.size.w && frame.y + frame.h <= json.meta.size.h)
    }
    const corner = (entry: { frame: { x: number, y: number } }): string => `${entry.frame.x},${entry.frame.y}`
    const places = new Set(json.frames.map(corner))
    assert.equal(places.size, json.frames.length)
  })
}
