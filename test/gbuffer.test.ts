import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY, rasterize } from '../src/raster/gbuffer.ts'
import { makeCamera } from '../src/raster/camera.ts'
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
