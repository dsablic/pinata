import type { Mannequin } from '../../src/formats/mannequin.ts'
import type { Style } from '../../src/formats/style.ts'
import { add, scale } from '../../src/math/vec.ts'
import type { Vec3 } from '../../src/math/vec.ts'
import type { LocomotionRecording } from '../../src/motion/metrics.ts'
import { fitCamera, unionCamera } from '../../src/raster/camera.ts'
import { rasterize } from '../../src/raster/gbuffer.ts'
import type { GBuffer } from '../../src/raster/gbuffer.ts'
import { toWorld } from '../../src/sim/body.ts'
import type { RootState } from '../../src/motion/script.ts'
import { stylize } from '../../src/style/stylize.ts'
import type { Image } from '../../src/image.ts'
import { outlineGaps } from '../../src/diagnostics/metrics.ts'

const MARGIN = 2

export type View = { azimuthDeg: number, elevationDeg: number, targetHeightPx: number }
type PartMap = Pick<GBuffer, 'width' | 'height' | 'part'>
export type Rendered = { images: Image[], parts: PartMap[], outlineGaps: number }
export type Offset = (k: number) => [number, number]

function yawRoot (yaw: number, position: Vec3 = [0, 0, 0]): RootState {
  return { position, yaw, velocity: [0, 0, 0], angularVelocity: 0 }
}

function turned (m: Mannequin, yaw: number): Mannequin {
  const root = yawRoot(yaw)
  const joints = Object.fromEntries(Object.entries(m.joints).map(([name, p]) => [name, toWorld(p, root)]))
  const decals = m.decals.map(d => ({ ...d, normal: toWorld(d.normal, root) }))
  return { ...m, joints, decals }
}

export function turntable (rest: Mannequin, frames: number, degreesPerFrame: number): Mannequin[] {
  return Array.from({ length: frames }, (_, k) => turned(rest, k * degreesPerFrame * Math.PI / 180))
}

export function walk (rest: Mannequin, recording: LocomotionRecording): Mannequin[] {
  const first = recording.frames[0].root.position
  const origin: Vec3 = [first[0], 0, first[2]]
  return recording.frames.map(frame => {
    const joints = { ...rest.joints }
    for (const [name, p] of Object.entries(frame.joints)) joints[name] = [p[0] - origin[0], p[1], p[2] - origin[2]]
    const decals = rest.decals.map(d => ({ ...d, normal: toWorld(d.normal, yawRoot(frame.root.yaw)) }))
    return { ...rest, joints, decals }
  })
}

export function shifted (frames: Mannequin[], view: View, offset: Offset): Mannequin[] {
  const camera = fitCamera(frames[0], { ...view, margin: MARGIN })
  return frames.map((m, k) => {
    const [dx, dy] = offset(k)
    const delta = add(scale(camera.right, dx / camera.pixelsPerUnit), scale(camera.up, -dy / camera.pixelsPerUnit))
    const joints = Object.fromEntries(Object.entries(m.joints).map(([name, p]) => [name, add(p, delta)]))
    return { ...m, joints }
  })
}

export function render (frames: Mannequin[], view: View, style: Style): Rendered {
  const fit = { ...view, margin: MARGIN }
  const camera = unionCamera(frames.map(m => fitCamera(m, fit)))
  const out: Rendered = { images: [], parts: [], outlineGaps: 0 }
  let previous: GBuffer | undefined
  for (const m of frames) {
    const g = rasterize(m, camera, undefined, previous)
    previous = g
    const { image, outlineMask } = stylize(g, m, camera, style)
    out.images.push(image)
    out.parts.push({ width: g.width, height: g.height, part: g.part })
    out.outlineGaps += outlineGaps(image, outlineMask)
  }
  return out
}
