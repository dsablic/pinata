import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getPixel, imageHash, neighbours4, parseHex, TRANSPARENT } from '../src/image.ts'
import type { Image } from '../src/image.ts'
import type { Mannequin } from '../src/formats/mannequin.ts'
import type { Skin } from '../src/formats/skin.ts'
import type { Vec3 } from '../src/math/vec.ts'
import { makeCamera } from '../src/raster/camera.ts'
import { renderSkinned, snapAngle } from '../src/style/skins.ts'

const camera = makeCamera({ azimuthDeg: 270, elevationDeg: 0, targetHeightPx: 20, modelHeight: 20, margin: 10 })
const ORIGIN = { x: 20, y: 30 }
const PALETTE = { o: '#000010', a: '#e0e0e0', b: '#a03030', c: '#30a030' }

function capsule (name: string, a: string, b: string) {
  return { name, shape: 'capsule' as const, a, b, radiusA: 0.1, radiusB: 0.1, material: 'x' }
}

function mannequinOf (parts: Mannequin['parts'], joints: Record<string, Vec3>): Mannequin {
  return { name: 'm', height: 20, joints, parts, decals: [] }
}

const bar = { rows: ['aaaa', 'aaaa'], pivotA: [0, 0] as [number, number], pivotB: [3, 0] as [number, number] }

function skinOf (parts: Skin['parts']): Skin {
  return { name: 's', view: 'side-right', palette: PALETTE, parts }
}

function renderBar (b: Vec3): Image {
  const m = mannequinOf([capsule('bar', 'a', 'b')], { a: [0, 0, 0], b })
  return renderSkinned({ mannequin: m, pose: m.joints, skin: skinOf({ bar }), camera })
}

function pixelsOf (img: Image, colour: string): string[] {
  const out: string[] = []
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) if (getPixel(img, x, y) === parseHex(colour)) out.push(`${x},${y}`)
  }
  return out
}

test('a bar pointing right lands with pivotA on the joint', () => {
  const found = pixelsOf(renderBar([0, 0, 8]), PALETTE.a)
  const expected = [30, 31].flatMap(y => [20, 21, 22, 23].map(x => `${x},${y}`))
  assert.deepEqual(found.sort(), expected.sort())
})

test('a bar pointing down is rotated by 90 degrees about pivotA', () => {
  const found = pixelsOf(renderBar([0, -8, 0]), PALETTE.a)
  const expected = [19, 20].flatMap(x => [30, 31, 32, 33].map(y => `${x},${y}`))
  assert.deepEqual(found.sort(), expected.sort())
})

test('snapAngle rounds to 22.5 degree steps', () => {
  const degrees = (d: number): number => snapAngle(d * Math.PI / 180) * 180 / Math.PI
  assert.equal(degrees(10), 0)
  assert.equal(degrees(12), 22.5)
  assert.equal(degrees(-80), -90)
  assert.equal(degrees(100), 90)
  assert.equal(degrees(170), 180)
})

test('a bone at 10 degrees renders the same as one at 0', () => {
  const flat = renderBar([0, 0, 8])
  const tilted = renderBar([0, -8 * Math.tan(10 * Math.PI / 180), 8])
  assert.equal(imageHash(tilted), imageHash(flat))
})

test('nearer parts are drawn over farther ones regardless of part order', () => {
  const dot = (colour: string) => ({ rows: [colour.repeat(3)], pivotA: [1, 0] as [number, number] })
  const joints: Record<string, Vec3> = { near: [-1, 0, 0], far: [1, 0, 0] }
  for (const order of [['near', 'far'], ['far', 'near']]) {
    const m = mannequinOf(order.map(n => capsule(n, n, n)), joints)
    const skin = skinOf({ near: dot('b'), far: dot('c') })
    const img = renderSkinned({ mannequin: m, pose: m.joints, skin, camera })
    assert.equal(getPixel(img, ORIGIN.x, ORIGIN.y), parseHex(PALETTE.b))
  }
})

test('single-joint parts are placed by pivotA and not rotated', () => {
  const m = mannequinOf([capsule('p', 'a', 'a')], { a: [0, 0, 0] })
  const part = { rows: ['ab', 'aa'], pivotA: [1, 1] as [number, number], pivotB: [0, 0] as [number, number] }
  const img = renderSkinned({ mannequin: m, pose: m.joints, skin: skinOf({ p: part }), camera })
  assert.equal(getPixel(img, ORIGIN.x - 1, ORIGIN.y - 1), parseHex(PALETTE.a))
  assert.equal(getPixel(img, ORIGIN.x, ORIGIN.y - 1), parseHex(PALETTE.b))
})

test('hidden parts are skipped', () => {
  const m = mannequinOf([capsule('bar', 'a', 'b')], { a: [0, 0, 0], b: [0, 0, 8] })
  const img = renderSkinned({ mannequin: m, pose: m.joints, skin: skinOf({ bar: { hidden: true } }), camera })
  assert.equal(img.data.every(v => v === 0), true)
})

test('the outline is closed and uses the darkest palette colour', () => {
  const img = renderBar([0, -8, 3])
  const outline = parseHex(PALETTE.o)
  let outlinePixels = 0
  for (let y = 1; y < img.height - 1; y++) {
    for (let x = 1; x < img.width - 1; x++) {
      const here = getPixel(img, x, y)
      if (here === outline) outlinePixels++
      if (here !== TRANSPARENT && here !== outline) {
        assert.ok(neighbours4(img, x, y).every(n => n !== TRANSPARENT), `open edge at ${x},${y}`)
      }
    }
  }
  assert.ok(outlinePixels > 0)
})

test('only palette colours appear, and rendering is deterministic', () => {
  const img = renderBar([0, -8, 5])
  const allowed = new Set(Object.values(PALETTE).map(parseHex))
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const px = getPixel(img, x, y)
      assert.ok(px === TRANSPARENT || allowed.has(px))
    }
  }
  assert.equal(imageHash(renderBar([0, -8, 5])), imageHash(img))
})
