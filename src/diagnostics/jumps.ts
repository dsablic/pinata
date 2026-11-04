import { armsOf } from '../formats/rig.ts'
import { chainLength } from '../motion/pose.ts'
import type { Vec3 } from '../math/vec.ts'
import { length, sub } from '../math/vec.ts'
import { DEFAULT_JUMP_KIND, jumpOf, legLengthOf } from '../mocap/jump.ts'
import type { JumpTake, MotionDatabase } from '../mocap/database.ts'
import { FPS } from '../page/cast.ts'
import type { LayoutFixture } from '../page/fixture.ts'
import { nodeAt, path, surfaceGraph } from '../page/graph.ts'
import type { Graph } from '../page/graph.ts'
import type { Sample } from '../page/cast.ts'
import { run } from './page-scenarios.ts'
import type { Scenario } from './page-scenarios.ts'
import { groundOf, surfaceBelow } from '../page/surfaces.ts'
import type { Ground, Surface } from '../page/surfaces.ts'
import { createWalker, DROP_LIMIT, STEP_HEIGHT } from '../page/walker.ts'
import type { Place, WalkerFrame } from '../page/walker.ts'
import type { ReadWorld } from '../world/bundle.ts'
import { random } from '../world/terrain.ts'
import type { CastMember } from '../world/world.ts'

export type Jumping = { jumpTo: number | undefined, surface: number }
export type TripFrame = Jumping & { reached: boolean }
export type JumpCount = { planned: number, landed: number }
export type Crouch = { drop: number, wrist: number }
export type Tally = {
  trips: number
  arrived: number
  jumps: JumpCount
  climbs: number
  deepest: number
  crouches: Crouch[]
  strays: number
  takes: Record<string, number>
}
export type JumpRun = {
  name: string
  jumpHeight: number
  legLength: number
  armLength: number
  synthetic: Tally
  recorded: Tally
}
export type Played = { clip: string, jumpTo: number | undefined }
export type JumpPose = { jumpTo: number | undefined, falling: boolean, pelvis: number, wrists: Vec3[] }
export type JumpLayout = { name: string, ground: Ground, tops: Place[], floors: Place[] }

export const CLIMB_TOLERANCE = 0.02
export const SMALLEST_SHARE_LANDED = 0.95
export const FEWEST_TRIPS = 40
export const TOO_HIGH = 1.4
const STANDING_TOLERANCE = 0.01
const SEED = 1
const EAST = Math.PI / 2
const LAYOUT_SECONDS = 300
const TRIP_SECONDS = 30
const PAUSE_SECONDS = 1
const FLOOR_END = 14
const LEDGE_WIDTH = 2.4
const STEP_WIDTH = 1.5
const STEP_GAP = 0.6
const RISES = [0.2, 0.3, 0.4, 0.5]
const BODY = 2

type Ledge = [number, number, number]

export function countJumps (frames: Jumping[]): JumpCount {
  let planned = 0
  let landed = 0
  frames.forEach((frame, i) => {
    const before = i === 0 ? undefined : frames[i - 1].jumpTo
    if (frame.jumpTo !== undefined && before === undefined) planned++
    if (frame.jumpTo === undefined && before !== undefined && frame.surface === before) landed++
  })
  return { planned, landed }
}

export type TakeLandings = ReadonlyMap<string, number>

export function landingFrames (take: JumpTake, rate: number, fps: number): number {
  return Math.ceil((take.settle - take.land) * fps / (rate * take.fps)) + 1
}

export function strayTakeFrames (frames: Played[], landings: TakeLandings): number {
  let stray = 0
  let commanded = false
  let after = 0
  frames.forEach(({ clip, jumpTo }, i) => {
    const allowed = landings.get(clip)
    if (allowed === undefined) return
    if (landings.get(frames[i - 1]?.clip ?? '') === undefined) {
      commanded = jumpTo !== undefined
      after = 0
    }
    after = jumpTo === undefined ? after + 1 : 0
    if (!commanded || after > allowed) stray++
  })
  return stray
}

export function takesStarted (frames: Played[], takes: ReadonlySet<string>): Record<string, number> {
  const started: Record<string, number> = {}
  frames.forEach(({ clip }, i) => {
    if (takes.has(clip) && frames[i - 1]?.clip !== clip) started[clip] = (started[clip] ?? 0) + 1
  })
  return started
}

