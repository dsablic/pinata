import type { Mannequin } from '../formats/mannequin.ts'
import { legsOf } from '../formats/rig.ts'
import type { Leg, Rig } from '../formats/rig.ts'
import type { Style } from '../formats/style.ts'
import { createImage, setPixel } from '../image.ts'
import type { Image } from '../image.ts'
import type { Vec3 } from '../math/vec.ts'
import { plantedRuns, solePoints } from '../motion/metrics.ts'
import type { LocomotionRecording } from '../motion/metrics.ts'
import type { RootState } from '../motion/script.ts'
import { withClothParts } from '../sim/render.ts'
import type { ClothParts } from '../sim/render.ts'
import { fitCamera } from '../raster/camera.ts'
import type { Camera } from '../raster/camera.ts'
import { rasterize } from '../raster/gbuffer.ts'
import { stylize } from '../style/stylize.ts'
import { disc, line, ring } from './draw.ts'
import { sheet } from './images.ts'

export const LEFT_FOOT = 0x2c7bb6
export const RIGHT_FOOT = 0xd7191c
export const GROUND = 0x333333
const PATH = 0x000000
const BACKGROUND = 0xf7f7f7
const LEFT_OLD = 0xc6dbef
const RIGHT_OLD = 0xfcbba1
const MARGIN_PX = 12
const START_RADIUS = 5
const STRIP_MARGIN = 2

type Geometry = { rig: Rig, mannequin: Mannequin }

function blank (width: number, height: number): Image {
  const img = createImage(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) setPixel(img, x, y, BACKGROUND)
  }
  return img
}

function mix (from: number, to: number, t: number): number {
  const channel = (shift: number): number => {
    const a = (from >> shift) & 0xff
    const b = (to >> shift) & 0xff
    return Math.round(a + (b - a) * t)
  }
  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

export type FootprintOptions = Geometry & { size: number }

type Footprint = { side: string, heel: [number, number], toe: [number, number] }

function footprints (recording: LocomotionRecording, options: Geometry): Footprint[] {
  const { rig, mannequin } = options
  return plantedRuns(recording, { rig, mannequin }).map(run => {
    const leg = legsOf(rig)[run.leg]
    const sums = [[0, 0], [0, 0]]
    for (let i = run.start; i <= run.end; i++) {
      solePoints(recording.frames[i].joints, leg, mannequin).forEach((p, k) => {
        sums[k][0] += p[0]
        sums[k][1] += p[2]
      })
    }
    const n = run.end - run.start + 1
    return { side: run.side, heel: [sums[0][0] / n, sums[0][1] / n], toe: [sums[1][0] / n, sums[1][1] / n] }
  })
}

/**
 * View from above in the right-handed Y-up frame, the walker heading up the image: +x is on the left, +z up. Black
 * root path with a hollow circle at its start, and one heel-to-toe mark per planted foot run (left blue, right red).
 */
export function footprintTrace (recording: LocomotionRecording, options: FootprintOptions): Image {
  const { size } = options
  const prints = footprints(recording, options)
  const path = recording.frames.map((f): [number, number] => [f.root.position[0], f.root.position[2]])
  const points = [...path, ...prints.flatMap(p => [p.heel, p.toe])]
  const xs = points.map(p => p[0])
  const zs = points.map(p => p[1])
  const pad = 0.3
  const maxX = Math.max(...xs) + pad
  const minZ = Math.min(...zs) - pad
  const span = Math.max(maxX - (Math.min(...xs) - pad), Math.max(...zs) + pad - minZ)
  const scale = (size - 2 * MARGIN_PX) / span
  const toPixel = (p: [number, number]): [number, number] => {
    return [MARGIN_PX + (maxX - p[0]) * scale, size - MARGIN_PX - (p[1] - minZ) * scale]
  }
  const img = blank(size, size)
  const pixels = path.map(toPixel)
  for (let i = 1; i < pixels.length; i++) {
    line(img, pixels[i - 1][0], pixels[i - 1][1], pixels[i][0], pixels[i][1], PATH)
  }
  ring(img, pixels[0][0], pixels[0][1], START_RADIUS, PATH)
  for (const { side, heel, toe } of prints) {
    const rgb = side === 'left' ? LEFT_FOOT : RIGHT_FOOT
    const [hx, hy] = toPixel(heel)
    const [tx, ty] = toPixel(toe)
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) line(img, hx + dx, hy + dy, tx + dx, ty + dy, rgb)
    disc(img, hx, hy, 2.5, rgb)
  }
  return img
}

export type OnionOptions = Geometry & {
  width: number
  height: number
  from: number
  to: number
  every: number
  axis: 'x' | 'z'
}

