import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Style } from '../src/formats/style.ts'
import { getPixel } from '../src/image.ts'
import type { Image } from '../src/image.ts'
import {
  footprintTrace, GROUND, LEFT_FOOT, legOnionSkin, pixelStrip, RIGHT_FOOT
} from '../src/diagnostics/locomotion-images.ts'
import type { LocomotionFrame, LocomotionRecording } from '../src/motion/metrics.ts'
import { restPose } from '../src/motion/pose.ts'
import type { Pose } from '../src/motion/pose.ts'
import { mannequin, rig } from './locomotion-fixtures.ts'

const rest = restPose(mannequin)
const geometry = { rig, mannequin }

function pose (z: number, left: number, right: number, leftZ: number, rightZ: number): Pose {
  const joints = structuredClone(rest)
  for (const [name, [x, y, dz]] of Object.entries(rest)) joints[name] = [x, y, dz + z]
  joints.ankleL = [0.1, 0.1 + left, leftZ]
  joints.toeL = [0.1, 0.05 + left, leftZ + 0.15]
  joints.ankleR = [-0.1, 0.1 + right, rightZ]
  joints.toeR = [-0.1, 0.05 + right, rightZ + 0.15]
  return joints
}

function walkRecording (): LocomotionRecording {
  const frames: LocomotionFrame[] = []
  const leftPlants = [0, 1, 2]
  const rightPlants = [0.5, 1.5]
  for (let i = 0; i < 40; i++) {
    const z = i * 0.05
    const leftIndex = Math.min(2, Math.floor(i / 13))
    const rightIndex = Math.min(1, Math.floor(i / 20))
    const leftOn = i % 13 < 7
    const rightOn = i % 20 < 9
    frames.push({
      time: i / 24,
      root: { position: [0, 0, z], yaw: 0, velocity: [0, 0, 0], angularVelocity: 0 },
      joints: pose(z, leftOn ? 0 : 0.3, rightOn ? 0 : 0.3, leftPlants[leftIndex], rightPlants[rightIndex]),
      clamped: 0,
      planted: { left: leftOn, right: rightOn }
    })
  }
  return { fps: 24, frames }
}

function components (img: Image, rgb: number): number {
  const seen = new Set<number>()
  let count = 0
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (getPixel(img, x, y) !== rgb || seen.has(y * img.width + x)) continue
      count++
      const stack = [[x, y]]
      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!
        const key = cy * img.width + cx
        if (cx < 0 || cy < 0 || cx >= img.width || cy >= img.height || seen.has(key)) continue
        if (getPixel(img, cx, cy) !== rgb) continue
        seen.add(key)
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
      }
    }
  }
  return count
}

test('footprintTrace has the requested size and one disc per planted foot run in two colours', () => {
  const rec = walkRecording()
  const img = footprintTrace(rec, { ...geometry, size: 256 })
  assert.equal(img.width, 256)
  assert.equal(img.height, 256)
  assert.equal(components(img, LEFT_FOOT), 3)
  assert.equal(components(img, RIGHT_FOOT), 2)
})

test('footprintTrace draws forward motion upward: the last plant lies above the end of the root path', () => {
  const img = footprintTrace(walkRecording(), { ...geometry, size: 256 })
  const topRow = (rgb: number): number => {
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) if (getPixel(img, x, y) === rgb) return y
    }
    return -1
  }
  assert.ok(topRow(0x000000) >= 0)
  assert.ok(topRow(LEFT_FOOT) < topRow(0x000000))
})

test('legOnionSkin has the requested size, a ground line and both legs', () => {
  const options = { ...geometry, width: 320, height: 160, from: 0, to: 39, every: 3, axis: 'z' as const }
  const img = legOnionSkin(walkRecording(), options)
  assert.equal(img.width, 320)
  assert.equal(img.height, 160)
  let groundRows = 0
  for (let y = 0; y < img.height; y++) {
    let n = 0
    for (let x = 0; x < img.width; x++) if (getPixel(img, x, y) === GROUND) n++
    if (n >= img.width * 0.9) groundRows++
  }
  assert.ok(groundRows >= 1)
  assert.ok(components(img, LEFT_FOOT) + components(img, RIGHT_FOOT) > 0)
})

const style: Style = {
  name: 'test',
  light: [0, 0, 1],
  bands: [0.5],
  outline: '#101010',
  innerLineDepth: 0.1,
  decalMinFacing: 0.3,
  materials: { m: ['#000010', '#0000ff'] },
  decalColors: {}
}

test('pixelStrip lays frames side by side with a fixed camera so the character moves across the strip', () => {
  const frames: LocomotionFrame[] = [0, 1, 2, 3].map(i => ({
    time: i / 24,
    root: { position: [0, 0, i * 0.3], yaw: 0, velocity: [0, 0, 0], angularVelocity: 0 },
    joints: pose(i * 0.3, 0, 0, i * 0.3, i * 0.3),
    clamped: 0,
    planted: { left: true, right: true }
  }))
  const options = {
    mannequin, style, frames: [0, 1, 2, 3], azimuthDeg: 270, elevationDeg: 0, targetHeightPx: 48, scale: 2, gap: 2
  }
  const img = pixelStrip({ fps: 24, frames }, options)
  const cell = (img.width - 5 * 2) / 4
  assert.ok(Number.isInteger(cell))
  const background = getPixel(img, 0, 0)
  const centres = [0, 1, 2, 3].map(c => {
    let sum = 0
    let n = 0
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < cell; x++) {
        const px = 2 + c * (cell + 2) + x
        if (getPixel(img, px, y) !== background) {
          sum += x
          n++
        }
      }
    }
    assert.ok(n > 0)
    return sum / n
  })
  assert.ok(centres[0] < centres[1] && centres[1] < centres[2] && centres[2] < centres[3], centres.join(','))
})