export function crouches (frames: JumpPose[]): Crouch[] {
  const found: Crouch[] = []
  let start = frames.findIndex(f => f.jumpTo !== undefined)
  while (start >= 0) {
    const end = frames.findIndex((f, i) => i > start && f.jumpTo === undefined)
    const jump = frames.slice(start, end < 0 ? frames.length : end)
    const liftOff = jump.findIndex(f => f.falling)
    if (liftOff > 0) {
      const before = jump.slice(0, liftOff)
      const lowest = before.reduce((a, b) => b.pelvis < a.pelvis ? b : a)
      const wrist = Math.max(0, ...jump.slice(jump.indexOf(lowest), liftOff + 1).flatMap(f => {
        return f.wrists.map((w, k) => length(sub(w, lowest.wrists[k])))
      }))
      found.push({ drop: -lowest.pelvis, wrist })
    }
    start = end < 0 ? -1 : frames.findIndex((f, i) => i > end && f.jumpTo !== undefined)
  }
  return found
}

export type CastJumps = { name: string, jumps: JumpCount }

const SETTLE_SECONDS = 5

function namesOf (samples: Sample[]): string[] {
  return [...new Set(samples.map(m => m.name))]
}

function resolvedEnd (own: Sample[], end: number): number {
  if (end === 0 || own[end - 1].jumpTo === undefined) return end
  const done = own.findIndex((s, i) => i >= end && s.jumpTo === undefined)
  return done < 0 ? own.length : done + 1
}

export function countCastJumps (samples: Sample[], ends: Map<string, number> = new Map()): CastJumps[] {
  return namesOf(samples).map(name => {
    const own = samples.filter(m => m.name === name)
    const end = ends.get(name)
    return { name, jumps: countJumps(end === undefined ? own : own.slice(0, resolvedEnd(own, end))) }
  })
}

export function totalJumps (counts: CastJumps[]): JumpCount {
  return {
    planned: counts.reduce((sum, c) => sum + c.jumps.planned, 0),
    landed: counts.reduce((sum, c) => sum + c.jumps.landed, 0)
  }
}

export type Settled = { samples: Sample[], ends: Map<string, number> }

export function runSettled (s: Scenario, seconds: number): Settled {
  run(s, seconds)
  const samples = s.cast.samples()
  const ends = new Map(namesOf(samples).map(name => [name, samples.filter(m => m.name === name).length]))
  const inFlight = (): boolean => {
    return namesOf(samples).some(name => samples.findLast(m => m.name === name)?.jumpTo !== undefined)
  }
  for (let i = 0; i < SETTLE_SECONDS * FPS && inFlight(); i++) {
    run(s, 1 / FPS)
    samples.push(...s.cast.samples())
  }
  return { samples, ends }
}

export function deepestInJump (samples: Sample[]): number {
  const depths = namesOf(samples).flatMap(name => {
    const own = samples.filter(m => m.name === name)
    return own.flatMap((frame, i) => {
      const near = [own[i - 1], frame, own[i + 1]].some(m => m?.jumpTo !== undefined)
      return near ? frame.feet.flatMap(f => f.gap === null ? [] : [-f.gap]) : []
    })
  })
  return Math.max(0, ...depths)
}

export function tripArrived (frames: TripFrame[], aim: number): boolean {
  const jumps = countJumps(frames)
  const end = frames.at(-1)
  return end !== undefined && end.reached && end.surface === aim && jumps.planned > 0 && jumps.landed === jumps.planned
}

export function climbs (frames: Array<{ base: number, support?: Surface | undefined }>, most: number): number {
  let count = 0
  let standing: number | undefined
  for (const frame of frames) {
    if (frame.support === undefined || Math.abs(frame.base - frame.support.height) > STANDING_TOLERANCE) continue
    if (standing !== undefined && frame.support.height - standing > most) count++
    standing = frame.support.height
  }
  return count
}

export function deepestSole (frame: WalkerFrame, ground: Ground): number {
  const gaps = frame.feet.flatMap(foot => foot.soles.map(([x, y]) => {
    const under = surfaceBelow(ground, x, y + STEP_HEIGHT, 0)
    return under === undefined ? 0 : y - under.height
  }))
  return Math.max(0, -Math.min(0, ...gaps))
}

