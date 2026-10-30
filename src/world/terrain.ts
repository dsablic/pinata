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
  const u = Math.min(1, Math.max(0, (x - span.from) / (span.to - span.from)))
  if (span.kind === 'ramp') return span.start + (span.end - span.start) * u
  const step = Math.min(span.steps - 1, Math.floor(u * span.steps))
  const rise = (span.end - span.start) / span.steps
  return span.start + rise * (step + 1)
}

/** A terrain from explicit spans, which must be contiguous along x. */
export function terrainOf (spans: Span[]): Terrain {
  for (let i = 1; i < spans.length; i++) {
    if (Math.abs(spans[i].from - spans[i - 1].to) > 1e-9) {
      throw new Error(`span ${i} does not start where span ${i - 1} ends`)
    }
  }
  const from = spans[0].from
  const to = spans[spans.length - 1].to
  const ground = (x: number): number => {
    if (x <= from) return heightIn(spans[0], from)
    if (x >= to) return heightIn(spans[spans.length - 1], to)
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

/**
 * A random course: flat runs at heights in [0, maxHeight], each joined to the next by a ramp no steeper than
 * maxSlopeDegrees or a flight of stairs whose rises do not exceed maxRise and whose treads are at least 0.28 m.
 */
export function generateTerrain (seed: number, options: TerrainOptions): Terrain {
  const next = random(seed)
  const spans: Span[] = []
  const quantum = options.maxRise / 2
  let x = 0
  let height = 0
  while (x < options.length) {
    const run = MIN_FLAT + (MAX_FLAT - MIN_FLAT) * next()
    spans.push({ kind: 'flat', from: x, to: x + run, height })
    x += run
    if (x >= options.length) break
    const levels = Math.round(options.maxHeight / quantum)
    let target = height
    while (target === height) target = Math.round(next() * levels) * quantum
    const drop = target - height
    if (next() < 0.5) {
      const steps = Math.ceil(Math.abs(drop) / options.maxRise)
      const run = steps * (MIN_TREAD + 0.12 * next())
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
