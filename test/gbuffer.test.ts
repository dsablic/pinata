import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY, rasterize } from '../src/raster/gbuffer.ts'
import { fitCamera, makeCamera } from '../src/raster/camera.ts'
import type { Mannequin } from '../src/formats/mannequin.ts'
import { assertClose } from './helpers.ts'

const sphere: Mannequin = {
  name: 'sphere',
  height: 2,
  joints: { o: [0, 1, 0] },
  parts: [{ name: 'ball', shape: 'capsule', a: 'o', b: 'o', radiusA: 0.5, radiusB: 0.5, material: 'm' }],
  decals: []
}

const camera = makeCamera({ azimuthDeg: 0, elevationDeg: 0, targetHeightPx: 16, modelHeight: 2, margin: 2 })

test('a sphere fills a disc around its projected centre', () => {
  const g = rasterize(sphere, camera)
  assert.equal(g.width, 20)
  assert.equal(g.part[9 * g.width + 9], 0)
  assert.equal(g.part[0], EMPTY)
  const filled = g.part.filter(p => p !== EMPTY).length
  assert.ok(filled >= 44 && filled <= 56, `expected about 50 filled pixels, got ${filled}`)
})

test('normals face the viewer at the centre and depth matches the front surface', () => {
  const g = rasterize(sphere, camera)
  const i = 9 * g.width + 9
  assert.ok(g.normal[i * 3 + 2] > 0.9)
  assertClose(g.depth[i], 7.5, 0.02)
})

test('the nearer part wins where parts overlap', () => {
  const two: Mannequin = {
    ...sphere,
    joints: { back: [0, 1, -0.5], front: [0, 1, 0.5] },
    parts: [
      { name: 'back', shape: 'capsule', a: 'back', b: 'back', radiusA: 0.5, radiusB: 0.5, material: 'm' },
      { name: 'front', shape: 'capsule', a: 'front', b: 'front', radiusA: 0.3, radiusB: 0.3, material: 'm' }
    ]
  }
  const g = rasterize(two, camera)
  assert.equal(g.part[9 * g.width + 9], 1)
})

test('a thin box seen at a grazing angle has no holes and a symmetric silhouette', () => {
  const thin: Mannequin = {
    name: 'thin',
    height: 1,
    joints: { a: [-0.4, 0.5, -0.032], b: [0.4, 0.5, 0.032] },
    parts: [{
      name: 'blade',
      shape: 'box',
      a: 'a',
      b: 'b',
      width: 0.6,
      thickness: 0.06,
      rounding: 0.01,
      widthAxis: [0, 1, 0],
      material: 'm'
    }],
    decals: []
  }
  const cam = makeCamera({ azimuthDeg: 90, elevationDeg: 0, targetHeightPx: 200, modelHeight: 1, margin: 2 })
  const g = rasterize(thin, cam, 2)
  for (let y = 0; y < g.height; y++) {
    const row = Array.from(g.part.subarray(y * g.width, (y + 1) * g.width), p => p !== EMPTY)
    const first = row.indexOf(true)
    if (first === -1) continue
    assert.ok(row.slice(first, row.lastIndexOf(true) + 1).every(Boolean), `row ${y} has a hole`)
    assert.deepEqual(row, row.toReversed(), `row ${y} is not symmetric about the centre`)
  }
})

test('a fitted frame leaves the margin empty for a wide pose and a part below the ground', () => {
  const wide: Mannequin = {
    name: 'wide',
    height: 1,
    joints: { l: [-1, 0.8, 0], r: [1, 0.8, 0], low: [0, -0.3, 0], top: [0, 0.9, 0] },
    parts: [
      { name: 'arms', shape: 'capsule', a: 'l', b: 'r', radiusA: 0.05, radiusB: 0.05, material: 'm' },
      { name: 'spine', shape: 'capsule', a: 'low', b: 'top', radiusA: 0.05, radiusB: 0.05, material: 'm' }
    ],
    decals: []
  }
  const margin = 2
  for (const elevationDeg of [0, 30]) {
    const cam = fitCamera(wide, { azimuthDeg: 0, elevationDeg, targetHeightPx: 24, margin })
    const g = rasterize(wide, cam, 2)
    let filled = 0
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        if (g.part[y * g.width + x] === EMPTY) continue
        filled++
        const inside = x >= margin && x < g.width - margin && y >= margin && y < g.height - margin
        assert.ok(inside, `pixel ${x},${y} is in the margin at elevation ${elevationDeg}`)
      }
    }
    assert.ok(filled > 0)
  }
})
