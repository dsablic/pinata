import { getPixel, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import type { CharacterState, Sprite } from '../page/cast.ts'
import { FPS } from '../page/cast.ts'
import { readLayout } from '../page/fixture.ts'
import type { DrawnPart } from '../style/skins.ts'
import type { ReadWorld } from '../world/bundle.ts'
import { marksOf, run, scenario } from './page-scenarios.ts'
import type { Scenario } from './page-scenarios.ts'
import { flickerFrames, MIN_PART_PIXELS } from './stability.ts'

export type Layered = { width: number, height: number, owner: Int16Array, parts: DrawnPart[] }
export type Viewed = { parts: DrawnPart[], sector?: number }
export type Stress = { poke?: number, visitBelow?: number, pull?: number }
export type SurveyRun = { layout: string, seed?: number, wind?: number, seconds: number, stress?: Stress }
export type Kind = 'fragment' | 'pop' | 'stretch' | 'flicker' | 'blank'
export type Worst = { score: number, note: string, frames: Image[] }
export type Tally = {
  frames: number
  drops: number
  turns: number
  fragmentFrames: number
  pops: number
  stretchFrames: number
  blankFrames: number
  flicker: number[]
  worst: Record<Kind, Worst[]>
}
export type Pop = { part: string, from: number, back: number }

export const LONGEST = 1.25
export const SHORTEST = 0.6
export const POP_SHARE = 0.5
export const POP_FRAMES = 3
export const BLANK_SHARE = 0.5
export const WINDOW_SECONDS = 4
const TURN_SECONDS = 1.5
const TURN_RADIANS = Math.PI / 2
const ON_THE_SPOT = 0.3
const PULLED_SECONDS = 2
const KEPT_WORST = 6
const EIGHT: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]

export function fragmentPixels (frame: Layered): Map<string, number> {
  const { width, height, owner } = frame
  const inside = new Int32Array(owner.length)
  const found = new Map<string, number>()
  frame.parts.forEach((part, index) => {
    const footprint = part.footprint ?? []
    const mark = 2 * index + 1
    for (const at of footprint) inside[at] = mark
    const pieces: Array<{ size: number, seen: number }> = []
    for (const start of footprint) {
      if (inside[start] !== mark) continue
      const piece = { size: 0, seen: 0 }
      const queue = [start]
      inside[start] = mark + 1
      while (queue.length > 0) {
        const at = queue.pop() as number
        piece.size++
        if (owner[at] === index) piece.seen++
        const [x, y] = [at % width, Math.floor(at / width)]
        for (const [dx, dy] of EIGHT) {
          const [nx, ny] = [x + dx, y + dy]
          const near = ny * width + nx
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || inside[near] !== mark) continue
          inside[near] = mark + 1
          queue.push(near)
        }
      }
      pieces.push(piece)
    }
    const largest = pieces.reduce((a, b) => b.size > a.size ? b : a, { size: 0, seen: 0 })
    const stray = pieces.filter(p => p !== largest).reduce((sum, p) => sum + p.seen, 0)
    if (stray > 0) found.set(part.name, stray)
  })
  return found
}

export function fitOf (part: DrawnPart): number | undefined {
  return part.drawn > 0 && part.shown !== undefined ? part.shown / part.drawn : undefined
}

const fitKey = (part: DrawnPart, sector: number | undefined): string => `${part.name} ${sector ?? ''}`

export function usualFits (series: Viewed[]): Map<string, number> {
  const fits = new Map<string, number[]>()
  for (const { parts, sector } of series) {
    for (const part of parts) {
      const fit = fitOf(part)
      const key = fitKey(part, sector)
      if (fit !== undefined) fits.set(key, [...fits.get(key) ?? [], fit])
    }
  }
  return new Map([...fits].map(([key, all]) => [key, all.sort((a, b) => a - b)[all.length >> 1]]))
}

const outside = (ratio: number): boolean => ratio > LONGEST || ratio < SHORTEST

const outsideSprite = (part: DrawnPart, fit: number): boolean => {
  return fit > LONGEST || (part.shown ?? 0) < Math.round(SHORTEST * part.drawn)
}

function againstUsual (part: DrawnPart, sector: number | undefined, usual: Map<string, number>): number {
  const normal = usual.get(fitKey(part, sector))
  const fit = fitOf(part)
  return fit === undefined || normal === undefined || normal === 0 ? 1 : fit / normal
}

export function stretchOf (part: DrawnPart, sector: number | undefined, usual: Map<string, number>): number {
  const fit = fitOf(part)
  if (fit === undefined) return 1
  return outsideSprite(part, fit) ? fit : againstUsual(part, sector, usual)
}

export function stretched ({ parts, sector }: Viewed, usual: Map<string, number>): DrawnPart[] {
  return parts.filter(p => {
    const fit = fitOf(p)
    return fit !== undefined && (outsideSprite(p, fit) || outside(againstUsual(p, sector, usual)))
  })
}

