import type { Mannequin, Part } from '../formats/mannequin.ts'
import type { Style } from '../formats/style.ts'
import type { Image } from '../image.ts'
import { apply } from '../math/matrix.ts'
import { add, dot, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { makeCamera } from '../raster/camera.ts'
import type { Camera } from '../raster/camera.ts'
import { rasterize } from '../raster/gbuffer.ts'
import type { GBuffer } from '../raster/gbuffer.ts'
import { stylize } from '../style/stylize.ts'
import type { LiveFrame } from './character.ts'

export type ViewOptions = {
  characterPx: number
  width: number
  height: number
  anchorAt: [number, number]
  azimuthDeg: number
  elevationDeg: number
  samples: number
}

export type View = { camera: Camera, render: (frame: LiveFrame) => Image }

const ROPE_TOP = '__ropeTop'
const ROPE_END = '__ropeEnd'
const ROPE_MATERIAL = '__rope'
const ROPE_RADIUS_PX = 0.6
const ROPE_RAMP = ['#4a3426', '#7a5a3a', '#a8865c']

export const DEFAULT_VIEW: ViewOptions = {
  characterPx: 64, width: 128, height: 140, anchorAt: [64, 2], azimuthDeg: 40, elevationDeg: 10, samples: 3
}

export function createView (character: { mannequin: Mannequin, style: Style }, options: ViewOptions): View {
  const { mannequin } = character
  const base = makeCamera({
    azimuthDeg: options.azimuthDeg,
    elevationDeg: options.elevationDeg,
    targetHeightPx: options.characterPx,
    modelHeight: mannequin.height,
    margin: 0
  })
  const camera: Camera = { ...base, width: options.width, height: options.height, baseline: options.height }
  const ppu = camera.pixelsPerUnit
  const rope: Part = {
    name: 'rope', shape: 'capsule', a: ROPE_TOP, b: ROPE_END, radiusA: ROPE_RADIUS_PX / ppu,
    radiusB: ROPE_RADIUS_PX / ppu, material: ROPE_MATERIAL, allowThin: true
  }
  const style: Style = {
    ...character.style,
    materials: { [ROPE_MATERIAL]: ROPE_RAMP, ...character.style.materials }
  }
  let previous: GBuffer | undefined
  const render = (frame: LiveFrame): Image => {
    const screenX = (p: Vec3): number => camera.width / 2 + dot(p, camera.right) * ppu
    const screenY = (p: Vec3): number => camera.baseline - dot(p, camera.up) * ppu
    const shift = add(
      scale(camera.right, (options.anchorAt[0] - screenX(frame.anchor)) / ppu),
      scale(camera.up, (screenY(frame.anchor) - options.anchorAt[1]) / ppu)
    )
    const joints: Record<string, Vec3> = {}
    for (const [name, p] of Object.entries(frame.joints)) joints[name] = add(p, shift)
    joints[ROPE_TOP] = add(frame.anchor, shift)
    joints[ROPE_END] = add(frame.hook, shift)
    const decals = mannequin.decals.map(d => ({ ...d, normal: apply(frame.rotation, d.normal) }))
    const posed: Mannequin = { ...mannequin, joints, parts: [...mannequin.parts, rope], decals }
    const g = rasterize(posed, camera, options.samples, previous)
    previous = g
    return stylize(g, posed, camera, style).image
  }
  return { camera, render }
}

export function frameHash (image: Image): string {
  let hash = 0x811c9dc5
  const bytes = image.data
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${image.width}x${image.height}:${hash.toString(16).padStart(8, '0')}`
}

export function pickHook (view: View, frame: LiveFrame, options: ViewOptions, px: number, py: number): Vec3 {
  const { camera } = view
  const ppu = camera.pixelsPerUnit
  const dx = (px - options.anchorAt[0]) / ppu
  const dy = (options.anchorAt[1] - py) / ppu
  const depth = dot(sub(frame.hook, frame.anchor), camera.forward)
  return add(frame.anchor, add(add(scale(camera.right, dx), scale(camera.up, dy)), scale(camera.forward, depth)))
}
