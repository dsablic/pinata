import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AFTER_LANDING, AFTER_TOUCHDOWN, AIRBORNE_BEFORE_LANDING, BEFORE_FALL, EARLIEST_SECONDS, fallWindow, landingWindow,
  JUMP_FRAMES, jumpWindowNumber, MOST_FRAMES, sampled, strideWindow, STRIDE_FRAMES, walkWindow, WALK_FRAMES
} from '../src/diagnostics/rendering-panel.ts'
import type { Step } from '../src/diagnostics/rendering-panel.ts'
import { FPS } from '../src/page/cast.ts'

const FROM = EARLIEST_SECONDS * FPS
const step = (extra: Partial<Step> = {}): Step => {
  return {
    falling: false, activity: 'wander', onSurface: true, yaw: 0, speed: 0, planted: false, side: true, jumping: false,
    ...extra
  }
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

const stride = (length: number, extra: Partial<Step> = {}): Step[] => {
  return Array.from({ length }, (_, i) => step({ speed: 1, planted: i < length / 2, ...extra }))
}

test('a stride runs from one planting of the first foot to the next, in 8 even frames', () => {
  const run = [...steps(FROM), ...stride(24), ...stride(24), step()]
  const frames = strideWindow(run) as number[]
  assert.equal(frames.length, STRIDE_FRAMES)
  assert.deepEqual(frames.map(f => f - frames[0]), [0, 3, 6, 9, 12, 15, 18, 21])
})

test('a stride starts only after a landing has recovered', () => {
  const run = [...steps(FROM), ...steps(3, { falling: true }), ...stride(24), ...stride(24), ...stride(24), step()]
  const frames = strideWindow(run) as number[]
  assert.equal(frames[0], FROM + 3 + 24)
})

test('a stride needs a side view, and steady walking', () => {
  assert.equal(strideWindow([...steps(FROM), ...stride(24, { side: false }), step()]), undefined)
  assert.equal(strideWindow([...steps(FROM), ...stride(24), ...stride(24, { speed: 0 }), step()]), undefined)
})

test('a landing is two airborne frames, the touchdown and what follows, from a walk-off only', () => {
  const walkOff = (air: number): Step[] => [...steps(FROM + 14), ...steps(air, { falling: true }), ...steps(20)]
  const first = FROM + 14 + 6 - AIRBORNE_BEFORE_LANDING
  const frames = landingWindow(walkOff(6)) as number[]
  assert.equal(frames.length, AIRBORNE_BEFORE_LANDING + 1 + AFTER_TOUCHDOWN)
  assert.deepEqual([frames[0], frames.at(-1)], [first, first + frames.length - 1])
  assert.equal(landingWindow(walkOff(1)), undefined)
  const dropIn = [...steps(FROM + 14), ...steps(6, { falling: true, activity: 'drop' }), ...steps(20)]
  assert.equal(landingWindow(dropIn), undefined)
})

test('a jump window spans the command to the end of the landing and holds flight frames', () => {
  const jump = (flight: number, whole: number): Step[] => Array.from({ length: whole }, (_, k) => {
    return step({ jumping: true, falling: k >= 10 && k < 10 + flight })
  })
  const both = [...steps(FROM), ...jump(10, 26), ...steps(10), ...jump(10, 26), ...steps(10)]
  const first = jumpWindowNumber(0)(both) as number[]
  assert.equal(first.length, JUMP_FRAMES)
  assert.deepEqual([first[0], first.at(-1)], [FROM, FROM + 25])
  assert.equal((jumpWindowNumber(1)(both) as number[])[0], FROM + 36)
  assert.equal(jumpWindowNumber(2)(both), undefined)
  assert.equal(jumpWindowNumber(0)([...steps(FROM), ...jump(1, 26), ...steps(10)]), undefined)
  assert.equal(jumpWindowNumber(0)([...steps(FROM), ...jump(10, 26)]), undefined)
})
