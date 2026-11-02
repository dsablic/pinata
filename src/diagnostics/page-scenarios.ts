import type { ReadWorld } from '../world/bundle.ts'
import { createCast, FPS } from '../page/cast.ts'
import type { Cast, CharacterState, Mark, Sample, Viewport } from '../page/cast.ts'
import type { LayoutFixture, Target } from '../page/fixture.ts'
import { nodeAt, path, surfaceGraph } from '../page/graph.ts'
import { placeFor } from '../page/perception.ts'
import type { Ground } from '../page/surfaces.ts'
import { DROP_LIMIT, STEP_HEIGHT } from '../page/walker.ts'
import type { Place } from '../page/walker.ts'

export type Scenario = { fixture: LayoutFixture, cast: Cast<string>, viewport: Viewport }
export type Standing = { planted: number, off: number, worst: number, midAir: number, frames: number }
export type Falls = { falls: number, faults: string[] }

export const PLANTED_TOLERANCE_PX = 1
export const MID_AIR_PX = 3
export const LANDING_FRAMES = 3
const LONGEST_FALL_SECONDS = 4
const TALLEST_BODY = 2
const ON_NODE = 1e-3

export function marksOf (fixture: LayoutFixture, without: string[] = []): Array<Mark<string>> {
  return fixture.marks.filter(m => !without.includes(m.id)).map((m, id) => ({
    key: m.id, box: { ...m.box, id }, hints: m.hints
  }))
}

export function scenario (world: ReadWorld, fixture: LayoutFixture, seed = fixture.seed): Scenario {
  const { pixelsPerMetre, scale } = fixture
  const cast = createCast<string>({ cast: world.cast, looks: world.looks, pixelsPerMetre, scale, seed, measure: true })
  cast.setLayout(marksOf(fixture))
  return { fixture, cast, viewport: { top: 0, height: fixture.height } }
}

export { worldOf as readWorld } from '../world/bundle.ts'

export function run (s: Scenario, seconds: number, each?: (step: number) => void): void {
  for (let step = 0; step < Math.round(seconds * FPS); step++) {
    s.cast.advance(1 / FPS, s.viewport, true)
    each?.(step)
  }
}

export function placeOfTarget (s: Scenario, target: Target): Place | undefined {
  const own = target.ground === undefined ? undefined : s.cast.surfaceOf(target.ground)
  return placeFor(target.rect, own, s.cast.ground(), s.fixture.pixelsPerMetre)
}

export function canReach (ground: Ground, c: CharacterState<string>, place: Place, pixelsPerMetre: number): boolean {
  if (c.falling) return false
  const graph = surfaceGraph(ground, { step: STEP_HEIGHT, drop: DROP_LIMIT, body: TALLEST_BODY })
  const from = nodeAt(graph, c.x / pixelsPerMetre, -c.y / pixelsPerMetre, ON_NODE)
  const to = nodeAt(graph, place.x, place.height, ON_NODE)
  if (from === undefined || to === undefined) return false
  return from.id === to.id || path(graph, from.id, to.id) !== undefined
}

export function standing (samples: Sample[]): Standing {
  const planted = samples.flatMap(s => s.feet.filter(f => f.planted))
  const off = planted.filter(f => f.gap === null || Math.abs(f.gap) > PLANTED_TOLERANCE_PX)
  const midAir = samples.filter(s => !s.falling && s.feet.every(f => f.gap === null || f.gap > MID_AIR_PX))
  const worst = Math.max(0, ...planted.map(f => f.gap === null ? Infinity : Math.abs(f.gap)))
  return { planted: planted.length, off: off.length, worst, midAir: midAir.length, frames: samples.length }
}

export function falls (samples: Sample[]): Falls {
  let count = 0
  const faults: string[] = []
  for (const name of new Set(samples.map(s => s.name))) {
    const own = samples.filter(s => s.name === name)
    let fallingFor = 0
    own.forEach((s, i) => {
      fallingFor = s.falling ? fallingFor + 1 : 0
      if (fallingFor === LONGEST_FALL_SECONDS * FPS) faults.push(`${name}: falling for ${LONGEST_FALL_SECONDS} s`)
      const deepest = Math.min(...s.feet.map(f => f.gap ?? 0))
      if (deepest < -PLANTED_TOLERANCE_PX) faults.push(`${name} frame ${i}: a sole ${(-deepest).toFixed(1)} px under`)
      if (i === 0 || s.falling || !own[i - 1].falling) return
      count++
      const after = own.slice(i, i + LANDING_FRAMES)
      const down = after.some(a => a.feet.some(f => f.gap !== null && Math.abs(f.gap) <= PLANTED_TOLERANCE_PX))
      if (!down) faults.push(`${name} frame ${i}: no foot on the surface within ${LANDING_FRAMES} frames of landing`)
    })
  }
  return { falls: count, faults }
}
