import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Mannequin } from '../src/formats/mannequin.ts'
import type { Vec3 } from '../src/math/vec.ts'
import type { Recording } from '../src/sim/metrics.ts'
import { getPixel } from '../src/image.ts'
import { angleChart, bodyFrameOnionSkin, sideOnionSkin, topDownTrace } from '../src/diagnostics/motion-images.ts'

const body: Mannequin = {
  name: 'test',
  height: 2,
  joints: { origin: [0, 1, 0] },
  parts: [{ name: 'ball', shape: 'capsule', a: 'origin', b: 'origin', radiusA: 0.3, radiusB: 0.3, material: 'm' }],
  decals: []
}

function walk (): Recording {
  const frames = []
  for (let i = 0; i < 12; i++) {
    const x = i * 0.2
    frames.push({
      time: i / 24,
      root: { position: [x, 0, 0] as Vec3, yaw: i * 0.1, velocity: [0, 0, 0] as Vec3, angularVelocity: 0 },
      positions: Float64Array.from([x, 1.5, -0.3, x - 0.3, 0.6, -0.3 + 0.05 * i]),
      penetration: new Float64Array(2)
    })
  }
  return { constraints: [{ a: 0, b: 1, rest: 0.9, compliance: 0 }], frames }
}

function dark (img: { data: Uint8ClampedArray }): number {
  let n = 0
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] > 0 && img.data[i] < 80 && img.data[i + 1] < 80 && img.data[i + 2] < 80) n++
  }
  return n
}

const swing = { hem: [1], anchorLocal: [0, 1.5, -0.3] as Vec3 }

test('topDownTrace returns a square image with a dark body path', () => {
  const img = topDownTrace(walk(), { size: 128, hem: [1], body, exclude: [] })
  assert.equal(img.width, 128)
  assert.equal(img.height, 128)
  assert.ok(dark(img) > 20)
})

test('sideOnionSkin draws a body silhouette and the cape', () => {
  const img = sideOnionSkin(walk(), { size: 128, every: 4, body, exclude: [], horizontal: 'x' })
  assert.equal(img.width, 128)
  assert.ok(dark(img) > 50)
})

function fixedInBody (): Recording {
  const frames = []
  for (let i = 0; i < 8; i++) {
    const yaw = i * 0.3
    const position: Vec3 = [i * 0.5, 0, i * 0.2]
    const local = [0, 1.5, -0.4, 0, 0.6, -0.9]
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    const positions = new Float64Array(6)
    for (let k = 0; k < 6; k += 3) {
      positions[k] = position[0] + local[k] * c + local[k + 2] * s
      positions[k + 1] = local[k + 1]
      positions[k + 2] = position[2] - local[k] * s + local[k + 2] * c
    }
    frames.push({
      time: i / 24,
      root: { position, yaw, velocity: [0, 0, 0] as Vec3, angularVelocity: 0 },
      positions,
      penetration: new Float64Array(2)
    })
  }
  return { constraints: [{ a: 0, b: 1, rest: 0.9, compliance: 0 }], frames }
}

test('bodyFrameOnionSkin draws the body silhouette at the requested size', () => {
  const img = bodyFrameOnionSkin(fixedInBody(), { size: 128, frames: [0], body, exclude: [] })
  assert.equal(img.width, 128)
  assert.equal(img.height, 128)
  assert.ok(dark(img) > 50)
})

test('bodyFrameOnionSkin collapses a cape fixed in body space to one shape', () => {
  const rigid = fixedInBody()
  const one = bodyFrameOnionSkin(rigid, { size: 128, frames: [7], body, exclude: [] })
  const many = bodyFrameOnionSkin(rigid, { size: 128, frames: [0, 1, 2, 3, 4, 5, 6, 7], body, exclude: [] })
  assert.deepEqual(many.data, one.data)
})

test('bodyFrameOnionSkin front view puts the body-local +X side on the right', () => {
  const positions = new Float64Array([0.6, 1.5, -0.3, 0.6, 0.6, -0.3])
  const root = { position: [0, 0, 0] as Vec3, yaw: 0, velocity: [0, 0, 0] as Vec3, angularVelocity: 0 }
  const rec: Recording = {
    constraints: [{ a: 0, b: 1, rest: 0.9, compliance: 0 }],
    frames: [{ time: 0, root, positions, penetration: new Float64Array(2) }]
  }
  const img = bodyFrameOnionSkin(rec, { size: 128, frames: [0], body, exclude: [], horizontal: 'x' })
  let left = 0
  let right = 0
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const c = getPixel(img, x, y)
      if (((c >> 16) & 0xff) - ((c >> 8) & 0xff) < 60) continue
      if (x < img.width / 2) left++
      else right++
    }
  }
  assert.ok(right > 0 && left === 0, `cape pixels left ${left}, right ${right}`)
})

test('angleChart plots swing and yaw into an image of the requested size', () => {
  const img = angleChart(walk(), { width: 160, height: 90, swing })
  assert.equal(img.width, 160)
  assert.equal(img.height, 90)
})
