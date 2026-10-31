import { setPixel } from '../image.ts'
import type { Image } from '../image.ts'
import type { Mannequin } from '../formats/mannequin.ts'
import type { Vec3 } from '../math/vec.ts'
import type { RootState } from '../motion/script.ts'
import { bodyCollider } from '../sim/body.ts'
import { swingAngles } from '../sim/metrics.ts'
import type { Frame, Recording, SwingOptions } from '../sim/metrics.ts'
import { disc, filledImage, line, mixColour, onionShare, plot } from './draw.ts'

const BACKGROUND = 0xf7f7f7
const BODY_NEW = 0x333333
const BODY_LOCAL = 0x444444
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

export function topDownTrace (recording: Recording, options: TopDownOptions): Image {
  const { frames } = recording
  const roots = frames.map(f => f.root.position)
  const hems = frames.map(f => hemCentroid(f, options.hem))
  const view = fit([...roots, ...hems].map(p => [p[0], p[2]]), options.size)
  const img = filledImage(options.size, options.size, BACKGROUND)
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
  const img = filledImage(options.size, options.size, BACKGROUND)
  const toPoint = (a: number, b: number, s: number): Vec3 => axis === 0 ? [a, -b, s] : [s, -b, a]
  shown.forEach((index, order) => {
    const t = onionShare(order, shown.length)
    const root = frames[index].root
    const depth = root.position[2 - axis]
    const collider = bodyCollider(options.body, options.exclude, root)
    fillBody(img, view, {
      distance: collider.distance,
      toPoint,
      depths: steps(depth - BODY_MARGIN, depth + BODY_MARGIN, 9),
      rgb: mixColour(BODY_OLD, BODY_NEW, t)
    })
  })
  shown.forEach((index, order) => {
    const t = onionShare(order, shown.length)
    const { positions } = frames[index]
    const rgb = mixColour(CAPE_OLD, CAPE_NEW, t)
    for (const { a, b } of recording.constraints) {
      const [x0, y0] = pixel(view, positions[3 * a + axis], -positions[3 * a + 1])
      const [x1, y1] = pixel(view, positions[3 * b + axis], -positions[3 * b + 1])
      line(img, x0, y0, x1, y1, rgb)
    }
  })
  return img
}

export type BodyFrameOptions = {
  size: number
  frames: number[]
  body: Mannequin
  exclude: string[]
  horizontal?: 'x' | 'z'
}

function toLocal (positions: Float64Array, root: RootState, horizontal: 'x' | 'z'): Array<[number, number]> {
  const c = Math.cos(root.yaw)
  const s = Math.sin(root.yaw)
  const local: Array<[number, number]> = []
  for (let p = 0; p < positions.length; p += 3) {
    const dx = positions[p] - root.position[0]
    const dz = positions[p + 2] - root.position[2]
    const across = horizontal === 'z' ? dx * s + dz * c : dx * c - dz * s
    local.push([across, -(positions[p + 1] - root.position[1])])
  }
  return local
}

export function bodyFrameOnionSkin (recording: Recording, options: BodyFrameOptions): Image {
  const { frames } = recording
  const horizontal = options.horizontal ?? 'z'
  const shown = options.frames.map(i => {
    return { index: i, local: toLocal(frames[i].positions, frames[i].root, horizontal) }
  })
  const view = fit([[0, 0], [0, -options.body.height], ...shown.flatMap(f => f.local)], options.size)
  const img = filledImage(options.size, options.size, BACKGROUND)
  const identity: RootState = { position: [0, 0, 0], yaw: 0, velocity: [0, 0, 0], angularVelocity: 0 }
  const collider = bodyCollider(options.body, options.exclude, identity)
  fillBody(img, view, {
    distance: collider.distance,
    toPoint: (a, b, s) => horizontal === 'z' ? [s, -b, a] : [a, -b, s],
    depths: steps(-BODY_MARGIN, BODY_MARGIN, 9),
    rgb: BODY_LOCAL
  })
  shown.forEach(({ local }, order) => {
    const t = onionShare(order, shown.length)
    const rgb = mixColour(CAPE_OLD, CAPE_NEW, t)
    for (const { a, b } of recording.constraints) {
      const [x0, y0] = pixel(view, local[a][0], local[a][1])
      const [x1, y1] = pixel(view, local[b][0], local[b][1])
      line(img, x0, y0, x1, y1, rgb)
      line(img, x0 + 1, y0, x1 + 1, y1, rgb)
      line(img, x0, y0 + 1, x1, y1 + 1, rgb)
    }
  })
  return img
}

export type AngleChartOptions = { width: number, height: number, swing: SwingOptions }

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
