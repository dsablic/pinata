import { test } from 'node:test'
import assert from 'node:assert/strict'
import { worldBundle } from '../src/cli/world-bundle.ts'
import { ROOT } from '../src/cli/paths.ts'
import { readWorld, run, scenario } from '../src/diagnostics/page-scenarios.ts'
import { MOST_SOLE_MOVE_PX, readWalk, walkStats, watch, withWalk } from '../src/diagnostics/walk-frames.ts'
import { readLayout } from '../src/page/fixture.ts'

const SECONDS = 40
const LAYOUT = 'demo-1200'
const world = readWorld(worldBundle())
const framed = withWalk(world, 'knight', 'side', readWalk(ROOT, 'knight-side'))

test('a walking knight with drawn frames shows them, soles stay planted, the body stays near the walker', () => {
  const stats = walkStats(framed, LAYOUT, ROOT, SECONDS, 'knight')
  assert.ok(stats.shown > 0.3 * stats.walking, `frames on ${stats.shown} of ${stats.walking} walking frames`)
  assert.ok(stats.compared > 100, `${stats.compared} frame pairs compared`)
  assert.ok(stats.worstX <= MOST_SOLE_MOVE_PX && stats.worstY <= MOST_SOLE_MOVE_PX, JSON.stringify(stats))
  let furthest = 0
  watch(framed, LAYOUT, ROOT, SECONDS, 'knight', ({ root, placed }) => {
    if (placed !== undefined) furthest = Math.max(furthest, Math.abs(placed.sole[0] - root))
  })
  assert.ok(furthest < 25, `a planted sole was ${furthest.toFixed(1)} sprite px from the walker`)
})

test('frames show facing either way, and never while falling, jumping or off a surface', () => {
  const facing = new Set<number>()
  const shownWhen: string[] = []
  watch(framed, LAYOUT, ROOT, SECONDS, 'knight', ({ frame, placed }) => {
    if (placed === undefined) return
    if (placed.sector !== undefined) facing.add(Math.sign(placed.sector))
    if (frame.falling || frame.jumpTo !== undefined || frame.support === undefined) shownWhen.push(frame.activity)
  })
  assert.deepEqual([...facing].sort(), [-1, 1])
  assert.deepEqual(shownWhen, [])
})

test('a character without drawn frames draws exactly as before, whatever another character carries', () => {
  const plain = scenario(world, readLayout(ROOT, LAYOUT))
  const mixed = scenario(framed, readLayout(ROOT, LAYOUT))
  const rogue = (s: typeof plain): Uint8ClampedArray | undefined => {
    return s.cast.drawables().find(d => d.name === 'rogue')?.sprite().image.data
  }
  run(plain, 10, step => {
    mixed.cast.advance(1 / 24, mixed.viewport, true)
    assert.deepEqual(rogue(mixed), rogue(plain), `rogue differs at step ${step}`)
  })
})