export function pops (series: DrawnPart[][]): Pop[] {
  const painted = series.map(parts => new Map(parts.map(p => [p.name, p.painted])))
  const found: Pop[] = []
  const until = new Map<string, number>()
  for (let k = 1; k < painted.length; k++) {
    for (const [part, before] of painted[k - 1]) {
      const low = (i: number): boolean => (painted[i].get(part) ?? 0) < POP_SHARE * before
      if (before < MIN_PART_PIXELS || k < (until.get(part) ?? 0) || !low(k)) continue
      const back = painted.slice(k + 1, k + 1 + POP_FRAMES).findIndex((_, i) => !low(k + 1 + i))
      if (back < 0) continue
      found.push({ part, from: k, back: k + 1 + back })
      until.set(part, k + 1 + back)
    }
  }
  return found
}

export function silhouette (image: Image): number {
  let area = 0
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) if (getPixel(image, x, y) !== TRANSPARENT) area++
  }
  return area
}

function emptyTally (): Tally {
  const worst = { fragment: [], pop: [], stretch: [], flicker: [], blank: [] }
  const counts = { frames: 0, drops: 0, turns: 0, fragmentFrames: 0, pops: 0, stretchFrames: 0, blankFrames: 0 }
  return { ...counts, flicker: [], worst }
}

function remember (list: Worst[], worst: Worst): void {
  if (list.length === KEPT_WORST && worst.score <= list[KEPT_WORST - 1].score) return
  list.push(worst)
  list.sort((a, b) => b.score - a.score)
  list.length = Math.min(list.length, KEPT_WORST)
}

type Seen = { image: Image, parts: DrawnPart[], sector?: number, stray: Map<string, number> }
type Track = { seen: Seen[], yaws: number[], speeds: number[], falling?: boolean }
type Pulled = { at: number, last: number }
type Below = { key: string, from: number, to: number, height: number }

function below (s: Scenario, c: CharacterState<string>): Below[] {
  return s.cast.layout().flatMap(m => {
    const surface = s.cast.surfaceOf(m.key)
    if (surface === undefined || m.key === c.on) return []
    return -surface.height * s.fixture.pixelsPerMetre > c.y + 1 ? [{ key: m.key, ...surface }] : []
  })
}

function stressed (s: Scenario, stress: Stress, step: number, pulled: Pulled): void {
  const every = (seconds: number | undefined): boolean => {
    return seconds !== undefined && step > 0 && step % Math.round(seconds * FPS) === 0
  }
  if (pulled.at >= 0 && step === pulled.at + Math.round(PULLED_SECONDS * FPS)) {
    s.cast.setLayout(marksOf(s.fixture))
    pulled.at = -1
  }
  const everyone = s.cast.characters()
  const pick = everyone[Math.floor(step / FPS) % Math.max(1, everyone.length)]
  if (pick === undefined || pick.falling) return
  if (every(stress.poke)) s.cast.poke(pick.name)
  if (every(stress.visitBelow)) visitBelow(s, pick)
  const due = stress.pull !== undefined && step - pulled.last >= Math.round(stress.pull * FPS) && step % FPS === 0
  if (!due || pulled.at >= 0 || pick.on === undefined) return
  const x = pick.x / s.fixture.pixelsPerMetre
  if (!below(s, pick).some(b => b.from <= x && x <= b.to)) return
  s.cast.setLayout(marksOf(s.fixture, [pick.on]))
  pulled.at = step
  pulled.last = step
}

function visitBelow (s: Scenario, c: CharacterState<string>): void {
  for (const { key, from, to, height } of below(s, c)) {
    if (s.cast.interest({ key, place: { x: (from + to) / 2, height } })) return
  }
}

function countMotion (track: Track, tally: Tally, falling: boolean, yaw: number, speed: number): void {
  if (falling && track.falling === false) tally.drops++
  track.falling = falling
  track.yaws.push(yaw)
  track.speeds.push(speed)
  if (track.yaws.length > TURN_SECONDS * FPS) {
    track.yaws.shift()
    track.speeds.shift()
  }
  const turned = Math.abs(Math.atan2(Math.sin(yaw - track.yaws[0]), Math.cos(yaw - track.yaws[0])))
  const mean = track.speeds.reduce((a, b) => a + b, 0) / track.speeds.length
  if (turned > TURN_RADIANS && mean < ON_THE_SPOT) {
    tally.turns++
    track.yaws = []
    track.speeds = []
  }
}