/** Side view in world space of hip, knee, ankle and sole-point lines every Nth frame, older frames lighter. */
export function legOnionSkin (recording: LocomotionRecording, options: OnionOptions): Image {
  const { width, height, rig } = options
  const axis = options.axis === 'x' ? 0 : 2
  const shown: number[] = []
  for (let i = options.from; i < options.to; i += options.every) shown.push(i)
  shown.push(options.to)
  const chain = (i: number, leg: Leg): Array<[number, number]> => {
    const { joints } = recording.frames[i]
    const joint = (name: string): [number, number] => [joints[name][axis], joints[name][1]]
    const soles = solePoints(joints, leg, options.mannequin).map((p): [number, number] => [p[axis], p[1]])
    return [joint(leg.hip), joint(leg.knee), joint(leg.ankle), ...soles]
  }
  const all = shown.flatMap(i => legsOf(rig).flatMap(l => chain(i, l)))
  const minA = Math.min(...all.map(p => p[0]))
  const maxA = Math.max(...all.map(p => p[0]))
  const maxUp = Math.max(...all.map(p => p[1]))
  const scale = Math.min((width - 2 * MARGIN_PX) / Math.max(maxA - minA, 1e-6), (height - 2 * MARGIN_PX) / maxUp)
  const ground = height - MARGIN_PX
  const toPixel = (p: [number, number]): [number, number] => {
    return [width / 2 + (p[0] - (minA + maxA) / 2) * scale, ground - p[1] * scale]
  }
  const img = blank(width, height)
  line(img, 0, ground, width - 1, ground, GROUND)
  line(img, 0, ground + 1, width - 1, ground + 1, GROUND)
  shown.forEach((index, order) => {
    const t = shown.length === 1 ? 1 : order / (shown.length - 1)
    for (const leg of legsOf(rig)) {
      const rgb = leg.side === 'left' ? mix(LEFT_OLD, LEFT_FOOT, t) : mix(RIGHT_OLD, RIGHT_FOOT, t)
      const pixels = chain(index, leg).map(toPixel)
      for (let k = 1; k < pixels.length; k++) {
        line(img, pixels[k - 1][0], pixels[k - 1][1], pixels[k][0], pixels[k][1], rgb)
        line(img, pixels[k - 1][0] + 1, pixels[k - 1][1], pixels[k][0] + 1, pixels[k][1], rgb)
      }
    }
  })
  return img
}

export type StripOptions = {
  mannequin: Mannequin
  cloth?: (frame: number, origin: RootState) => ClothParts
  style: Style
  frames: number[]
  azimuthDeg: number
  elevationDeg: number
  targetHeightPx: number
  scale: number
  gap: number
}

function merged (cameras: Camera[]): Camera {
  const below = (c: Camera): number => c.height - c.baseline
  const baseline = Math.max(...cameras.map(c => c.baseline))
  return {
    ...cameras[0],
    width: Math.max(...cameras.map(c => c.width)),
    height: baseline + Math.max(...cameras.map(below)),
    baseline,
    rayDistance: Math.max(...cameras.map(c => c.rayDistance))
  }
}

/**
 * The chosen frames rendered with the P1 pipeline and laid side by side. One camera serves every cell, centred on
 * the root's horizontal position at the middle frame, so the character moves across the strip.
 */
export function pixelStrip (recording: LocomotionRecording, options: StripOptions): Image {
  const { mannequin, style, frames } = options
  const middle = recording.frames[frames[Math.floor(frames.length / 2)]].root.position
  const origin: Vec3 = [middle[0], 0, middle[2]]
  const view: RootState = { position: origin, yaw: 0, velocity: [0, 0, 0], angularVelocity: 0 }
  const posed = frames.map((i): Mannequin => {
    const joints = { ...mannequin.joints }
    for (const [name, p] of Object.entries(recording.frames[i].joints)) {
      joints[name] = [p[0] - origin[0], p[1], p[2] - origin[2]]
    }
    const body = { ...mannequin, joints }
    return options.cloth === undefined ? body : withClothParts(body, options.cloth(i, view))
  })
  const fit = {
    azimuthDeg: options.azimuthDeg,
    elevationDeg: options.elevationDeg,
    targetHeightPx: options.targetHeightPx,
    margin: STRIP_MARGIN
  }
  const camera = merged(posed.map(m => fitCamera(m, fit)))
  const cells = posed.map(m => {
    const { image } = stylize(rasterize(m, camera), m, camera, style)
    return { image, anchor: [0, 0] as [number, number] }
  })
  return sheet([cells], { scale: options.scale, gap: options.gap, background: BACKGROUND })
}
