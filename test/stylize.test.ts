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

test('shades an allowThin part with the middle ramp colour and keeps it free of neighbour colours', () => {
  const g = block([0, 0, 1])
  const thinStyle: Style = { ...style, materials: { ...style.materials, t: ['#000020', '#00aa00', '#00ff00'] } }
  const withThin: Mannequin = {
    ...mannequin,
    parts: [...mannequin.parts, { ...mannequin.parts[0], name: 'q', material: 't', allowThin: true }]
  }
  for (let k = 1; k <= 3; k++) {
    const i = k * 5 + k
    g.part[i] = 1
    g.depth[i] = 0.5
    g.normal.set([0, 0, k === 2 ? 1 : -1], i * 3)
  }
  const { image } = stylize(g, withThin, camera, thinStyle)
  for (let k = 1; k <= 3; k++) assert.equal(getPixel(image, k, k), 0x00aa00)
})

test('resolves a one pixel diagonal band that alternates two shades', () => {
  const g = block([0, 0, 1])
  g.part.fill(EMPTY)
  for (let k = 1; k <= 3; k++) {
    const i = k * 5 + k
    g.part[i] = 0
    g.normal.set([0, 0, k % 2 === 0 ? 1 : -1], i * 3)
  }
  const { image } = stylize(g, mannequin, camera, style)
  const colours = new Set([1, 2, 3].map(k => getPixel(image, k, k)))
  assert.equal(colours.size, 1)
})

test('gives a single pixel fragment the colour of the part around it', () => {
  const g = block([0, 0, 1])
  const two: Mannequin = { ...mannequin, parts: [...mannequin.parts, { ...mannequin.parts[0], name: 'q' }] }
  g.part[2 * 5 + 2] = 1
  g.normal.set([0, 0, -1], (2 * 5 + 2) * 3)
  const { image } = stylize(g, two, camera, style)
  assert.equal(getPixel(image, 2, 2), LIGHT)
})

test('keeps an isolated allowThin pixel as it is', () => {
  const g = block([0, 0, 1])
  const thin: Mannequin = {
    ...mannequin,
    parts: [...mannequin.parts, { ...mannequin.parts[0], name: 'q', allowThin: true }]
  }
  g.part[2 * 5 + 2] = 1
  const { image } = stylize(g, thin, camera, style)
  assert.equal(getPixel(image, 2, 2), 0x0000ff)
})

const eye = { name: 'eye', anchor: 'o', normal: [0, 0, 1] as Vec3, pattern: ['x'] }
const RED = 0xff0000

function decalScene (decalNormal: Vec3, surfaceDepth: number) {
  const g = block([0, 0, 1])
  g.depth.fill(surfaceDepth)
  const m: Mannequin = { ...mannequin, decals: [{ ...eye, normal: decalNormal }] }
  return stylize(g, m, camera, style)
}

test('draws a camera-facing decal at the projected anchor and marks it in the mask', () => {
  const { image, decalMask } = decalScene([0, 0, 1], 4)
  assert.equal(getPixel(image, 2, 3), RED)
  assert.equal(decalMask[3 * 5 + 2], 1)
  assert.equal(decalMask.reduce((a, b) => a + b, 0), 1)
})

test('skips a decal facing away from the camera', () => {
  const { image, decalMask } = decalScene([0, 0, -1], 4)
  assert.notEqual(getPixel(image, 2, 3), RED)
  assert.equal(decalMask.reduce((a, b) => a + b, 0), 0)
})

test('skips a decal covered by a surface more than one pixel depth in front of it', () => {
  const covered = decalScene([0, 0, 1], 2)
  assert.notEqual(getPixel(covered.image, 2, 3), RED)
  assert.equal(covered.decalMask.reduce((a, b) => a + b, 0), 0)
  assert.equal(getPixel(decalScene([0, 0, 1], 3.5).image, 2, 3), RED)
})

const selective: Style = {
  ...style,
  outlineMode: 'selective',
  materials: { m: ['#000010', '#0000ff'], n: ['#100000', '#ff0000'] }
}
const twoParts: Mannequin = {
  ...mannequin,
  parts: [...mannequin.parts, { ...mannequin.parts[0], name: 'q', material: 'n' }]
}

test('uniform mode marks the outline pixels in the mask and keeps one colour', () => {
  const { image, outlineMask } = stylize(block([0, 0, 1]), mannequin, camera, { ...style, outlineMode: 'uniform' })
  assert.equal(getPixel(image, 0, 2), OUTLINE)
  assert.equal(outlineMask[2 * 5 + 0], 1)
  assert.equal(outlineMask[2 * 5 + 2], 0)
  assert.equal(outlineMask.reduce((a, b) => a + b, 0), 12)
})

test('selective mode paints the outline with the darkest shade of the bordering part', () => {
  const g = block([0, 0, 1])
  for (let y = 1; y <= 3; y++) g.part[y * 5 + 3] = 1
  const { image } = stylize(g, twoParts, camera, selective)
  assert.equal(getPixel(image, 0, 2), DARK)
  assert.equal(getPixel(image, 4, 2), 0x100000)
  assert.equal(getPixel(image, 2, 2), LIGHT)
})

test('selective mode takes the nearest bordering part, then the lower index on a tie', () => {
  const g = block([0, 0, 1])
  g.part.fill(EMPTY)
  g.part[1 * 5 + 1] = 0
  g.part[2 * 5 + 2] = 1
  g.depth[1 * 5 + 1] = 3
  g.depth[2 * 5 + 2] = 2
  g.normal.set([0, 0, 1], (1 * 5 + 1) * 3)
  g.normal.set([0, 0, 1], (2 * 5 + 2) * 3)
  const nearer = stylize(g, twoParts, camera, selective).image
  assert.equal(getPixel(nearer, 2, 1), 0x100000)
  assert.equal(getPixel(nearer, 1, 2), 0x100000)
  g.depth[2 * 5 + 2] = 3
  const tied = stylize(g, twoParts, camera, selective).image
  assert.equal(getPixel(tied, 2, 1), DARK)
})

test('selective mode ignores decal colours when choosing the outline colour', () => {
  const g = block([0, 0, 1])
  g.depth.fill(4)
  const m: Mannequin = { ...mannequin, decals: [{ ...eye, normal: [0, 0, 1] }] }
  const { image, decalMask } = stylize(g, m, camera, selective)
  assert.equal(decalMask[3 * 5 + 2], 1)
  assert.equal(getPixel(image, 0, 2), DARK)
})
