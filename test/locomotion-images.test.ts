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
import { rootAt } from './rendering-fixtures.ts'

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
      root: rootAt([0, 0, z]),
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
    root: rootAt([0, 0, i * 0.3]),
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

test('pixelStrip draws the cloth parts of every frame beside the body, placed in the strip like the body', () => {
  const frames: LocomotionFrame[] = [0, 1].map(i => ({
    time: i / 24,
    root: rootAt([0, 0, i * 0.3]),
    joints: pose(i * 0.3, 0, 0, i * 0.3, i * 0.3),
    clamped: 0,
    planted: { left: true, right: true }
  }))
  const options = {
    mannequin, style, frames: [0, 1], azimuthDeg: 270, elevationDeg: 0, targetHeightPx: 48, scale: 1, gap: 2
  }
  const plain = pixelStrip({ fps: 24, frames }, options)
  const seen: number[] = []
  const cloth = (frame: number, origin: { position: number[] }) => {
    seen.push(frame)
    const z = frames[frame].root.position[2] - origin.position[2]
    return {
      joints: { 'c.0': [0, 1.2, z - 0.3], 'c.1': [0, 0.6, z - 0.3] } as Record<string, [number, number, number]>,
      parts: [{
        name: 'c.0-1', shape: 'capsule' as const, a: 'c.0', b: 'c.1', radiusA: 0.05, radiusB: 0.05, material: 'm',
        allowThin: true
      }]
    }
  }
  const drawn = pixelStrip({ fps: 24, frames }, { ...options, cloth })
  const count = (img: Image): number => {
    const background = getPixel(img, 0, 0)
    let n = 0
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) if (getPixel(img, x, y) !== background) n++
    }
    return n
  }
  assert.deepEqual(seen, [0, 1])
  assert.ok(count(drawn) > count(plain))
})

function footprintRecording (yawRate: number): LocomotionRecording {
  const frames: LocomotionFrame[] = []
  for (let i = 0; i < 40; i++) {
    const yaw = yawRate * i
    const z = i * 0.05 * Math.cos(yaw)
    const x = i * 0.05 * Math.sin(yaw)
    const joints = structuredClone(rest)
    for (const [name, [jx, y, jz]] of Object.entries(rest)) joints[name] = [jx + x, y, jz + z]
    const leftOn = i % 20 < 10
    const rightOn = i % 20 >= 10
    joints.ankleL = [0.1 + x, leftOn ? 0.1 : 0.4, z]
    joints.toeL = [0.1 + x, leftOn ? 0.05 : 0.35, z + 0.15]
    joints.ankleR = [-0.1 + x, rightOn ? 0.1 : 0.4, z]
    joints.toeR = [-0.1 + x, rightOn ? 0.05 : 0.35, z + 0.15]
    frames.push({
      time: i / 24,
      root: rootAt([x, 0, z], yaw),
      joints,
      clamped: 0,
      planted: { left: leftOn, right: rightOn }
    })
  }
  return { fps: 24, frames }
}

function centroidX (img: Image, rgb: number): number {
  let sum = 0
  let n = 0
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (getPixel(img, x, y) === rgb) {
        sum += x
        n++
      }
    }
  }
  return sum / n
}

test('footprintTrace is a view from above: a left foot at +X is left of a path that goes up the image', () => {
  const img = footprintTrace(footprintRecording(0), { ...geometry, size: 256 })
  assert.ok(centroidX(img, LEFT_FOOT) < centroidX(img, RIGHT_FOOT))
})

test('footprintTrace bends the path to the walker\'s left for a positive yaw turn', () => {
  const img = footprintTrace(footprintRecording(0.03), { ...geometry, size: 256 })
  let top = -1
  let bottom = -1
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (getPixel(img, x, y) !== 0x000000) continue
      if (top < 0) top = x
      bottom = x
    }
  }
  assert.ok(top < bottom, `path top at ${top}, bottom at ${bottom}`)
})

test('footprintTrace draws each footprint as a heel-to-toe mark and a hollow start marker', () => {
  const img = footprintTrace(footprintRecording(0), { ...geometry, size: 256 })
  let rows = 0
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (getPixel(img, x, y) === LEFT_FOOT) {
        rows++
        break
      }
    }
  }
  assert.ok(rows >= 4, `left footprints span ${rows} rows`)
  let widest = 0
  for (let y = 0; y < img.height; y++) {
    const xs = [...Array(img.width).keys()].filter(x => getPixel(img, x, y) === 0x000000)
    if (xs.length > 0) widest = Math.max(widest, xs[xs.length - 1] - xs[0])
  }
  assert.ok(widest >= 8, `widest black row ${widest}`)
})

test('legOnionSkin draws the sole points, so a planted foot touches the ground line', () => {
  const options = { ...geometry, width: 320, height: 160, from: 0, to: 0, every: 1, axis: 'z' as const }
  const img = legOnionSkin(walkRecording(), options)
  const ground = [...Array(img.height).keys()].filter(y => getPixel(img, 0, y) === GROUND)[0]
  let lowest = -1
  for (let y = 0; y < ground; y++) {
    for (let x = 0; x < img.width; x++) if (getPixel(img, x, y) === LEFT_FOOT) lowest = y
  }
  assert.ok(ground - lowest <= 1, `foot ends ${ground - lowest} px above the ground`)
})
