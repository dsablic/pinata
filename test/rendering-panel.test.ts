import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AFTER_LANDING, BEFORE_FALL, EARLIEST_SECONDS, fallWindow, MOST_FRAMES, sampled, walkWindow, WALK_FRAMES
} from '../src/diagnostics/rendering-panel.ts'
import type { Step } from '../src/diagnostics/rendering-panel.ts'
import { FPS } from '../src/page/cast.ts'

const FROM = EARLIEST_SECONDS * FPS
const step = (extra: Partial<Step> = {}): Step => {
  return { falling: false, activity: 'wander', onSurface: true, yaw: 0, speed: 0, ...extra }
}
const steps = (n: number, extra: Partial<Step> = {}): Step[] => Array.from({ length: n }, () => step(extra))

test('sampling keeps both ends and at most the most frames, evenly', () => {
  assert.deepEqual(sampled(3, 5), [3, 4, 5])
  const long = sampled(10, 109)
  assert.equal(long.length, MOST_FRAMES)
  assert.deepEqual([long[0], long.at(-1)], [10, 109])
})

test('a walk needs its frames steady on a surface after the first seconds', () => {
  const short = WALK_FRAMES - 1
  const run = [...steps(FROM + 5), ...steps(short, { speed: 1 }), step(), ...steps(WALK_FRAMES, { speed: 1 })]
  assert.equal(walkWindow(run)?.[0], FROM + 6 + short)
  assert.equal(walkWindow([...steps(FROM), ...steps(WALK_FRAMES, { speed: 1, onSurface: false })]), undefined)
})

test('a fall counts only when the character walked off a surface, not when it was dropped in', () => {
  const walkOff = [...steps(FROM + 14), ...steps(6, { falling: true }), ...steps(20)]
  const first = FROM + 14
  assert.deepEqual(fallWindow(walkOff), sampled(first - BEFORE_FALL, first + 6 + AFTER_LANDING))
  const dropIn = [...steps(FROM + 14), ...steps(6, { falling: true, activity: 'drop' }), ...steps(20)]
  assert.equal(fallWindow(dropIn), undefined)
  assert.equal(fallWindow([...steps(FROM + 14), ...steps(6, { falling: true })]), undefined)
})
