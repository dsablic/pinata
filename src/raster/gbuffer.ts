import type { Mannequin, Part } from '../formats/mannequin.ts'
import { add, dot, length, normalize, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { rayOrigin, toCameraSpace } from './camera.ts'
import type { Camera } from './camera.ts'
import { boxFrame, sdBox, sdRoundCone } from './sdf.ts'

export const EMPTY = -1

export type GBuffer = {
  width: number
  height: number
  part: Int16Array
  depth: Float32Array
  normal: Float32Array
  coverage: Float32Array
}

type Primitive = { sdf: (p: Vec3) => number, center: Vec3, radius: number }

type Accumulator = { hits: Float64Array, depth: Float64Array, normal: Float64Array, total: number }

const HIT_EPSILON = 1e-4
const MAX_STEPS = 64
const NORMAL_STEP = 1e-4

function compile (m: Mannequin, part: Part): Primitive {
  const a = m.joints[part.a]
  const b = m.joints[part.b]
  const center = scale(add(a, b), 0.5)
  const halfLength = length(sub(b, a)) / 2
  if (part.shape === 'capsule') {
    return {
      sdf: p => sdRoundCone(p, a, b, part.radiusA, part.radiusB),
      center,
      radius: halfLength + Math.max(part.radiusA, part.radiusB)
    }
  }
  const frame = boxFrame(a, b, part)
  return { sdf: p => sdBox(p, frame), center, radius: length(frame.half) }
}

function trace (prim: Primitive, origin: Vec3, dir: Vec3): number {
  const oc = sub(origin, prim.center)
  const b = dot(oc, dir)
  const disc = b * b - (dot(oc, oc) - prim.radius * prim.radius)
  if (disc < 0) return Infinity
  const s = Math.sqrt(disc)
  const tFar = -b + s
  let t = Math.max(-b - s, 0)
  for (let i = 0; i < MAX_STEPS && t <= tFar; i++) {
    const d = prim.sdf(add(origin, scale(dir, t)))
    if (d < HIT_EPSILON) return t
    t += d
  }
  return Infinity
}

function surfaceNormal (prim: Primitive, p: Vec3): Vec3 {
  const h = NORMAL_STEP
  return normalize([
    prim.sdf([p[0] + h, p[1], p[2]]) - prim.sdf([p[0] - h, p[1], p[2]]),
    prim.sdf([p[0], p[1] + h, p[2]]) - prim.sdf([p[0], p[1] - h, p[2]]),
    prim.sdf([p[0], p[1], p[2] + h]) - prim.sdf([p[0], p[1], p[2] - h])
  ])
}

function sample (prims: Primitive[], cam: Camera, origin: Vec3, acc: Accumulator): void {
  let best = -1
  let bestT = Infinity
  for (let i = 0; i < prims.length; i++) {
    const t = trace(prims[i], origin, cam.forward)
    if (t < bestT) {
      bestT = t
      best = i
    }
  }
  if (best === -1) return
  const n = toCameraSpace(cam, surfaceNormal(prims[best], add(origin, scale(cam.forward, bestT))))
  acc.total++
  acc.hits[best]++
  acc.depth[best] += bestT
  acc.normal[best * 3] += n[0]
  acc.normal[best * 3 + 1] += n[1]
  acc.normal[best * 3 + 2] += n[2]
}

export function rasterize (m: Mannequin, cam: Camera, samples = 4): GBuffer {
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
      resolvePixel(g, py * cam.width + px, acc, samples * samples)
    }
  }
  return g
}

function resolvePixel (g: GBuffer, i: number, acc: Accumulator, sampleCount: number): void {
  g.coverage[i] = acc.total / sampleCount
  if (g.coverage[i] < 0.5) return
  let winner = 0
  for (let p = 1; p < acc.hits.length; p++) {
    if (acc.hits[p] > acc.hits[winner]) winner = p
  }
  g.part[i] = winner
  g.depth[i] = acc.depth[winner] / acc.hits[winner]
  g.normal.set(normalize([acc.normal[winner * 3], acc.normal[winner * 3 + 1], acc.normal[winner * 3 + 2]]), i * 3)
}
