import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  apply, axisAngle, between, IDENTITY, interpolate, multiply, toAxisAngle, transpose
} from '../src/math/matrix.ts'
import type { Matrix } from '../src/math/matrix.ts'
import { length, normalize, sub } from '../src/math/vec.ts'
import type { Vec3 } from '../src/math/vec.ts'
import { assertClose } from './helpers.ts'

function close (a: Matrix, b: Matrix, tolerance = 1e-9): void {
  a.forEach((row, i) => row.forEach((v, j) => assertClose(v, b[i][j], tolerance)))
}

test('toAxisAngle recovers axis and angle at 0, general angles and 180 degrees', () => {
  assert.equal(toAxisAngle(IDENTITY).angle, 0)
  const axis = normalize([1, 2, -0.5])
  for (const angle of [0.3, 1.7, 3, Math.PI]) {
    const recovered = toAxisAngle(axisAngle(axis, angle))
    assertClose(recovered.angle, angle, 1e-9)
    close(axisAngle(recovered.axis, recovered.angle), axisAngle(axis, angle))
  }
})

test('interpolate runs from a to b about one axis, at constant speed', () => {
  const a = axisAngle(normalize([0, 1, 0]), 0.4)
  const b = multiply(axisAngle(normalize([1, 0, 1]), 1.2), a)
  close(interpolate(a, b, 0), a)
  close(interpolate(a, b, 1), b, 1e-6)
  const half = interpolate(a, b, 0.5)
  assertClose(toAxisAngle(multiply(half, transpose(a))).angle, 0.6, 1e-9)
  assertClose(toAxisAngle(multiply(b, transpose(half))).angle, 0.6, 1e-9)
  close(interpolate(IDENTITY, axisAngle([0, 0, 1], Math.PI), 1), axisAngle([0, 0, 1], Math.PI), 1e-6)
})

test('between turns one direction onto another, including exactly opposite ones', () => {
  const pairs: Array<[Vec3, Vec3]> = [
    [[0, 0, 1], [0, 1, 0]], [[1, 0, 0], [1, 0, 0]], [[0, 0, 1], [0, 0, -1]], [[1, 0, 0], [-1, 0, 0]]
  ]
  for (const [from, to] of pairs) {
    const turned = apply(between(from, to), from)
    assert.ok(length(sub(turned, to)) < 1e-12, `${from} -> ${to}: ${turned}`)
  }
})
