import type { Mannequin, Part } from '../formats/mannequin.ts'
import { normalize } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { boundingSphere } from './bounds.ts'
import { project } from './camera.ts'
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

/** Where the ray enters the primitive's bounding sphere (0 if it starts inside), or Infinity if it misses. */
function entry (prim: Primitive, ox: number, oy: number, oz: number, dir: Vec3): number {
  const ocx = ox - prim.center[0]
  const ocy = oy - prim.center[1]
  const ocz = oz - prim.center[2]
  const b = ocx * dir[0] + ocy * dir[1] + ocz * dir[2]
  const disc = b * b - (ocx * ocx + ocy * ocy + ocz * ocz - prim.radius * prim.radius)
  if (disc < 0) return Infinity
  return Math.max(-b - Math.sqrt(disc), 0)
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

type Scene = {
  prims: Primitive[]
  cam: Camera
  acc: Accumulator
  active: Int32Array
  count: number
  entries: Float64Array
  order: Int32Array
}

/**
 * Traces the primitives in order of where the ray enters their bounding spheres and stops once the nearest hit lies
 * before the next entry: a primitive can only be hit inside its sphere. Equal hits go to the lower part index, as a
 * plain scan in index order would choose, so the result is the same as tracing every primitive.
 */
function sample (scene: Scene, ox: number, oy: number, oz: number): void {
  const { prims, cam, acc, active, entries, order } = scene
  const dir = cam.forward
  let candidates = 0
  for (let k = 0; k < scene.count; k++) {
    const i = active[k]
    const t = entry(prims[i], ox, oy, oz, dir)
    if (t === Infinity) continue
    let j = candidates++
    while (j > 0 && (entries[j - 1] > t || (entries[j - 1] === t && order[j - 1] > i))) {
      entries[j] = entries[j - 1]
      order[j] = order[j - 1]
      j--
    }
    entries[j] = t
    order[j] = i
  }
  let best = -1
  let bestT = Infinity
  for (let k = 0; k < candidates && entries[k] <= bestT; k++) {
    const i = order[k]
    const t = trace(prims[i], ox, oy, oz, dir)
    if (t < bestT || (t === bestT && i < best)) {
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

type Disc = { x: number, y: number, r2: number }

const DISC_SLACK_PX = 1e-3

function screenDisc (cam: Camera, prim: Primitive): Disc {
  const { x, y } = project(cam, prim.center)
  const r = prim.radius * cam.pixelsPerUnit + DISC_SLACK_PX
  return { x, y, r2: r * r }
}

/**
 * The pixel rectangle [x0, x1) x [y0, y1) that any primitive's screen disc can touch; pixels outside it get no samples
 * and resolve to empty, exactly as a pixel with no hits does, so they are skipped.
 */
function coveredRect (discs: Disc[], cam: Camera): [number, number, number, number] {
  if (discs.length === 0) return [0, 0, 0, 0]
  let [left, right, top, bottom] = [Infinity, -Infinity, Infinity, -Infinity]
  for (const d of discs) {
    const r = Math.sqrt(d.r2)
    left = Math.min(left, d.x - r)
    right = Math.max(right, d.x + r)
    top = Math.min(top, d.y - r)
    bottom = Math.max(bottom, d.y + r)
  }
  const clamp = (v: number, max: number): number => Math.min(max, Math.max(0, v))
  return [
    clamp(Math.floor(left) - 1, cam.width), clamp(Math.ceil(right) + 1, cam.width),
    clamp(Math.floor(top) - 1, cam.height), clamp(Math.ceil(bottom) + 1, cam.height)
  ]
}

function cull (discs: Disc[], px: number, py: number, active: Int32Array): number {
  let count = 0
  for (let i = 0; i < discs.length; i++) {
    const d = discs[i]
    const dx = Math.max(px - d.x, d.x - (px + 1), 0)
    const dy = Math.max(py - d.y, d.y - (py + 1), 0)
    if (dx * dx + dy * dy <= d.r2) active[count++] = i
  }
  return count
}

/**
 * With the previous frame's buffer, a pixel keeps its state while the coverage is within a hysteresis band of the
 * threshold and keeps its part while that part is within a couple of samples of the winner, so edges and part
 * boundaries do not flip back and forth as a slow motion hovers on them.
 */
export function rasterize (m: Mannequin, cam: Camera, samples = 4, previous?: GBuffer): GBuffer {
  const prims = m.parts.map(part => compile(m, part))
  const pixels = cam.width * cam.height
  const g: GBuffer = {
    width: cam.width,
    height: cam.height,
    part: new Int16Array(pixels).fill(EMPTY),
    depth: new Float32Array(pixels),
    normal: new Float32Array(pixels * 3),
    coverage: new Float32Array(pixels)
  }
  const acc: Accumulator = {
    hits: new Float64Array(prims.length),
    depth: new Float64Array(prims.length),
    normal: new Float64Array(prims.length * 3),
    scratch: new Float64Array(3),
    total: 0
  }
  const discs = prims.map(prim => screenDisc(cam, prim))
  const scene: Scene = {
    prims,
    cam,
    acc,
    active: new Int32Array(prims.length),
    count: 0,
    entries: new Float64Array(prims.length),
    order: new Int32Array(prims.length)
  }
  const [rx, ry, rz] = cam.right
  const [ux, uy, uz] = cam.up
  const behind = -cam.rayDistance
  const [bx, by, bz] = [cam.forward[0] * behind, cam.forward[1] * behind, cam.forward[2] * behind]
  const [x0, x1, y0, y1] = coveredRect(discs, cam)
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      acc.hits.fill(0)
      acc.depth.fill(0)
      acc.normal.fill(0)
      acc.total = 0
      scene.count = cull(discs, px, py, scene.active)
      for (let sy = 0; sy < samples && scene.count > 0; sy++) {
        const v = (cam.baseline - (py + (sy + 0.5) / samples)) / cam.pixelsPerUnit
        for (let sx = 0; sx < samples; sx++) {
          const u = (px + (sx + 0.5) / samples - cam.width / 2) / cam.pixelsPerUnit
          sample(scene, rx * u + ux * v + bx, ry * u + uy * v + by, rz * u + uz * v + bz)
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
