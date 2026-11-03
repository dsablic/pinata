export type StripSprite = { rows: string[], pivotA: [number, number], pivotB: [number, number] }

type Vec = [number, number]
type Quad = { from: Vec, to: Vec, edgeFrom: Vec, edgeTo: Vec, colFrom: number, colTo: number }

const EPSILON = 1e-9
const MITER_LIMIT = 2
const FLOOR_SHARE = 0.6
const CEILING_SHARE = 1.25

const cross = (a: Vec, b: Vec): number => a[0] * b[1] - a[1] * b[0]
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1]
const normal = (direction: Vec): Vec => [-direction[1], direction[0]]
const advance = (from: Vec, direction: Vec, length: number): Vec => {
  return [from[0] + direction[0] * length, from[1] + direction[1] * length]
}

export function lengthBounds (span: number): { floor: number, ceiling: number } {
  const floor = Math.round(FLOOR_SHARE * span)
  return { floor, ceiling: Math.max(floor, CEILING_SHARE * span) }
}

const gap = (a: Vec, b: Vec): number => Math.hypot(b[0] - a[0], b[1] - a[1])

function direction (from: Vec, to: Vec): Vec {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1])
  return [(to[0] - from[0]) / length, (to[1] - from[1]) / length]
}

function distinct (points: Vec[]): Vec[] {
  return points.filter((point, i) => i === 0 || point[0] !== points[i - 1][0] || point[1] !== points[i - 1][1])
}

function arcLength (points: Vec[]): number {
  return points.slice(1).reduce((sum, point, i) => sum + gap(points[i], point), 0)
}

function cutTo (points: Vec[], target: number): Vec[] {
  const kept: Vec[] = [points[0]]
  let travelled = 0
  for (let i = 1; i < points.length; i++) {
    const step = gap(points[i - 1], points[i])
    if (travelled + step >= target) {
      if (target > travelled) kept.push(advance(points[i - 1], direction(points[i - 1], points[i]), target - travelled))
      return kept
    }
    travelled += step
    kept.push(points[i])
  }
  return kept
}

function laidTo (points: Vec[], target: number): Vec[] {
  const length = arcLength(points)
  if (length > target) return cutTo(points, target)
  if (length === target) return points
  const end = points[points.length - 1]
  const heading: Vec = points.length > 1 ? direction(points[points.length - 2], end) : [1, 0]
  const kept = points.length > 1 ? points.slice(0, -1) : points
  return [...kept, advance(end, heading, target - length)]
}

function miter (before: Vec, after: Vec): Vec | undefined {
  const [nb, na] = [normal(before), normal(after)]
  const sum: Vec = [nb[0] + na[0], nb[1] + na[1]]
  const length = Math.hypot(sum[0], sum[1])
  if (length < EPSILON) return undefined
  const scale = Math.min(MITER_LIMIT, 2 / length)
  return [sum[0] / length * scale, sum[1] / length * scale]
}

function middleQuads (points: Vec[], headings: Vec[], pivot: number, span: number): Quad[] {
  const total = arcLength(points)
  let travelled = 0
  return headings.map((heading, i) => {
    const length = gap(points[i], points[i + 1])
    const own = normal(heading)
    const quad: Quad = {
      from: points[i],
      to: points[i + 1],
      edgeFrom: i === 0 ? own : miter(headings[i - 1], heading) ?? own,
      edgeTo: i === headings.length - 1 ? own : miter(heading, headings[i + 1]) ?? own,
      colFrom: pivot + travelled * span / total,
      colTo: pivot + (travelled + length) * span / total
    }
    travelled += length
    return quad
  })
}

function capQuad (from: Vec, to: Vec, heading: Vec, colFrom: number, colTo: number): Quad {
  const own = normal(heading)
  return { from, to, edgeFrom: own, edgeTo: own, colFrom, colTo }
}

function buildQuads (sprite: StripSprite, points: Vec[]): Quad[] {
  const { pivotA, pivotB } = sprite
  const width = sprite.rows[0].length
  const headings = points.slice(1).map((end, i) => direction(points[i], end))
  const first = headings[0] ?? [1, 0]
  const last = headings[headings.length - 1] ?? [1, 0]
  const start = points[0]
  const end = points[points.length - 1]
  return [
    capQuad(advance(start, first, -(pivotA[0] + 0.5)), start, first, -0.5, pivotA[0]),
    ...middleQuads(points, headings, pivotA[0], pivotB[0] - pivotA[0]),
    capQuad(end, advance(end, last, width - 0.5 - pivotB[0]), last, pivotB[0], width - 0.5)
  ]
}

