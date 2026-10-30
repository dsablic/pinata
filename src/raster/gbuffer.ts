import type { Mannequin, Part } from '../formats/mannequin.ts'
import { normalize } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { boundingSphere } from './bounds.ts'
import { rayOrigin } from './camera.ts'
import type { Camera } from './camera.ts'
import { boxDistance, boxFrame, roundCone, roundConeDistance } from './sdf.ts'

export const EMPTY = -1

export type GBuffer = {
  width: number
  height: number
  part: Int16Array
  depth: Float32Array
  normal: Float32Array
  coverage: Float32Array
}

export type Primitive = {
  sdf: (p: Vec3) => number
  dist: (x: number, y: number, z: number) => number
  center: Vec3
  radius: number
}

type Accumulator = {
  hits: Float64Array
  depth: Float64Array
  normal: Float64Array
  scratch: Float64Array
  total: number
}

const HIT_EPSILON = 1e-4
const MAX_STEPS = 256
const NORMAL_STEP = 1e-4
const COVERAGE_THRESHOLD = 0.5
const COVERAGE_HYSTERESIS = 0.1
const STICKY_SAMPLES = 2

export function compile (m: Mannequin, part: Part): Primitive {
  const { center, radius } = boundingSphere(m, part)
  if (part.shape === 'capsule') {
    const cone = roundCone(m.joints[part.a], m.joints[part.b], part.radiusA, part.radiusB)
    const dist = (x: number, y: number, z: number): number => roundConeDistance(cone, x, y, z)
    return { sdf: p => dist(p[0], p[1], p[2]), dist, center, radius }
  }
  const frame = boxFrame(m.joints[part.a], m.joints[part.b], part)
  const dist = (x: number, y: number, z: number): number => boxDistance(frame, x, y, z)
  return { sdf: p => dist(p[0], p[1], p[2]), dist, center, radius }
}

function trace (prim: Primitive, ox: number, oy: number, oz: number, dir: Vec3): number {
  const [dx, dy, dz] = dir
  const ocx = ox - prim.center[0]
  const ocy = oy - prim.center[1]
  const ocz = oz - prim.center[2]
  const b = ocx * dx + ocy * dy + ocz * dz
  const disc = b * b - (ocx * ocx + ocy * ocy + ocz * ocz - prim.radius * prim.radius)
  if (disc < 0) return Infinity
  const s = Math.sqrt(disc)
  const tFar = -b + s
  let t = Math.max(-b - s, 0)
  for (let i = 0; i < MAX_STEPS && t <= tFar; i++) {
    const d = prim.dist(ox + dx * t, oy + dy * t, oz + dz * t)
    if (d < HIT_EPSILON) return t
    t += d
  }
  return Infinity
}

function writeNormal (prim: Primitive, px: number, py: number, pz: number, out: Float64Array): void {
  const h = NORMAL_STEP
  const nx = prim.dist(px + h, py, pz) - prim.dist(px - h, py, pz)
  const ny = prim.dist(px, py + h, pz) - prim.dist(px, py - h, pz)
  const nz = prim.dist(px, py, pz + h) - prim.dist(px, py, pz - h)
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz)
  const k = 1 / l
  out[0] = l === 0 ? 0 : nx * k
  out[1] = l === 0 ? 0 : ny * k
  out[2] = l === 0 ? 0 : nz * k
}

function sample (prims: Primitive[], cam: Camera, o: Vec3, acc: Accumulator): void {
  const [ox, oy, oz] = o
  const dir = cam.forward
  let best = -1
  let bestT = Infinity
  for (let i = 0; i < prims.length; i++) {
    const t = trace(prims[i], ox, oy, oz, dir)
    if (t < bestT) {
      bestT = t
      best = i
    }
  }
  if (best === -1) return
  const n = acc.scratch
  writeNormal(prims[best], ox + dir[0] * bestT, oy + dir[1] * bestT, oz + dir[2] * bestT, n)
  const [rx, ry, rz] = cam.right
  const [ux, uy, uz] = cam.up
  acc.total++
  acc.hits[best]++
  acc.depth[best] += bestT
  acc.normal[best * 3] += n[0] * rx + n[1] * ry + n[2] * rz
  acc.normal[best * 3 + 1] += n[0] * ux + n[1] * uy + n[2] * uz
  acc.normal[best * 3 + 2] += -(n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2])
}

/**
 * With the previous frame's buffer, a pixel keeps its state while the coverage is within a hysteresis band of the
 * threshold and keeps its part while that part is within a couple of samples of the winner, so edges and part
 * boundaries do not flip back and forth as a slow motion hovers on them.
 */
export function rasterize (m: Mannequin, cam: Camera, samples = 4, previous?: GBuffer): GBuffer {
  const prims = m.parts.map(part => compile(m, part))
  const count = cam.width * cam.height
  const g: GBuffer = {
    width: cam.width,
    height: cam.height,
    part: new Int16Array(count).fill(EMPTY),
    depth: new Float32Array(count),
    normal: new Float32Array(count * 3),
    coverage: new Float32Array(count)
  }
  const acc: Accumulator = {
    hits: new Float64Array(prims.length),
    depth: new Float64Array(prims.length),
    normal: new Float64Array(prims.length * 3),
    scratch: new Float64Array(3),
    total: 0
  }
  for (let py = 0; py < cam.height; py++) {
    for (let px = 0; px < cam.width; px++) {
      acc.hits.fill(0)
      acc.depth.fill(0)
      acc.normal.fill(0)
      acc.total = 0
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          sample(prims, cam, rayOrigin(cam, px + (sx + 0.5) / samples, py + (sy + 0.5) / samples), acc)
        }
      }
      resolvePixel(g, py * cam.width + px, acc, { samples: samples * samples, previous })
    }
  }
  return g
}

type Resolve = { samples: number, previous?: GBuffer }

function resolvePixel (g: GBuffer, i: number, acc: Accumulator, resolve: Resolve): void {
  const { previous } = resolve
  g.coverage[i] = acc.total / resolve.samples
  const before = previous === undefined ? EMPTY : previous.part[i]
  const bias = before === EMPTY ? COVERAGE_HYSTERESIS : -COVERAGE_HYSTERESIS
  if (g.coverage[i] < COVERAGE_THRESHOLD + (previous === undefined ? 0 : bias)) return
  let winner = 0
  for (let p = 1; p < acc.hits.length; p++) {
    if (acc.hits[p] > acc.hits[winner]) winner = p
  }
  if (before !== EMPTY && acc.hits[before] > 0 && acc.hits[before] + STICKY_SAMPLES >= acc.hits[winner]) {
    winner = before
  }
  g.part[i] = winner
  g.depth[i] = acc.depth[winner] / acc.hits[winner]
  g.normal.set(normalize([acc.normal[winner * 3], acc.normal[winner * 3 + 1], acc.normal[winner * 3 + 2]]), i * 3)
}