function observe (track: Track, tally: Tally, s: Scenario, name: string): void {
  const moving = s.cast.moving().find(m => m.name === name)
  const sprite: Sprite | undefined = s.cast.drawables().find(d => d.name === name)?.sprite()
  if (moving === undefined || sprite === undefined) return
  const { falling, root } = moving.frame
  countMotion(track, tally, falling, root.yaw, Math.hypot(root.velocity[0], root.velocity[2]))
  const parts = sprite.parts ?? []
  const { width, height } = sprite.image
  const stray = sprite.owner === undefined ? new Map() : fragmentPixels({ width, height, owner: sprite.owner, parts })
  const kept = parts.map(({ footprint: _, ...rest }) => rest)
  const sector = sprite.sector === undefined ? {} : { sector: sprite.sector }
  track.seen.push({ image: sprite.image, parts: kept, stray, ...sector })
}

function judge (seen: Seen[], tally: Tally, where: string): void {
  const strip = (k: number, last = k + 1): Image[] => {
    return [seen[Math.max(0, k - 1)], seen[k], seen[Math.min(seen.length - 1, last)]].map(x => x.image)
  }
  const note = (k: number, text: string): string => `${where} frame ${k}: ${text}`
  const usual = usualFits(seen)
  const areas = seen.map(x => silhouette(x.image))
  const typical = [...areas].sort((a, b) => a - b)[areas.length >> 1] ?? 0
  seen.forEach((frame, k) => {
    tally.frames++
    if (frame.stray.size > 0) {
      tally.fragmentFrames++
      const text = [...frame.stray].map(([part, n]) => `${part} ${n} px`).join(', ')
      const score = Math.max(...frame.stray.values())
      remember(tally.worst.fragment, { score, note: note(k, text), frames: strip(k) })
    }
    const long = stretched(frame, usual)
    if (long.length > 0) {
      tally.stretchFrames++
      const by = (p: DrawnPart): number => stretchOf(p, frame.sector, usual)
      const score = Math.max(...long.map(p => Math.max(by(p), 1 / by(p))))
      const text = long.map(p => `${p.name} x${by(p).toFixed(2)}`).join(', ')
      remember(tally.worst.stretch, { score, note: note(k, text), frames: strip(k) })
    }
    if (areas[k] < BLANK_SHARE * typical) {
      tally.blankFrames++
      const text = `${areas[k]} of a usual ${typical} px`
      remember(tally.worst.blank, { score: 1 - areas[k] / typical, note: note(k, text), frames: strip(k) })
    }
  })
  for (const pop of pops(seen.map(frame => frame.parts))) {
    tally.pops++
    const worst = { score: pop.back - pop.from, note: note(pop.from, `${pop.part} back at ${pop.back}`) }
    remember(tally.worst.pop, { ...worst, frames: strip(pop.from, pop.back) })
  }
  const size = WINDOW_SECONDS * FPS
  for (let start = 0; start + size <= seen.length; start += size) {
    const each = flickerFrames(seen.slice(start, start + size).map(x => x.image))
    const score = Math.max(0, ...each)
    tally.flicker.push(score)
    const k = start + 1 + each.indexOf(score)
    remember(tally.worst.flicker, { score, note: note(k, `${(100 * score).toFixed(1)}%`), frames: strip(k) })
  }
}

export function survey (world: ReadWorld, runs: SurveyRun[], root: string): Map<string, Tally> {
  const tallies = new Map<string, Tally>(world.cast.map(m => [m.name, emptyTally()]))
  const names = world.cast.map(m => m.name)
  for (const r of runs) {
    const fixture = readLayout(root, r.layout)
    const s = scenario(world, fixture, r.seed ?? fixture.seed, r.wind ?? 0, true)
    const tracks = new Map<string, Track>(names.map(name => [name, { seen: [], yaws: [], speeds: [] }]))
    const pulled = { at: -1, last: 0 }
    run(s, r.seconds, step => {
      if (r.stress !== undefined) stressed(s, r.stress, step, pulled)
      for (const [name, track] of tracks) observe(track, tallies.get(name) as Tally, s, name)
    })
    const where = `${r.layout} seed ${r.seed ?? fixture.seed}${r.wind === undefined ? '' : ` wind ${r.wind}`}`
    for (const [name, track] of tracks) judge(track.seen, tallies.get(name) as Tally, where)
  }
  return new Map([...tallies].filter(([, t]) => t.frames > 0))
}

const STRESS: Stress = { poke: 4, visitBelow: 3, pull: 5 }

export const SURVEY: SurveyRun[] = [
  ...['page-test', 'perception', 'demo-1200', 'demo-390'].map(layout => ({ layout, seconds: 60 })),
  ...['page-test', 'demo-1200', 'demo-390'].flatMap(layout => [1, 2, 4].map(seed => ({
    layout, seed, seconds: 60, stress: STRESS
  }))),
  ...['page-test', 'demo-390'].map(layout => ({ layout, seed: 3, wind: 6, seconds: 60, stress: STRESS }))
]
