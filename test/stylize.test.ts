import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stylize } from '../src/style/stylize.ts'
import { EMPTY } from '../src/raster/gbuffer.ts'
import type { GBuffer } from '../src/raster/gbuffer.ts'
import { makeCamera } from '../src/raster/camera.ts'
import { getPixel, TRANSPARENT } from '../src/image.ts'
import type { Mannequin } from '../src/formats/mannequin.ts'
import type { Style } from '../src/formats/style.ts'
import type { Vec3 } from '../src/math/vec.ts'

const DARK = 0x000010
const LIGHT = 0x0000ff
const OUTLINE = 0x101010

const style: Style = {
  name: 'test',
  light: [0, 0, 1],
  bands: [0.5],
  outline: '#101010',
  innerLineDepth: 0.1,
  decalMinFacing: 0.3,
  materials: { m: ['#000010', '#0000ff'] },
  decalColors: { x: '#ff0000' }
}

const mannequin: Mannequin = {
  name: 'm',
  height: 1,
  joints: { o: [0, 0, 0] },
  parts: [{ name: 'p', shape: 'capsule', a: 'o', b: 'o', radiusA: 1, radiusB: 1, material: 'm' }],
  decals: []
}

const camera = makeCamera({ azimuthDeg: 0, elevationDeg: 0, targetHeightPx: 1, modelHeight: 1, margin: 2 })

function block (normal: Vec3): GBuffer {
  const width = 5
  const height = 5
  const g: GBuffer = {
    width,
    height,
    part: new Int16Array(25).fill(EMPTY),
    depth: new Float32Array(25).fill(1),
    normal: new Float32Array(75),
    coverage: new Float32Array(25)
  }
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 3; x++) {
      const i = y * width + x
      g.part[i] = 0
      g.normal.set(normal, i * 3)
    }
  }
  return g
}

test('shades from the light and draws an outline around the silhouette', () => {
  const { image } = stylize(block([0, 0, 1]), mannequin, camera, style)
  assert.equal(getPixel(image, 2, 2), LIGHT)
  assert.equal(getPixel(image, 2, 0), OUTLINE)
  assert.equal(getPixel(image, 0, 0), TRANSPARENT)
})

test('surfaces facing away from the light take the darkest shade', () => {
  const { image } = stylize(block([0, 0, -1]), mannequin, camera, style)
  assert.equal(getPixel(image, 2, 2), DARK)
})

test('replaces an isolated pixel with its surroundings', () => {
  const g = block([0, 0, 1])
  g.normal.set([0, 0, -1], (2 * 5 + 2) * 3)
  const { image } = stylize(g, mannequin, camera, style)
  assert.equal(getPixel(image, 2, 2), LIGHT)
})

test('darkens the farther part where two parts meet at a depth break', () => {
  const g = block([0, 0, 1])
  const two: Mannequin = { ...mannequin, parts: [...mannequin.parts, { ...mannequin.parts[0], name: 'q' }] }
  for (let y = 1; y <= 3; y++) {
    g.part[y * 5 + 3] = 1
    g.depth[y * 5 + 3] = 2
  }
  const { image } = stylize(g, two, camera, style)
  assert.equal(getPixel(image, 3, 2), DARK)
  assert.equal(getPixel(image, 2, 2), LIGHT)
})
