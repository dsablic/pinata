import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Mannequin } from '../src/formats/mannequin.ts'
import { VIEWS } from '../src/formats/skin.ts'
import type { Skin, ViewName } from '../src/formats/skin.ts'
import { pageCamera } from '../src/page/cast.ts'
import { fitFlags } from '../src/style/fit.ts'
import { capsule } from './rendering-fixtures.ts'

const mannequin: Mannequin = {
  name: 'arm',
  height: 1,
  joints: { shoulder: [0, 1, 0], hand: [0.6, 1, 0] },
  parts: [capsule('arm', 'shoulder', 'hand', 0.05)],
  decals: []
}

function skinWith (spans: Partial<Record<ViewName, number>>): Skin {
  const sprite = (span: number): { parts: Skin['parts'] } => ({
    parts: { arm: { rows: ['x'.repeat(span + 1)], pivotA: [0, 0], pivotB: [span, 0] } }
  })
  const views = Object.fromEntries(VIEWS.map(view => [view, sprite(spans[view] ?? 12)])) as Skin['views']
  return { name: 'arm', palette: { x: '#000000' }, parts: views!.side.parts, views }
}

const camera = pageCamera(27)

test('fit: a view sprite much shorter than the bone projects is flagged, a matching one is not', () => {
  const matching = skinWith({ front: 16, back: 16, side: 2 })
  assert.deepEqual(fitFlags({ mannequin, skin: matching, camera }), [])
  const [flag, ...others] = fitFlags({ mannequin, skin: skinWith({ front: 4, back: 16, side: 2 }), camera })
  assert.equal(others.length, 0)
  assert.equal(flag.part, 'arm')
  assert.equal(flag.view, 'front')
  assert.equal(flag.span, 4)
  assert.ok(Math.abs(flag.projectedLeast - 16.2) < 0.1)
})

test('fit: turning within the sector widens the projected range', () => {
  const skin = skinWith({ front: 16, back: 16, side: 2 })
  const [flag] = fitFlags({ mannequin, skin, camera, offsetsDeg: [-20, 0, 20] })
  assert.equal(flag.view, 'side')
  assert.ok(flag.projectedMost > 5)
})
