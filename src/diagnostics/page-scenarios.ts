import type { ReadWorld } from '../world/bundle.ts'
import { createCast, FPS, pageEnvironment } from '../page/cast.ts'
import type { Cast, CastOptions, CharacterState, Mark, Moving, Sample, Viewport } from '../page/cast.ts'
import type { LayoutFixture, Target } from '../page/fixture.ts'
import { jumpOf } from '../mocap/jump.ts'
import type { JumpKind, JumpReach } from '../mocap/jump.ts'
import { nodeAt, path, surfaceGraph } from '../page/graph.ts'
import { placeFor } from '../page/perception.ts'
import type { Ground } from '../page/surfaces.ts'
import { DROP_LIMIT, STEP_HEIGHT } from '../page/walker.ts'
import type { Place } from '../page/walker.ts'
import { add, dot, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { partsCollider, posedParts, toLocal } from '../sim/body.ts'
import { capeHemIndices } from '../sim/cloth.ts'
import type { CastMember } from '../world/world.ts'
import type { Scenario as ClothScenario } from '../formats/sim.ts'

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

export function scenario (
  world: ReadWorld, fixture: LayoutFixture, seed = fixture.seed, wind = 0, footprints = false,
  painter: CastOptions['painter'] = 'strip', jumps?: JumpKind
): Scenario {
  const { pixelsPerMetre, scale } = fixture
  const air = pageEnvironment(world.config, wind)
  const { cast: members, looks } = world
  const kind = jumps === undefined ? {} : { jumps }
  const options = {
    cast: members, looks, pixelsPerMetre, scale, seed, measure: true, footprints, painter, ...kind, ...air
  }
  const cast = createCast<string>(options)
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

export function jumpOfCast (world: ReadWorld, name: string): JumpReach {
  const member = world.cast.find(m => m.name === name)
  const database = member?.capture
  if (database === undefined) throw new Error(`${name} has no motion database`)
  return jumpOf(database.options.rig, database.options.rest)
}

export function canReach (
  ground: Ground, c: CharacterState<string>, place: Place, pixelsPerMetre: number, jump?: JumpReach
): boolean {
  if (c.falling) return false
  const reach = { step: STEP_HEIGHT, drop: DROP_LIMIT, body: TALLEST_BODY, ...(jump === undefined ? {} : { jump }) }
  const graph = surfaceGraph(ground, reach)
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

export type ClothMotion = {
  walkingSeconds: number
  hemRms: number
  hemTrail: number
  hemDownwind: number
  tipRms: number
  inside: number
  hemAhead: number
}

const WALKING_SPEED = 0.3
const HEM_AHEAD = 0.1
const STILL_SPEED = 0.05
const SETTLE_SECONDS = 1

function mean (points: Vec3[]): Vec3 {
  return points.reduce((a, p) => add(a, p), [0, 0, 0] as Vec3).map(v => v / Math.max(1, points.length)) as Vec3
}

function average (values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)
}

function rms (points: Vec3[]): number {
  const centre = mean(points)
  return Math.sqrt(points.reduce((sum, p) => sum + dot(sub(p, centre), sub(p, centre)), 0) / Math.max(1, points.length))
}

type Watch = {
  member: CastMember
  scenario: ClothScenario
  hem: number[]
  anchor: string | undefined
  walkingHem: Vec3[]
  stillHem: Vec3[]
  tips: Vec3[]
  facingEast: number[]
  facingWest: number[]
  sinceStart: number
  deepest: number
  hemFrames: number
  hemAhead: number
}

function watchOf (member: CastMember): Watch | undefined {
  const scenario = member.cloth?.scenario
  if (scenario === undefined) return undefined
  const hem = scenario.cape === undefined ? [] : capeHemIndices(scenario.cape)
  const anchor = scenario.chains.at(-1)?.anchor
  const lists = { walkingHem: [], stillHem: [], tips: [], facingEast: [], facingWest: [] }
  return { member, scenario, hem, anchor, ...lists, sinceStart: 0, deepest: 0, hemFrames: 0, hemAhead: 0 }
}

function observe (w: Watch, moving: Moving): void {
  const { frame, cloth } = moving
  if (cloth === undefined) return
  const at = (i: number): Vec3 => [cloth[3 * i], cloth[3 * i + 1], cloth[3 * i + 2]]
  w.sinceStart = frame.falling ? 0 : w.sinceStart + 1 / FPS
  const collider = partsCollider(posedParts(w.member.mannequin, w.scenario.bodyExcludeParts, frame.body), frame.root)
  for (let i = 0; i < cloth.length / 3; i++) w.deepest = Math.max(w.deepest, -collider.distance(at(i)))
  if (w.sinceStart <= SETTLE_SECONDS) return
  const pelvis = frame.joints[w.member.rig.pelvis]
  const local = (p: Vec3): Vec3 => toLocal(add(sub(p, pelvis), frame.root.position), frame.root)
  const { yaw, velocity } = frame.root
  const forward = Math.sin(yaw) * velocity[0] + Math.cos(yaw) * velocity[2]
  const walking = forward > WALKING_SPEED
  const still = Math.abs(forward) < STILL_SPEED
  if (w.hem.length > 0) {
    const middle = mean(w.hem.map(at))
    w.hemFrames++
    if (local(middle)[2] > HEM_AHEAD) w.hemAhead++
    if (walking) w.walkingHem.push(local(middle))
    if (still) {
      w.stillHem.push(local(middle))
      ;(Math.sin(yaw) > 0 ? w.facingEast : w.facingWest).push(middle[0] - pelvis[0])
    }
  }
  if (w.anchor !== undefined && walking) {
    w.tips.push(sub(local(at(cloth.length / 3 - 1)), local(frame.joints[w.anchor])))
  }
}

export function clothMotion (s: Scenario, world: ReadWorld, seconds: number): Record<string, ClothMotion> {
  const watches = new Map<string, Watch>()
  run(s, seconds, () => {
    for (const moving of s.cast.moving()) {
      if (!watches.has(moving.name)) {
        const member = world.cast.find(m => m.name === moving.name)
        const w = member === undefined ? undefined : watchOf(member)
        if (w !== undefined) watches.set(moving.name, w)
      }
      const w = watches.get(moving.name)
      if (w !== undefined) observe(w, moving)
    }
  })
  return Object.fromEntries([...watches].map(([name, w]) => [name, {
    walkingSeconds: Math.max(w.walkingHem.length, w.tips.length) / FPS,
    hemRms: rms(w.walkingHem),
    hemTrail: mean(w.stillHem)[2] - mean(w.walkingHem)[2],
    hemDownwind: (average(w.facingEast) + average(w.facingWest)) / 2,
    tipRms: rms(w.tips),
    inside: w.deepest,
    hemAhead: w.hemAhead / Math.max(1, w.hemFrames)
  }]))
}

export function withoutBindings (member: CastMember): CastMember {
  const cloth = member.cloth
  if (cloth === undefined) return member
  const { bind, ...rigid } = cloth.scenario
  return bind === undefined ? member : { ...member, cloth: { ...cloth, scenario: rigid } }
}
