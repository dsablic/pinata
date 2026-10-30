import { createImage, setPixel } from '../image.ts'
import type { Image } from '../image.ts'
import type { Mannequin } from '../formats/mannequin.ts'
import type { Vec3 } from '../math/vec.ts'
import type { RootState } from '../motion/script.ts'
import { bodyCollider } from '../sim/body.ts'
import { swingAngles } from '../sim/metrics.ts'
import type { Frame, Recording, SwingOptions } from '../sim/metrics.ts'
import { disc, line, plot } from './draw.ts'

const BACKGROUND = 0xf7f7f7
const BODY_NEW = 0x333333
const BODY_OLD = 0xd0d0d0
const CAPE_NEW = 0xd94801
const CAPE_OLD = 0xfdd0a2
const HEM_PATH = 0xe6550d
const FORWARD = 0xd7191c
const SIDEWAYS = 0x2c7bb6
const YAW = 0x444444
const BODY_MARGIN = 0.7
const CELL = 4

type View = { size: number, scale: number, offsetA: number, offsetB: number }

function blank (size: number): Image {
  const img = createImage(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) setPixel(img, x, y, BACKGROUND)
  }
  return img
}

function fit (points: Array<[number, number]>, size: number): View {
  const as = points.map(p => p[0])
  const bs = points.map(p => p[1])
  const minA = Math.min(...as) - BODY_MARGIN
  const maxA = Math.max(...as) + BODY_MARGIN
  const minB = Math.min(...bs) - BODY_MARGIN
  const maxB = Math.max(...bs) + BODY_MARGIN
  const scale = size * 0.92 / Math.max(maxA - minA, maxB - minB)
  return {
    size,
    scale,
    offsetA: size / 2 - scale * (minA + maxA) / 2,
    offsetB: size / 2 - scale * (minB + maxB) / 2
  }
}

function pixel (view: View, a: number, b: number): [number, number] {
  return [view.offsetA + a * view.scale, view.offsetB + b * view.scale]
}

function lerpColour (from: number, to: number, t: number): number {
  const channel = (shift: number): number => {
    const a = (from >> shift) & 0xff
    const b = (to >> shift) & 0xff
    return Math.round(a + (b - a) * t)
  }
  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

type MaskOptions = {
  distance: (p: Vec3) => number
  toPoint: (a: number, b: number, depth: number) => Vec3
  depths: number[]
  rgb: number
}

function fillBody (img: Image, view: View, options: MaskOptions): void {
  for (let py = 0; py < view.size; py += CELL) {
    for (let px = 0; px < view.size; px += CELL) {
      const a = (px + CELL / 2 - view.offsetA) / view.scale
      const b = (py + CELL / 2 - view.offsetB) / view.scale
      if (!options.depths.some(s => options.distance(options.toPoint(a, b, s)) <= 0)) continue
      for (let y = py; y < py + CELL; y++) {
        for (let x = px; x < px + CELL; x++) setPixel(img, x, y, options.rgb)
      }
    }
  }
}

function steps (from: number, to: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => from + (to - from) * (i + 0.5) / count)
}

function hemCentroid (frame: Frame, hem: number[]): Vec3 {
  const sum: Vec3 = [0, 0, 0]
  for (const i of hem) {
    for (let k = 0; k < 3; k++) sum[k] += frame.positions[3 * i + k] / hem.length
  }
  return sum
}

export type TopDownOptions = { size: number, hem: number[], body: Mannequin, exclude: string[] }