function roots (a: number, b: number, c: number): number[] {
  if (Math.abs(a) < EPSILON) return Math.abs(b) < EPSILON ? [] : [-c / b]
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return []
  const root = Math.sqrt(discriminant)
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)]
}

function locate (quad: Quad, x: number, y: number, low: number, high: number): [number, number] | undefined {
  const q: Vec = [x - quad.from[0], y - quad.from[1]]
  const d: Vec = [quad.to[0] - quad.from[0], quad.to[1] - quad.from[1]]
  const e: Vec = [quad.edgeTo[0] - quad.edgeFrom[0], quad.edgeTo[1] - quad.edgeFrom[1]]
  const candidates = roots(cross(d, e), cross(d, quad.edgeFrom) - cross(q, e), -cross(q, quad.edgeFrom))
  for (const t of candidates) {
    if (t < -EPSILON || t > 1 + EPSILON) continue
    const edge: Vec = [quad.edgeFrom[0] + t * e[0], quad.edgeFrom[1] + t * e[1]]
    const across = dot([q[0] - t * d[0], q[1] - t * d[1]], edge) / dot(edge, edge)
    if (across >= low - EPSILON && across <= high + EPSILON) return [t, across]
  }
  return undefined
}

function corners (quad: Quad, low: number, high: number): Vec[] {
  return [low, high].flatMap(across => [
    [quad.from[0] + quad.edgeFrom[0] * across, quad.from[1] + quad.edgeFrom[1] * across] as Vec,
    [quad.to[0] + quad.edgeTo[0] * across, quad.to[1] + quad.edgeTo[1] * across] as Vec
  ])
}

export type Lay = { length?: number, heading?: [number, number] }

function laidPoints (points: Array<[number, number]>, heading?: [number, number]): Vec[] {
  const laid = distinct(points)
  if (laid.length === 1 && heading !== undefined && Math.hypot(...heading) > EPSILON) {
    laid.push(advance(laid[0], direction([0, 0], heading), 1))
  }
  return laid
}

export function endOf (points: Array<[number, number]>, length: number, heading?: [number, number]): [number, number] {
  const path = laidTo(laidPoints(points, heading), length)
  return path[path.length - 1]
}

export function paintStrip (
  sprite: StripSprite,
  points: Array<[number, number]>,
  plot: (x: number, y: number, cell: string) => void,
  { length, heading }: Lay = {}
): number {
  const height = sprite.rows.length
  const width = sprite.rows[0].length
  const pivotY = sprite.pivotA[1]
  const low = -pivotY - 0.5
  const high = height - 0.5 - pivotY
  const laid = laidPoints(points, heading)
  const { floor, ceiling } = lengthBounds(sprite.pivotB[0] - sprite.pivotA[0])
  const target = Math.min(ceiling, Math.max(floor, length ?? arcLength(laid)))
  const path = laidTo(laid, target)
  const quads = buildQuads(sprite, path)
  const boxes = quads.map(quad => corners(quad, low, high))
  const all = boxes.flat()
  const left = Math.floor(Math.min(...all.map(c => c[0])))
  const top = Math.floor(Math.min(...all.map(c => c[1])))
  const stride = Math.ceil(Math.max(...all.map(c => c[0]))) - left + 1
  const canvas: Array<string | undefined> = new Array(stride * (Math.ceil(Math.max(...all.map(c => c[1]))) - top + 1))
  quads.forEach((quad, i) => {
    const xs = boxes[i].map(c => c[0])
    const ys = boxes[i].map(c => c[1])
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
        const found = locate(quad, x, y, low, high)
        if (found === undefined) continue
        const column = Math.floor(quad.colFrom + found[0] * (quad.colTo - quad.colFrom) + 0.5)
        const row = Math.floor(found[1] + pivotY + 0.5)
        const cell = sprite.rows[Math.min(height - 1, Math.max(0, row))][Math.min(width - 1, Math.max(0, column))]
        if (cell !== '.') canvas[(y - top) * stride + x - left] = cell
      }
    }
  })
  canvas.forEach((cell, index) => {
    if (cell !== undefined) plot(left + index % stride, top + Math.floor(index / stride), cell)
  })
  return target
}
