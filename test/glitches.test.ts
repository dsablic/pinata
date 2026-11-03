import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fragmentPixels, missingJoints, offUsual, overSprite, pops, usualFits } from '../src/diagnostics/glitches.ts'
import type { Layered } from '../src/diagnostics/glitches.ts'
import { readWorld, run, scenario } from '../src/diagnostics/page-scenarios.ts'
import { readLayout } from '../src/page/fixture.ts'
import type { Sprite } from '../src/page/cast.ts'
import type { DrawnPart } from '../src/style/skins.ts'
import { worldBundle } from '../src/cli/world-bundle.ts'
import { ROOT } from '../src/cli/paths.ts'

const part = (name: string, extra: Partial<DrawnPart> = {}): DrawnPart => {
  return { name, drawn: 10, shown: 10, painted: 20, ...extra }
}

function layered (footprints: string[], over: string[]): Layered {
  const cells = (rows: string[]): string[] => rows.join('').split('')
  const owner = Int16Array.from(cells(over), c => c === '.' ? -1 : Number(c))
  const footprint = cells(footprints).flatMap((c, i) => c === '0' ? [i] : [])
  const front = cells(over).flatMap((c, i) => c === '1' ? [i] : [])
  return { width: footprints[0].length, height: footprints.length, owner, parts: [
    part('back', { footprint }), part('front', { footprint: front })
  ] }
}

test('a part painted in two pieces counts the visible pixels of its smaller piece, covered or not', () => {
  assert.deepEqual(fragmentPixels(layered(['000000', '00...0'], ['001100', '00...0'])), new Map())
  assert.deepEqual(fragmentPixels(layered(['00..00', '00...0'], ['001100', '00...0'])), new Map([['back', 3]]))
  assert.deepEqual(fragmentPixels(layered(['00..00', '......'], ['00..00', '111111'])), new Map([['back', 2]]))
  assert.deepEqual(fragmentPixels(layered(['0.', '.0'], ['0.', '.0'])), new Map())
})

test('a part that loses more than half its pixels and gets them back within three frames pops once', () => {
  const series = (counts: number[]): DrawnPart[][] => counts.map(painted => [part('arm', { painted })])
  assert.deepEqual(pops(series([20, 5, 20])), [{ part: 'arm', from: 1, back: 2 }])
  assert.deepEqual(pops(series([20, 0, 0, 0, 20])), [{ part: 'arm', from: 1, back: 4 }])
  assert.deepEqual(pops(series([20, 9, 4, 20])), [{ part: 'arm', from: 1, back: 3 }])
  assert.deepEqual(pops(series([20, 0, 0, 0, 0, 20])), [])
  assert.deepEqual(pops(series([20, 12, 20])), [])
  assert.deepEqual(pops(series([6, 0, 6])), [])
  assert.deepEqual(pops([[part('arm')], [], [part('arm')]]), [{ part: 'arm', from: 1, back: 2 }])
})

test('a part stretches past its sprite\'s drawn length, the rounded floor aside', () => {
  const names = (parts: DrawnPart[]): string[] => overSprite(parts).map(p => p.name)
  assert.deepEqual(names([part('shin', { shown: 12.5 })]), [])
  assert.deepEqual(names([part('shin', { shown: 12.6 })]), ['shin'])
  assert.deepEqual(names([part('shin', { shown: 6 })]), [])
  assert.deepEqual(names([part('shin', { shown: 5.9 })]), ['shin'])
  assert.deepEqual(names([part('arm', { drawn: 7, shown: 4 }), part('arm', { drawn: 7, shown: 3.9 })]), ['arm'])
  assert.deepEqual(names([part('head', { shown: undefined })]), [])
})

test('a part far from its usual fit in the same view is told apart from one in another view', () => {
  const viewed = (shown: number, sector: number) => ({ parts: [part('shin', { shown })], sector })
  const usual = usualFits([viewed(7, 2), viewed(7, 2), viewed(7, 2), viewed(13, 0), viewed(13, 0)])
  assert.deepEqual(offUsual(viewed(7, 2), usual), [])
  assert.deepEqual(offUsual(viewed(13, 0), usual), [])
  assert.deepEqual(offUsual(viewed(11, 2), usual).map(p => p.name), ['shin'])
  assert.deepEqual(offUsual(viewed(7, 0), usual).map(p => p.name), ['shin'])
})

function sprites (footprints: boolean): Sprite[] {
  const s = scenario(readWorld(worldBundle()), readLayout(ROOT, 'demo-1200'), 1, 0, footprints)
  const found: Sprite[] = []
  run(s, 3, () => { found.push(...s.cast.drawables().map(d => d.sprite())) })
  return found
}

test('the page renderer reports every part\'s footprint and owned pixels without changing what it draws', () => {
  const measured = sprites(true)
  assert.deepEqual(measured.map(x => x.image), sprites(false).map(x => x.image))
  let covered = 0
  for (const { owner, parts = [] } of measured) {
    assert.ok(owner !== undefined)
    parts.forEach((p, i) => {
      const footprint = new Set(p.footprint)
      assert.equal(p.painted, footprint.size, p.name)
      owner.forEach((o, at) => { if (o === i) assert.ok(footprint.has(at), p.name) })
      covered += [...footprint].filter(at => owner[at] !== i).length
    })
    assert.ok(owner.every(o => o < parts.length))
  }
  assert.ok(covered > 0)
})

test('a part counts as off its joint from two pixels', () => {
  const names = (parts: DrawnPart[]): string[] => missingJoints(parts).map(p => p.name)
  assert.deepEqual(names([part('thigh', { missed: 1.9 }), part('shin', { missed: 2 }), part('sword')]), ['shin'])
})
