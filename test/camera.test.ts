import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitCamera, makeCamera, project, rayOrigin } from '../src/raster/camera.ts'
import { boundingSphere } from '../src/raster/bounds.ts'
import type { Mannequin } from '../src/formats/mannequin.ts'
import { add, scale } from '../src/math/vec.ts'
import type { Vec3 } from '../src/math/vec.ts'
import { assertClose } from './helpers.ts'

const base = { targetHeightPx: 32, modelHeight: 2, margin: 4 }

function assertVec (actual: Vec3, expected: Vec3): void {
  actual.forEach((v, i) => { assertClose(v, expected[i], 1e-9) })
}

test('front camera maps +X to the right and +Y up', () => {
  const cam = makeCamera({ ...base, azimuthDeg: 0, elevationDeg: 0 })
  assert.equal(cam.width, 40)
  assert.equal(cam.baseline, 36)
  assertVec(cam.right, [1, 0, 0])
  assertVec(cam.up, [0, 1, 0])
  const p = project(cam, [0.5, 1, 0])
  assertClose(p.x, 28)
  assertClose(p.y, 20)
})

test('azimuth 90 looks from the character left side', () => {
  const cam = makeCamera({ ...base, azimuthDeg: 90, elevationDeg: 0 })
  assertVec(cam.forward, [-1, 0, 0])
  assertVec(cam.right, [0, 0, -1])
})

test('elevation tilts the view down', () => {
  const cam = makeCamera({ ...base, azimuthDeg: 0, elevationDeg: 30 })
  assertVec(cam.forward, [0, -0.5, -Math.sqrt(3) / 2])
})

test('a ray from a projected point hits that point at its depth', () => {
  const cam = makeCamera({ ...base, azimuthDeg: 45, elevationDeg: 30 })
  const point: Vec3 = [0.2, 0.7, -0.1]
  const p = project(cam, point)
  assertVec(add(rayOrigin(cam, p.x, p.y), scale(cam.forward, p.depth)), point)
})

const tPose: Mannequin = {
  name: 'tpose',
  height: 1,
  joints: { hip: [0, 0.5, 0], head: [0, 0.9, 0], handL: [-0.8, 0.8, 0], handR: [0.4, 0.8, 0], toe: [0, -0.3, 0] },
  parts: [
    { name: 'torso', shape: 'capsule', a: 'hip', b: 'head', radiusA: 0.1, radiusB: 0.1, material: 'm' },
    { name: 'armL', shape: 'capsule', a: 'head', b: 'handL', radiusA: 0.05, radiusB: 0.05, material: 'm' },
    { name: 'armR', shape: 'capsule', a: 'head', b: 'handR', radiusA: 0.05, radiusB: 0.05, material: 'm' },
    { name: 'sunk', shape: 'capsule', a: 'hip', b: 'toe', radiusA: 0.05, radiusB: 0.05, material: 'm' }
  ],
  decals: []
}

const fit = { targetHeightPx: 32, margin: 3 }

test('fitCamera keeps the scale fixed and the width the same from the back', () => {
  const front = fitCamera(tPose, { ...fit, azimuthDeg: 0, elevationDeg: 0 })
  const back = fitCamera(tPose, { ...fit, azimuthDeg: 180, elevationDeg: 0 })
  assert.equal(front.pixelsPerUnit, 32)
  assert.equal(front.width, back.width)
  assert.ok(front.width > 32 + 2 * fit.margin)
})

test('fitCamera frames the whole bounding extent including parts below the ground', () => {
  const cam = fitCamera(tPose, { ...fit, azimuthDeg: 0, elevationDeg: 30 })
  for (const part of tPose.parts) {
    const { center, radius } = boundingSphere(tPose, part)
    const p = project(cam, center)
    const r = radius * cam.pixelsPerUnit
    assert.ok(p.x - r >= fit.margin - 1 && p.x + r <= cam.width - fit.margin + 1, `${part.name} fits across`)
    assert.ok(p.y - r >= fit.margin - 1 && p.y + r <= cam.height - fit.margin + 1, `${part.name} fits down`)
  }
})

test('fitCamera starts rays outside every part', () => {
  const cam = fitCamera(tPose, { ...fit, azimuthDeg: 30, elevationDeg: 20 })
  for (const part of tPose.parts) {
    const { center, radius } = boundingSphere(tPose, part)
    assert.ok(project(cam, center).depth - radius > 0)
  }
})

test('fitCamera needs a margin of at least one pixel for the outline', () => {
  assert.throws(() => fitCamera(tPose, { ...fit, margin: 0, azimuthDeg: 0, elevationDeg: 0 }), RangeError)
})
