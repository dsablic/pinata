import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkSkin, validateSkin, VIEWS } from '../src/formats/skin.ts'
import { makeCamera } from '../src/raster/camera.ts'
import { chooseView, counterpart, facingAngle, fitted, mirrored } from '../src/style/views.ts'

test('facing: yaw 0 faces a camera at azimuth 0, a quarter turn faces screen-right', () => {
  const camera = makeCamera({ azimuthDeg: 0, elevationDeg: 14, targetHeightPx: 48, modelHeight: 1.8, margin: 4 })
  assert.ok(Math.abs(facingAngle(camera, 0)) < 1e-12)
  assert.ok(Math.abs(facingAngle(camera, Math.PI / 2) - Math.PI / 2) < 1e-12)
  assert.ok(Math.abs(Math.abs(facingAngle(camera, Math.PI)) - Math.PI) < 1e-12)
})

test('views: eight sectors, left-facing ones mirrored, with hysteresis at the edges', () => {
  const deg = Math.PI / 180
  assert.deepEqual(chooseView(0), { view: 'front', mirror: false, sector: 0 })
  assert.deepEqual(chooseView(90 * deg), { view: 'side', mirror: false, sector: 2 })
  assert.deepEqual(chooseView(-135 * deg), { view: 'backSide', mirror: true, sector: -3 })
  assert.deepEqual(chooseView(-180 * deg), { view: 'back', mirror: false, sector: 4 })
  assert.equal(chooseView(25 * deg, 0).sector, 0)
  assert.equal(chooseView(30 * deg, 0).sector, 0)
  assert.equal(chooseView(33 * deg, 0).sector, 1)
})

test('mirroring swaps sides and flips sprites the right way; fitting keeps the end caps', () => {
  assert.equal(counterpart('thighL'), 'thighR')
  assert.equal(counterpart('capeTopRight'), 'capeTopLeft')
  assert.equal(counterpart('helmet'), 'helmet')
  const limb = { rows: ['ab', 'cd'], pivotA: [0, 0] as [number, number], pivotB: [1, 0] as [number, number] }
  assert.deepEqual(mirrored(limb, true), { rows: ['cd', 'ab'], pivotA: [0, 1], pivotB: [1, 1] })
  assert.deepEqual(mirrored({ rows: ['ab.'], pivotA: [0, 0] }, false), { rows: ['.ba'], pivotA: [2, 0] })
  const long = { rows: ['x1234y'], pivotA: [1, 0] as [number, number], pivotB: [5, 0] as [number, number] }
  assert.deepEqual(fitted(long, 2), { rows: ['x13y'], pivotA: [1, 0], pivotB: [3, 0] })
  assert.deepEqual(fitted(long, 4.3), long)
})

test('an eight-direction skin validates every view and refuses single-view fields', () => {
  const v1 = JSON.parse(readFileSync('pocs/skins-spike/artist-skin.json', 'utf8'))
  const views = Object.fromEntries(VIEWS.map(view => [view, { parts: v1.parts }]))
  const v2 = { name: 'k', palette: v1.palette, views }
  const read = validateSkin(v2)
  assert.deepEqual(read.errors, [])
  const mannequin = JSON.parse(readFileSync('pocs/p4-locomotion/knight.json', 'utf8'))
  assert.deepEqual(checkSkin(read.value!, mannequin), [])
  assert.deepEqual(validateSkin({ ...v2, view: 'side-right' }).errors.map(e => e.path), ['views'])
  const missing = { ...v2, views: { ...views, back: undefined } }
  assert.deepEqual(validateSkin(missing).errors.map(e => e.path), ['views.back'])
})
