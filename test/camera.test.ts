import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeCamera, project, rayOrigin } from '../src/raster/camera.ts'
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
