import { test } from 'node:test'
import assert from 'node:assert/strict'
import { worldBundle } from '../src/cli/world-bundle.ts'
import { readWorld } from '../src/diagnostics/page-scenarios.ts'
import { groundOf, heldOf } from '../src/export/gates.ts'
import { measured, seamless, seamOf } from '../src/export/loops.ts'
import { BEHAVIOURS, DIRECTIONS, record, SKINNED_HUMANOIDS, subjectOf } from '../src/export/record.ts'
import type { Frame, Recording, Track } from '../src/export/record.ts'
import { checksOf } from '../src/export/report.ts'
import { exportFiles } from '../src/export/files.ts'
import { MOST_SHEET_PX } from '../src/export/sheet.ts'
import { createImage, setPixel } from '../src/image.ts'
import { decodePng } from '../src/png/decode.ts'
import { readAseprite } from './aseprite-reader.ts'

const MISSED_GATES = ['feet']
const GROUND_MISSES: Record<string, string[]> = {
  knight: ['idle-right', 'idle-back-left', 'idle-front-left'],
  rogue: ['idle-front', 'idle-right'],
  dwarf: ['idle-front', 'idle-back-left'],
  wizard: ['idle-back']
}
const world = readWorld(worldBundle())
const recordings = new Map<string, Recording>()

function recorded (name: string): Recording {
  const kept = recordings.get(name) ?? record(subjectOf(world, name))
  recordings.set(name, kept)
  return kept
}

function frameWith (foot: { x: number, y: number }, travel: [number, number]): Frame {
  const image = createImage(4, 4)
  return { image, sector: 2, travel, feet: [{ planted: true, sole: foot, level: 0 }] }
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

test('the ground gate counts planted foot-frames off the line and ignores lifted feet', () => {
  const at = (rows: Array<number | 'lifted'>): Frame => ({
    image: createImage(4, 4),
    sector: 2,
    travel: [0, 0],
    feet: rows.map(row => row === 'lifted'
      ? { planted: false, sole: { x: 0, y: -9 }, level: 0 }
      : { planted: true, sole: { x: 0, y: row - 1 }, level: 0 })
  })
  const frames = [at([0, 1]), at([-1, 'lifted']), at([3, -2]), at([0, 0])]
  const ground = groundOf({ behaviour: 'idle', direction: 'right', loop: true, frames })
  assert.deepEqual(ground, { planted: 7, seen: 7, off: 2, worst: 3 })
  const nearer: Frame = { ...at([0]), feet: [{ planted: true, sole: { x: 0, y: 2 }, level: 2.6 }] }
  assert.equal(groundOf({ behaviour: 'idle', direction: 'right', loop: true, frames: [nearer] }).off, 0)
  const none = groundOf({ behaviour: 'idle', direction: 'right', loop: true, frames: [at(['lifted'])] })
  assert.deepEqual([none.planted, none.worst], [0, undefined])
})

test('a one-frame planted flicker and a hidden foot are counted, not skipped silently', () => {
  const planted = (on: boolean, visible = true): Frame => {
    const frame = frameWith({ x: 0, y: 0 }, [0, 0])
    frame.feet[0] = { planted: on, sole: visible ? { x: 0, y: 0 } : undefined, level: 0 }
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
  const held = [bar(1), bar(2), bar(2), bar(3), bar(1), bar(1)]
  assert.equal(seamless(seamOf(held, true)), true)
  assert.equal(seamless(seamOf(held)), false)
  assert.equal(seamless(seamOf([1, 2, 3, 4, 5, 5, 6, 7, 8, 7, 1].map(bar), true)), false)
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
    const missed = failed.filter(check => !MISSED_GATES.includes(check.gate)).map(check => check.line.split(':')[0])
    assert.deepEqual(missed, GROUND_MISSES[name] ?? [])
    const unmeasured = checksOf(recording).filter(check => !check.measured)
    assert.ok(unmeasured.every(check => check.gate === 'loop' && check.line.startsWith('idle-')), 'only idle loops')
  })
}

const ANIMATIONS = ['idle', 'walk', 'run', 'turn', 'jump', 'crouch', 'attack']
const durationAt = (index: number): number => Math.round((index + 1) * 1000 / 24) - Math.round(index * 1000 / 24)

function tracksOf (recording: Recording, behaviour: string): Track[] {
  return recording.tracks.filter(track => track.behaviour === behaviour)
}

test('exporting a character twice gives byte-identical files, one set per animation', () => {
  const [first, second] = [exportFiles(recorded('knight')), exportFiles(record(subjectOf(world, 'knight')))]
  assert.deepEqual(Object.keys(first), ANIMATIONS.flatMap(animation => {
    return ['png', 'json', 'aseprite'].map(extension => `knight-${animation}.${extension}`)
  }))
  for (const file of Object.keys(first)) assert.deepEqual(Buffer.from(first[file]), Buffer.from(second[file]))
})

test('every frame of every animation is rebuilt bit-exactly from its sheet and JSON alone', () => {
  const recording = recorded('knight')
  const files = exportFiles(recording)
  for (const animation of ANIMATIONS) {
    const sheet = decodePng(files[`knight-${animation}.png`] as Uint8Array)
    const json = JSON.parse(files[`knight-${animation}.json`] as string)
    assert.equal(json.meta.image, `knight-${animation}.png`)
    assert.equal(json.meta.size.w, sheet.width)
    assert.equal(json.meta.size.h, sheet.height)
    const tracks = tracksOf(recording, animation)
    const expected = tracks.flatMap(track => track.frames)
    assert.equal(json.frames.length, expected.length)
    json.frames.forEach((entry: { frame: { x: number, y: number, w: number, h: number } }, i: number) => {
      const { x, y, w, h } = entry.frame
      assert.equal(w, expected[i].image.width)
      assert.equal(h, expected[i].image.height)
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          const at = ((y + row) * sheet.width + x + col) * 4
          const from = (row * w + col) * 4
          assert.deepEqual(
            Array.from(sheet.data.subarray(at, at + 4)),
            Array.from(expected[i].image.data.subarray(from, from + 4)),
            `${animation} frame ${i} pixel ${col},${row}`
          )
        }
      }
    })
    assert.deepEqual(json.meta.frameTags.map((tag: { name: string }) => tag.name),
      tracks.map(track => `${animation}-${track.direction}`))
    const covered = json.meta.frameTags.flatMap((tag: { from: number, to: number }) => {
      return Array.from({ length: tag.to - tag.from + 1 }, (_, k) => tag.from + k)
    })
    assert.deepEqual(covered, expected.map((_, i) => i))
    assert.deepEqual(json.meta.slices[0].keys[0].pivot, { x: recording.cell.pivot[0], y: recording.cell.pivot[1] })
  }
})

