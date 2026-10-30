import { add, cross, dot, normalize, scale } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'

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

export function makeCamera (o: CameraOptions): Camera {
  if (o.elevationDeg <= -90 || o.elevationDeg >= 90) throw new RangeError('elevation must be within (-90, 90)')
  const az = o.azimuthDeg * Math.PI / 180
  const el = o.elevationDeg * Math.PI / 180
  const toCamera: Vec3 = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]
  const forward = scale(toCamera, -1)
  const right = normalize(cross(forward, [0, 1, 0]))
  const size = o.targetHeightPx + 2 * o.margin
  return {
    forward,
    right,
    up: cross(right, forward),
    pixelsPerUnit: o.targetHeightPx / o.modelHeight,
    width: size,
    height: size,
    baseline: size - o.margin,
    rayDistance: o.modelHeight * 4
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