function layoutOf (name: string, ledges: Ledge[], solid = true): JumpLayout {
  const list: Ledge[] = [[0, FLOOR_END, 0], ...ledges]
  const surfaces = list.map(([from, to, height], id) => ({ id, from, to, height }))
  const sides = ledges.flatMap(([from, to, top], i) => solid
    ? [from, to].map(x => ({ id: 100 + i, x, bottom: 0, top }))
    : [])
  const tops = ledges.map(([from, to, height]): Place => ({ x: (from + to) / 2, height }))
  const floors = [{ x: 1, height: 0 }, { x: FLOOR_END - 1, height: 0 }]
  return { name, ground: { surfaces, walls: sides }, tops, floors }
}

function stairs (rise: number): JumpLayout {
  const steps = [1, 2, 3].map((n, i): Ledge => {
    const from = 2 + i * (STEP_WIDTH + STEP_GAP)
    return [from, from + STEP_WIDTH, n * rise]
  })
  return layoutOf(`stairs of rise ${rise} m`, steps)
}

function ledges (): JumpLayout {
  const list = RISES.slice(1).map((rise, i): Ledge => [2 + i * 4, 2 + i * 4 + LEDGE_WIDTH, rise])
  return layoutOf('single ledges of rise 0.3, 0.4 and 0.5 m', list)
}

function tooHigh (): JumpLayout {
  const list: Ledge[] = [
    [2, 2 + LEDGE_WIDTH, RISES[1]],
    [6, 6 + LEDGE_WIDTH, TOO_HIGH],
    [10, 10 + LEDGE_WIDTH, RISES[3]]
  ]
  const shelf: Surface = { id: 4, from: 10.5, to: 10.5 + LEDGE_WIDTH, height: RISES[3] + TOO_HIGH }
  const base = layoutOf(`rises of ${TOO_HIGH} m, above the jump height`, list)
  const ground = { ...base.ground, surfaces: [...base.ground.surfaces, shelf] }
  return { ...base, ground, tops: [...base.tops, { x: shelf.from + LEDGE_WIDTH / 2, height: shelf.height }] }
}

export const JUMP_LAYOUTS: JumpLayout[] = [...RISES.map(stairs), ledges(), tooHigh()]

export function layoutOfFixture (fixture: LayoutFixture): JumpLayout {
  const boxes = fixture.marks.map((m, id) => ({ ...m.box, id }))
  const ground = groundOf(boxes, fixture.pixelsPerMetre)
  const lowest = Math.min(...ground.surfaces.map(s => s.height))
  const middle = (s: Surface): Place => ({ x: (s.from + s.to) / 2, height: s.height })
  const floors = ground.surfaces.filter(s => s.height === lowest).map(middle)
  const tops = ground.surfaces.filter(s => s.height > lowest).map(middle)
  return { name: fixture.name, ground, tops, floors }
}

function tally (): Tally {
  return {
    trips: 0, arrived: 0, jumps: { planned: 0, landed: 0 }, climbs: 0, deepest: 0, crouches: [], strays: 0, takes: {}
  }
}

function combine (a: Tally, b: Tally): Tally {
  return {
    trips: a.trips + b.trips,
    arrived: a.arrived + b.arrived,
    jumps: { planned: a.jumps.planned + b.jumps.planned, landed: a.jumps.landed + b.jumps.landed },
    climbs: a.climbs + b.climbs,
    deepest: Math.max(a.deepest, b.deepest),
    crouches: [...a.crouches, ...b.crouches],
    strays: a.strays + b.strays,
    takes: Object.fromEntries([...Object.keys(a.takes), ...Object.keys(b.takes)].map(name => {
      return [name, (a.takes[name] ?? 0) + (b.takes[name] ?? 0)]
    }))
  }
}

function poseOf (frame: WalkerFrame, database: MotionDatabase): JumpPose {
  const { rig, rest } = database.options
  const pelvis = frame.joints[rig.pelvis]
  const wrists = armsOf(rig).map(arm => frame.joints[arm.joints[Math.min(2, arm.joints.length - 1)]])
  return {
    jumpTo: frame.jumpTo,
    falling: frame.falling,
    pelvis: pelvis[1] - frame.base - rest[rig.pelvis][1],
    wrists: wrists.map(w => sub(w, pelvis))
  }
}