test('every animation is rebuilt from its .aseprite alone: pixels, durations, tags and every visible field', () => {
  const recording = recorded('knight')
  const files = exportFiles(recording)
  const { cell } = recording
  for (const animation of ANIMATIONS) {
    const file = readAseprite(files[`knight-${animation}.aseprite`] as Uint8Array)
    const tracks = tracksOf(recording, animation)
    const expected = tracks.flatMap(track => track.frames)
    assert.deepEqual(file.header, {
      width: cell.width,
      height: cell.height,
      depth: 32,
      flags: 1,
      speed: 42,
      colours: 0,
      pixelRatio: [1, 1],
      grid: { x: 0, y: 0, width: 16, height: 16 }
    })
    assert.deepEqual(file.layers, [{ flags: 3, type: 0, level: 0, blend: 0, opacity: 255, name: 'pinata' }])
    assert.equal(file.frames.length, expected.length)
    file.frames.forEach((frame, i) => {
      assert.equal(frame.cels.length, 1, `${animation} frame ${i}`)
      const [cel] = frame.cels
      assert.deepEqual([cel.layer, cel.x, cel.y, cel.opacity, cel.z, cel.width, cel.height],
        [0, 0, 0, 255, 0, cell.width, cell.height])
      assert.deepEqual(Array.from(cel.rgba), Array.from(expected[i].image.data), `${animation} frame ${i} pixels`)
    })
    const lengths = tracks.map(track => track.frames.length)
    const starts = lengths.map((_, k) => lengths.slice(0, k).reduce((a, b) => a + b, 0))
    const durations = tracks.flatMap(track => track.frames.map((_, j) => durationAt(j)))
    assert.deepEqual(file.frames.map(frame => frame.duration), durations)
    assert.deepEqual(file.tags, tracks.map((track, k) => ({
      name: `${animation}-${track.direction}`,
      from: starts[k],
      to: starts[k] + lengths[k] - 1,
      direction: 0,
      repeat: 0
    })))
    assert.deepEqual(file.slices, [{
      name: 'anchor', frame: 0, bounds: [0, 0, cell.width, cell.height], pivot: cell.pivot
    }])
  }
})

for (const name of SKINNED_HUMANOIDS) {
  test(`${name}: the sheet is at most ${MOST_SHEET_PX} px each way and every frame rectangle lies inside it`, () => {
    const files = exportFiles(recorded(name))
    for (const animation of ANIMATIONS) {
      const json = JSON.parse(files[`${name}-${animation}.json`] as string)
      assert.ok(json.meta.size.w <= MOST_SHEET_PX && json.meta.size.h <= MOST_SHEET_PX)
      for (const { frame } of json.frames) {
        assert.ok(frame.x + frame.w <= json.meta.size.w && frame.y + frame.h <= json.meta.size.h)
      }
      const corner = (entry: { frame: { x: number, y: number } }): string => `${entry.frame.x},${entry.frame.y}`
      const places = new Set(json.frames.map(corner))
      assert.equal(places.size, json.frames.length)
    }
  })
}