/** Top view (x right, z down): body footprint at the first and last frame, body path, and hem centroid path. */
export function topDownTrace (recording: Recording, options: TopDownOptions): Image {
  const { frames } = recording
  const roots = frames.map(f => f.root.position)
  const hems = frames.map(f => hemCentroid(f, options.hem))
  const view = fit([...roots, ...hems].map(p => [p[0], p[2]]), options.size)
  const img = blank(options.size)
  const heights = steps(0, options.body.height, 8)
  const footprint = (root: RootState, rgb: number): void => {
    const collider = bodyCollider(options.body, options.exclude, root)
    fillBody(img, view, { distance: collider.distance, toPoint: (a, b, s) => [a, s, b], depths: heights, rgb })
  }
  footprint(frames[0].root, BODY_OLD)
  footprint(frames[frames.length - 1].root, BODY_NEW)
  const path = (points: Vec3[], rgb: number): void => {
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = pixel(view, points[i - 1][0], points[i - 1][2])
      const [x1, y1] = pixel(view, points[i][0], points[i][2])
      line(img, x0, y0, x1, y1, rgb)
    }
  }
  path(hems, HEM_PATH)
  path(roots, 0x000000)
  const [sx, sy] = pixel(view, roots[0][0], roots[0][2])
  disc(img, sx, sy, 3, 0x000000)
  const [hx, hy] = pixel(view, hems[hems.length - 1][0], hems[hems.length - 1][2])
  disc(img, hx, hy, 3, HEM_PATH)
  return img
}

export type OnionOptions = {
  size: number
  every: number
  body: Mannequin
  exclude: string[]
  horizontal: 'x' | 'z'
}

/** Side view of every Nth frame (and the last): body silhouette and cape constraints, older frames lighter. */
export function sideOnionSkin (recording: Recording, options: OnionOptions): Image {
  const axis = options.horizontal === 'x' ? 0 : 2
  const { frames } = recording
  const shown = frames.map((_, i) => i).filter(i => i % options.every === 0)
  if (shown[shown.length - 1] !== frames.length - 1) shown.push(frames.length - 1)
  const points: Array<[number, number]> = []
  for (const i of shown) {
    points.push([frames[i].root.position[axis], 0], [frames[i].root.position[axis], -options.body.height])
    for (let p = 0; p < frames[i].positions.length; p += 3) {
      points.push([frames[i].positions[p + axis], -frames[i].positions[p + 1]])
    }
  }
  const view = fit(points, options.size)
  const img = blank(options.size)
  const toPoint = (a: number, b: number, s: number): Vec3 => axis === 0 ? [a, -b, s] : [s, -b, a]
  shown.forEach((index, order) => {
    const t = shown.length === 1 ? 1 : order / (shown.length - 1)
    const root = frames[index].root
    const depth = root.position[2 - axis]
    const collider = bodyCollider(options.body, options.exclude, root)
    fillBody(img, view, {
      distance: collider.distance,
      toPoint,
      depths: steps(depth - BODY_MARGIN, depth + BODY_MARGIN, 9),
      rgb: lerpColour(BODY_OLD, BODY_NEW, t)
    })
  })
  shown.forEach((index, order) => {
    const t = shown.length === 1 ? 1 : order / (shown.length - 1)
    const { positions } = frames[index]
    const rgb = lerpColour(CAPE_OLD, CAPE_NEW, t)
    for (const { a, b } of recording.constraints) {
      const [x0, y0] = pixel(view, positions[3 * a + axis], -positions[3 * a + 1])
      const [x1, y1] = pixel(view, positions[3 * b + axis], -positions[3 * b + 1])
      line(img, x0, y0, x1, y1, rgb)
    }
  })
  return img
}

export type AngleChartOptions = { width: number, height: number, swing: SwingOptions }

/** Forward swing (red), sideways swing (blue) and body yaw (grey) in degrees over frame index. */
export function angleChart (recording: Recording, options: AngleChartOptions): Image {
  const { forward, sideways } = swingAngles(recording, options.swing)
  const degrees = (values: number[]): number[] => values.map(v => v * 180 / Math.PI)
  const series = [
    { values: degrees(recording.frames.map(f => f.root.yaw)), rgb: YAW },
    { values: degrees(sideways), rgb: SIDEWAYS },
    { values: degrees(forward), rgb: FORWARD }
  ]
  const all = series.flatMap(s => s.values)
  const low = Math.min(...all)
  const high = Math.max(...all)
  const pad = Math.max(1, (high - low) * 0.05)
  return plot(series, { width: options.width, height: options.height, yMin: low - pad, yMax: high + pad })
}
