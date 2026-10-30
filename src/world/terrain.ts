/**
 * A side-on walking surface: a profile of flat runs at different heights joined by ramps and stairs, along the x
 * axis. Heights are in metres; the walking direction is x, depth (z) does not change the height.
 */
export type Span =
  | { kind: 'flat', from: number, to: number, height: number }
  | { kind: 'ramp', from: number, to: number, start: number, end: number }
  | { kind: 'stairs', from: number, to: number, start: number, end: number, steps: number }
export type Terrain = { spans: Span[], from: number, to: number, ground: (x: number, z: number) => number }
export type TerrainOptions = {
  /** Length of the course, metres. */
  length: number
  /** Highest stair rise and steepest ramp the characters can manage. */
  maxRise: number
  maxSlopeDegrees: number
  /** Range of heights for flat runs. */
  maxHeight: number
  /** Shortest stair tread: at least the longest foot on the course, so a foot fits on one tread. */
  minTread?: number
  /** Heights of flat runs come in multiples of this (default half the largest rise). */
  heightStep?: number
}

/** A small, fast, seeded random generator (mulberry32): the same seed gives the same sequence everywhere. */
export function random (seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function heightIn (span: Span, x: number): number {
  if (span.kind === 'flat') return span.height
  if (x <= span.from) return span.start
  if (x >= span.to) return span.end
  const u = (x - span.from) / (span.to - span.from)
  if (span.kind === 'ramp') return span.start + (span.end - span.start) * u
  const step = Math.min(span.steps - 1, Math.floor(u * span.steps))
  const rise = (span.end - span.start) / span.steps
  return span.start + rise * (step + 1)
}

/** A terrain from explicit spans, which must be contiguous along x, each running forward with a positive length. */
export function terrainOf (spans: Span[]): Terrain {
  if (spans.length === 0) throw new Error('a terrain needs at least one span')
  spans.forEach((span, i) => {
    if (!(span.to > span.from)) throw new Error(`span ${i} must run forward along x with a positive length`)
    if (span.kind === 'stairs' && !(Number.isInteger(span.steps) && span.steps >= 1)) {
      throw new Error(`span ${i} needs a whole number of steps, at least 1`)
    }
    if (i > 0 && Math.abs(span.from - spans[i - 1].to) > 1e-9) {
      throw new Error(`span ${i} does not start where span ${i - 1} ends`)
    }
  })
  const from = spans[0].from
  const to = spans[spans.length - 1].to
  const ground = (x: number): number => {
    if (x <= from) return heightIn(spans[0], from - 1)
    if (x >= to) return heightIn(spans[spans.length - 1], to + 1)
    let lo = 0
    let hi = spans.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (spans[mid].to <= x) lo = mid + 1
      else hi = mid
    }
    return heightIn(spans[lo], x)
  }
  return { spans, from, to, ground: x => ground(x) }
}

const MIN_FLAT = 1.2
const MAX_FLAT = 3.5
const MIN_TREAD = 0.28
/** Longest flight of stairs; bigger height changes become ramps where ramps are allowed. */
const MAX_FLIGHT = 6

/**
 * A random course: flat runs at heights in [0, maxHeight] (whole multiples of heightStep), each joined to
 * the next by a ramp no steeper than maxSlopeDegrees or a flight of stairs whose rises do not exceed maxRise and whose
 * treads are at least minTread (default 0.28 m); flights longer than six steps become ramps. With no room for two
 * heights it is one flat run; with no slope allowed, transitions are stairs.
 */
export function generateTerrain (seed: number, options: TerrainOptions): Terrain {
  const next = random(seed)
  const spans: Span[] = []
  const quantum = options.heightStep ?? options.maxRise / 2
  const levels = quantum > 0 ? Math.floor(options.maxHeight / quantum + 1e-9) : 0
  const tread = Math.max(MIN_TREAD, options.minTread ?? 0)
  const ramps = options.maxSlopeDegrees > 0
  if (levels < 1) return terrainOf([{ kind: 'flat', from: 0, to: Math.max(options.length, 1e-6), height: 0 }])
  let x = 0
  let height = 0
  while (x < options.length) {
    const run = MIN_FLAT + (MAX_FLAT - MIN_FLAT) * next()
    spans.push({ kind: 'flat', from: x, to: x + run, height })
    x += run
    if (x >= options.length) break
    let target = height
    while (target === height) target = Math.floor(next() * (levels + 1)) * quantum
    const drop = target - height
    const steps = Math.ceil(Math.abs(drop) / options.maxRise - 1e-9)
    if (!ramps || (steps <= MAX_FLIGHT && next() < 0.5)) {
      const run = steps * (tread + 0.12 * next())
      spans.push({ kind: 'stairs', from: x, to: x + run, start: height, end: target, steps })
      x += run
    } else {
      const slope = Math.tan(options.maxSlopeDegrees * Math.PI / 180) * (0.6 + 0.4 * next())
      const run = Math.abs(drop) / slope
      spans.push({ kind: 'ramp', from: x, to: x + run, start: height, end: target })
      x += run
    }
    height = target
  }
  return terrainOf(spans)
}