function runLayout (layout: JumpLayout, database: MotionDatabase): Tally {
  const { rig, rest } = database.options
  const jump = jumpOf(rig, rest)
  const reach = { step: STEP_HEIGHT, drop: DROP_LIMIT, body: BODY }
  const walking: Graph = surfaceGraph(layout.ground, reach)
  const jumping: Graph = surfaceGraph(layout.ground, { ...reach, jump })
  const needsJump = (from: Place, to: Place): boolean => {
    const a = nodeAt(jumping, from.x, from.height, STANDING_TOLERANCE)
    const b = nodeAt(jumping, to.x, to.height, STANDING_TOLERANCE)
    return a !== undefined && b !== undefined && path(walking, a.id, b.id) === undefined &&
      path(jumping, a.id, b.id) !== undefined
  }
  const walker = createWalker({
    database, fps: FPS, random: random(SEED), ground: layout.ground, place: layout.floors[0], yaw: EAST,
    jumps: DEFAULT_JUMP_KIND
  })
  const frames: WalkerFrame[] = []
  const clips: string[] = []
  const result = tally()
  const wait = (seconds: number, until: (f: WalkerFrame) => boolean): WalkerFrame[] => {
    const run: WalkerFrame[] = []
    for (let i = 0; i < seconds * FPS; i++) {
      const frame = walker.step()
      run.push(frame)
      clips.push(walker.clip())
      if (until(frame)) break
    }
    frames.push(...run)
    return run
  }
  const trip = (to: Place): void => {
    wait(TRIP_SECONDS, f => f.activity === 'rest' && !f.falling)
    const at = walker.frame()
    const from = { x: at.root.position[0], height: at.support?.height ?? NaN }
    const aim = surfaceBelow(layout.ground, to.x, to.height, 0)
    if (aim !== undefined && needsJump(from, to)) {
      result.trips++
      if (walker.visit(to)) {
        const run = wait(TRIP_SECONDS, f => f.activity === 'rest')
        const seen = run.map(f => ({ jumpTo: f.jumpTo, surface: f.support?.id ?? -1, reached: f.reached }))
        if (tripArrived(seen, aim.id)) result.arrived++
      }
    } else walker.visit(to)
    wait(PAUSE_SECONDS, () => false)
  }
  while (frames.length < LAYOUT_SECONDS * FPS) {
    layout.tops.forEach((top, i) => {
      trip(top)
      trip(layout.floors[i % layout.floors.length])
    })
  }
  const jumpFrames = frames.filter(f => f.jumpTo !== undefined)
  result.jumps = countJumps(frames.map(f => ({ jumpTo: f.jumpTo, surface: f.support?.id ?? -1 })))
  result.climbs = climbs(frames, jump.height + CLIMB_TOLERANCE)
  result.deepest = Math.max(0, ...jumpFrames.map(f => deepestSole(f, layout.ground)))
  const rate = database.options.style?.rate ?? 1
  const landings: TakeLandings = new Map(database.jumpTakes.map(t => [t.name, landingFrames(t, rate, FPS)]))
  const takes = new Set(landings.keys())
  const played = frames.map((f, i): Played => ({ clip: clips[i], jumpTo: f.jumpTo }))
  result.strays = strayTakeFrames(played, landings)
  result.takes = takesStarted(played, takes)
  result.crouches = crouches(frames.map(f => poseOf(f, database)))
  return result
}

function runOf (member: CastMember, recorded: LayoutFixture[]): JumpRun {
  const database = member.capture as MotionDatabase
  const sum = (layouts: JumpLayout[]): Tally => {
    return layouts.map(layout => runLayout(layout, database)).reduce(combine, tally())
  }
  const { rig, rest } = database.options
  return {
    name: member.name,
    jumpHeight: jumpOf(rig, rest).height,
    legLength: legLengthOf(rig, rest),
    armLength: Math.min(...armsOf(rig).map(arm => chainLength(arm.joints.slice(0, 3), rest))),
    synthetic: sum(JUMP_LAYOUTS),
    recorded: sum(recorded.map(layoutOfFixture))
  }
}

export function jumps (world: ReadWorld, recorded: LayoutFixture[]): JumpRun[] {
  const skinned = world.cast.filter((m, i) => m.capture !== undefined && world.looks[i].skin !== undefined)
  return skinned.map(member => runOf(member, recorded))
}
