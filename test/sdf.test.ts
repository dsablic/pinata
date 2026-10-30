import { test } from 'node:test'
import { boxFrame, sdBox, sdRoundCone } from '../src/raster/sdf.ts'
import { assertClose } from './helpers.ts'

test('round cone with equal radii is a capsule', () => {
  assertClose(sdRoundCone([0, 0.5, 1], [0, 0, 0], [0, 1, 0], 0.5, 0.5), 0.5)
  assertClose(sdRoundCone([0, 2, 0], [0, 0, 0], [0, 1, 0], 0.5, 0.5), 0.5)
})

test('round cone measures to the larger end sphere below it', () => {
  assertClose(sdRoundCone([0, -2, 0], [0, 0, 0], [0, 3, 0], 1, 0.5), 1)
})

test('round cone with coincident joints is a sphere', () => {
  assertClose(sdRoundCone([2, 0, 0], [0, 0, 0], [0, 0, 0], 1, 1), 1)
})

test('box distance outside and inside', () => {
  const frame = boxFrame([0, 0, 0], [0, 2, 0], { widthAxis: [1, 0, 0], width: 2, thickness: 1, rounding: 0 })
  assertClose(sdBox([0, 1, 1.5], frame), 1)
  assertClose(sdBox([0, 1, 0], frame), -0.5)
})

test('rounded box keeps its outer extent', () => {
  const frame = boxFrame([0, 0, 0], [0, 2, 0], { widthAxis: [1, 0, 0], width: 2, thickness: 1, rounding: 0.2 })
  assertClose(sdBox([0, 1, 0.5], frame), 0)
})
