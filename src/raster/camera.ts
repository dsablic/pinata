import { add, cross, dot, length, normalize, scale } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import type { Mannequin } from '../formats/mannequin.ts'
import { boundingSphere } from './bounds.ts'

export type Camera = {
  forward: Vec3
  right: Vec3
  up: Vec3
  pixelsPerUnit: number
  width: number
  height: number
  baseline: number
  rayDistance: number
}

export type CameraOptions = {
  azimuthDeg: number
  elevationDeg: number
  targetHeightPx: number
  modelHeight: number
  margin: number
}

export type FitOptions = {
  azimuthDeg: number
  elevationDeg: number
  targetHeightPx: number
  margin: number
}

type Basis = { forward: Vec3, right: Vec3, up: Vec3 }

function makeBasis (azimuthDeg: number, elevationDeg: number): Basis {
  if (elevationDeg <= -90 || elevationDeg >= 90) throw new RangeError('elevation must be within (-90, 90)')
  const az = azimuthDeg * Math.PI / 180
  const el = elevationDeg * Math.PI / 180
  const toCamera: Vec3 = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]
  const forward = scale(toCamera, -1)
  const right = normalize(cross(forward, [0, 1, 0]))
  return { forward, right, up: cross(right, forward) }
}

export function makeCamera (o: CameraOptions): Camera {
  const size = o.targetHeightPx + 2 * o.margin
  return {
    ...makeBasis(o.azimuthDeg, o.elevationDeg),
    pixelsPerUnit: o.targetHeightPx / o.modelHeight,
    width: size,
    height: size,
    baseline: size - o.margin,
    rayDistance: o.modelHeight * 4
  }
}

export function fitCamera (m: Mannequin, o: FitOptions): Camera {
  if (o.margin < 1) throw new RangeError('margin must be at least 1 so the outline has a free pixel')
  const basis = makeBasis(o.azimuthDeg, o.elevationDeg)
  const pixelsPerUnit = o.targetHeightPx / m.height
  let uMax = 0
  let vMin = 0
  let vMax = 0
  let reach = 0
  for (const part of m.parts) {
    const { center, radius } = boundingSphere(m, part)
    const v = dot(center, basis.up)
    uMax = Math.max(uMax, Math.abs(dot(center, basis.right)) + radius)
    vMin = Math.min(vMin, v - radius)
    vMax = Math.max(vMax, v + radius)
    reach = Math.max(reach, length(center) + radius)
  }
  const top = Math.ceil(vMax * pixelsPerUnit)
  const bottom = Math.floor(vMin * pixelsPerUnit)
  return {
    ...basis,
    pixelsPerUnit,
    width: 2 * Math.ceil(uMax * pixelsPerUnit) + 2 * o.margin,
    height: top - bottom + 2 * o.margin,
    baseline: o.margin + top,
    rayDistance: reach + 1
  }
}

export function rayOrigin (cam: Camera, x: number, y: number): Vec3 {
  const u = (x - cam.width / 2) / cam.pixelsPerUnit
  const v = (cam.baseline - y) / cam.pixelsPerUnit
  return add(add(scale(cam.right, u), scale(cam.up, v)), scale(cam.forward, -cam.rayDistance))
}

export function project (cam: Camera, p: Vec3): { x: number, y: number, depth: number } {
  return {
    x: cam.width / 2 + dot(p, cam.right) * cam.pixelsPerUnit,
    y: cam.baseline - dot(p, cam.up) * cam.pixelsPerUnit,
    depth: dot(p, cam.forward) + cam.rayDistance
  }
}

export function toCameraSpace (cam: Camera, n: Vec3): Vec3 {
  return [dot(n, cam.right), dot(n, cam.up), -dot(n, cam.forward)]
}
