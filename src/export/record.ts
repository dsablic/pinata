import { legsOf } from '../formats/rig.ts'
import { FIVE_VIEW_FORM } from '../formats/skin.ts'
import type { Skin } from '../formats/skin.ts'
import type { Leg } from '../formats/rig.ts'
import { createImage, getPixel, setPixel, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import type { Vec3 } from '../math/vec.ts'
import type { Gait, PerformanceKind } from '../mocap/clip.ts'
import type { MotionDatabase, PerformanceTake } from '../mocap/database.ts'
import { DEFAULT_JUMP_KIND, jumpOf } from '../mocap/jump.ts'
import type { JumpReach } from '../mocap/jump.ts'
import { wholeLapSpeed } from '../mocap/database.ts'
import { idleLayerOf } from '../mocap/idle.ts'
import { createPlayer } from '../mocap/player.ts'
import type { Player, PlayerFrame } from '../mocap/player.ts'
import { solePoints } from '../motion/pose.ts'
import type { Pose } from '../motion/pose.ts'
import { FPS, pageEnvironment, pageSecondary, raisedRoot } from '../page/cast.ts'
import type { CastOptions } from '../page/cast.ts'
import { clonePainting, freshPainting, paintSprite, spriteBox } from '../page/sprite.ts'
import type { Painting, Skinned, Sprite } from '../page/sprite.ts'
import { footNames, legFootParts } from '../style/feet.ts'
import { jointsOf } from '../page/walker.ts'
import { project } from '../raster/camera.ts'
import type { Camera } from '../raster/camera.ts'
import { DIRECTIONS, SPRITE_PER_METRE, yawOf } from './directions.ts'
import type { Direction } from './directions.ts'
import { closed, localPoint } from './closure.ts'
import { ratioOf, repeated, seamOf } from './loops.ts'
import type { Seam } from './loops.ts'
import type { ReadWorld } from '../world/bundle.ts'
import type { CastMember } from '../world/world.ts'
import { turnToWorld } from '../world/yaw.ts'

export type Behaviour = PerformanceKind | 'walk' | 'run' | 'turn' | 'jump'
export type Moment = { joints: Pose, curves: Record<string, Vec3[]>, position: Vec3, yaw: number, planted: boolean[] }
export type Span = { from: number, to: number }
export type Take = { frames: Moment[], from: number, to: number, loop: boolean }
export type Air = Pick<CastOptions, 'environment' | 'springSubsteps'>
export type Subject = { name: string, member: CastMember, look: Skinned, air: Air, idleLayer?: boolean }
export type Sole = { x: number, y: number }
export type Foot = { planted: boolean, sole: Sole | undefined, drawn: Sole | undefined, level: number }
export type Frame = { image: Image, sector: number | undefined, travel: [number, number], feet: Foot[] }
export type Track = { behaviour: Behaviour, direction: Direction, loop: boolean, frames: Frame[] }
export type Cell = { width: number, height: number, pivot: [number, number], root: [number, number] }
export type Recording = { name: string, cell: Cell, spritePerMetre: number, tracks: Track[] }

export const SKINNED_HUMANOIDS = ['knight', 'rogue', 'dwarf', 'wizard']
export const BEHAVIOURS: Behaviour[] = ['idle', 'walk', 'run', 'turn', 'jump', 'crouch', 'attack']

const EAST = Math.PI / 2
const TURN_ANGLE = Math.PI / 2
const CANVAS_ROOM = 0.5
const CELL_MARGIN = 1
const SETTLE_FRAMES = 48
const LEAD_FRAMES = 12
const COMPARED_FRAMES = 3
const SHORTER_LOOP_SLACK = 1.5
const PERIOD_SLACK = 1
const MOST_CANDIDATES = 40
const LAP_SHIFTS = [0, 1, -1, 2, -2, 3, -3]
const LAP_SPEED_SLACK = 0.12
const STILL_METRES = 0.002
const STILL_FRAMES = 6
const MOST_ONE_SHOT_FRAMES = 240
export type Looping = {
  warm: number
  window: number
  lengths: [number, number]
  speed: number
  candidates: number
  holding: boolean
}
type GaitLooping = Omit<Looping, 'speed'> & { gait: Gait }
const IDLE_WARM = 240
const GAIT = { warm: 144, candidates: MOST_CANDIDATES, holding: false }
const IDLE_PERIODS = 2
const LOOPS: Partial<Record<Behaviour, GaitLooping>> = {
  walk: { ...GAIT, window: 144, lengths: [12, 72], gait: 'walk' },
  run: { ...GAIT, window: 96, lengths: [8, 48], gait: 'run' }
}

export function withSkin (subject: Subject, skin: Skin): Subject {
  const { mannequin } = subject.look.skin
  return { ...subject, look: { ...subject.look, skin: { mannequin, skin } } }
}

export function subjectOf (world: ReadWorld, name: string): Subject {
  const i = world.cast.findIndex(member => member.name === name)
  const look = world.looks[i]
  if (i < 0) throw new Error(`${name} is not in the world`)
  if (look?.skin === undefined) throw new Error(`${name} has no skin.json: draw one (pinata skin guide) to record it`)
  if (look.skin.skin.views === undefined) {
    throw new Error(`${name}'s skin.json is the one-view form: export draws eight directions and needs the ` +
      `five-view form, ${FIVE_VIEW_FORM}`)
  }
  if (world.cast[i].capture === undefined) {
    throw new Error(`${name} has no retarget.json: add one (hang and style, see the guide) to record it`)
  }
  return { name, member: world.cast[i], look: look as Skinned, air: pageEnvironment(world.config) }
}

export type Stepper = { player: Player, step: () => Moment, played: () => PlayerFrame }

function standingJump (database: MotionDatabase): { run: number, reach: JumpReach } {
  const take = database.jumpTakes.reduce((best, t) => t.run > best.run ? t : best)
  const { rig, rest } = database.options
  return { run: take.run, reach: { ...jumpOf(rig, rest, DEFAULT_JUMP_KIND), clearance: take.apex } }
}

export function stepper (subject: Subject): Stepper {
  const { member } = subject
  const database = member.capture!
  const jump = standingJump(database).reach
  const settings = { database, fps: FPS, ground: () => 0, jump, idleLayer: subject.idleLayer !== false }
  const player = createPlayer(settings, { position: [0, 0, 0], yaw: EAST })
  const secondary = pageSecondary(member, subject.air)
  let count = 0
  let last: PlayerFrame | undefined
  const step = (): Moment => {
    count++
    last = player.step()
    const { root, pose, transforms, planted } = last
    const body: Pose = { ...database.options.rest, ...pose }
    const joints = jointsOf(body, root)
    const [raised, lowered] = raisedRoot({ base: player.height(), root, body })
    secondary.step(count, raised, joints, lowered, transforms)
    const position: Vec3 = [root.position[0], 0, root.position[2]]
    return { joints, curves: secondary.curves(), position, yaw: root.yaw, planted }
  }
  return { player, step, played: () => last as PlayerFrame }
}

function stepsOf (s: Stepper, count: number): Moment[] {
  return Array.from({ length: count }, s.step)
}

function wholeLocal (m: Moment): number[] {
  const local = (p: Vec3): Vec3 => localPoint(m, p)
  const joints = Object.keys(m.joints).sort().flatMap(name => local(m.joints[name]))
  const curves = Object.keys(m.curves).sort().flatMap(name => m.curves[name].flatMap(local))
  return [...joints, ...curves]
}

function distance (a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2
  return Math.sqrt(sum / a.length)
}

function samePhase (a: Moment, b: Moment): boolean {
  return a.planted.every((planted, k) => planted === b.planted[k])
}

type Candidate = { from: number, length: number, miss: number }

function candidatesOf (frames: Moment[], lengths: [number, number]): Candidate[] {
  const local = frames.map(wholeLocal)
  const found: Candidate[] = []
  for (let length = lengths[0]; length <= lengths[1]; length++) {
    for (let from = LEAD_FRAMES; from + length + COMPARED_FRAMES <= frames.length; from++) {
      let miss = 0
      let phased = true
      for (let k = 0; k < COMPARED_FRAMES; k++) {
        miss += distance(local[from + k], local[from + length + k]) / COMPARED_FRAMES
        phased = phased && samePhase(frames[from + k], frames[from + length + k])
      }
      if (phased) found.push({ from, length, miss })
    }
  }
  if (found.length === 0) throw new Error('no loop: no two frames share a stance phase')
  return found
}

function period (found: Candidate[]): number {
  const best = Math.min(...found.map(f => f.miss))
  const near = found.filter(f => f.miss <= best * SHORTER_LOOP_SLACK + 1e-9)
  return Math.min(...near.map(f => f.length))
}

type Scored = { c: Candidate, drawn: Frame[][], seams: Seam[] }
type Drawer = { whole: () => Frame[][], span: (frames: Moment[], span: Span) => Frame[][] }

function worstRatio (seams: Seam[]): number {
  return Math.max(...seams.map(ratioOf))
}

function seamsOf (drawn: Frame[][], holding: boolean): Seam[] {
  return drawn.map(own => seamOf(own.map(frame => frame.image), holding))
}

function passes ({ seams }: Pick<Scored, 'seams'>): boolean {
  return !seams.some(repeated) && worstRatio(seams) <= 1
}

function beats (a: Pick<Scored, 'seams'>, b: Pick<Scored, 'seams'>): boolean {
  const [repeatedA, repeatedB] = [a.seams.some(repeated), b.seams.some(repeated)]
  return repeatedA === repeatedB ? worstRatio(a.seams) < worstRatio(b.seams) : repeatedB
}

function closedScore (frames: Moment[], c: Candidate, drawer: Drawer, holding: boolean): Scored {
  const span = { from: c.from, to: c.from + c.length }
  const drawn = drawer.span(closed(frames, span), span)
  return { c, drawn, seams: seamsOf(drawn, holding) }
}

function openScore (raw: Frame[][], c: Candidate, holding: boolean): Scored {
  const drawn = raw.map(own => own.slice(c.from, c.from + c.length))
  return { c, drawn, seams: seamsOf(drawn, holding) }
}

function bestOf (scored: Scored[]): Scored {
  return scored.reduce((best, own) => beats(own, best) ? own : best)
}

export function loopOf (
  frames: Moment[],
  drawer: Drawer,
  { lengths, candidates, holding }: Pick<Looping, 'lengths' | 'candidates' | 'holding'>
): Frame[][] {
  const found = candidatesOf(frames, lengths)
  const base = period(found)
  const near = found.filter(f => Math.abs(f.length - base) <= PERIOD_SLACK)
    .sort((a, b) => a.miss - b.miss || a.from - b.from).slice(0, candidates)
  let best: Scored | undefined
  for (const c of near) {
    const own = closedScore(frames, c, drawer, holding)
    if (passes(own)) return own.drawn
    if (best === undefined || beats(own, best)) best = own
  }
  const raw = drawer.whole()
  const open = bestOf(near.map(c => openScore(raw, c, holding)))
  return (beats(open, best!) ? open : best!).drawn
}

function moved (a: Moment, b: Moment): boolean {
  const apart = (p: Vec3, q: Vec3): boolean => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > STILL_METRES
  const joints = Object.keys(a.joints).some(name => apart(a.joints[name], b.joints[name]))
  return joints || Object.keys(a.curves).some(name => a.curves[name].some((p, i) => apart(p, b.curves[name][i])))
}

function untilStill (s: Stepper, first: Moment): Moment[] {
  const frames = [first]
  let still = 0
  while (still < STILL_FRAMES && frames.length < MOST_ONE_SHOT_FRAMES) {
    const next = s.step()
    still = moved(frames[frames.length - 1], next) ? 0 : still + 1
    frames.push(next)
  }
  return frames.slice(0, frames.length - Math.max(0, still - 1))
}

function performanceOf (subject: Subject, kind: PerformanceKind): PerformanceTake {
  const take = subject.member.capture!.performances.find(own => own.kind === kind)
  if (take === undefined) throw new Error(`${subject.name}'s motion has no ${kind} take`)
  return take
}

function idleLooping (subject: Subject): Looping {
  const take = performanceOf(subject, 'idle')
  const rate = subject.member.capture!.options.style?.rate ?? 1
  const laps = subject.idleLayer === false ? 1 : idleLayerOf(take, rate).laps
  const period = Math.round(laps * (take.frames.length - 1) * FPS / (take.fps * rate))
  const window = IDLE_PERIODS * period + LEAD_FRAMES + COMPARED_FRAMES
  return { warm: IDLE_WARM, window, lengths: [period, period], speed: 0, candidates: window, holding: true }
}

export function loopingOf (subject: Subject, behaviour: Behaviour, shift = 0): Looping | undefined {
  if (behaviour === 'idle') return idleLooping(subject)
  const own = LOOPS[behaviour]
  if (own === undefined) return undefined
  const { gait, ...looping } = own
  return { ...looping, speed: wholeLapSpeed(subject.member.capture!, gait, FPS, shift) }
}

function lapShiftsOf (subject: Subject, behaviour: Behaviour): number[] {
  const nominal = loopingOf(subject, behaviour)
  if (nominal === undefined || LOOPS[behaviour] === undefined) return [0]
  return LAP_SHIFTS.filter(shift => {
    return Math.abs(loopingOf(subject, behaviour, shift)!.speed / nominal.speed - 1) <= LAP_SPEED_SLACK
  })
}

export function looping (s: Stepper, subject: Subject, behaviour: Behaviour, shift = 0): Take {
  const { warm, window, speed } = loopingOf(subject, behaviour, shift) as Looping
  s.player.command({ speed, heading: EAST })
  if (behaviour === 'idle') s.player.perform('idle')
  stepsOf(s, warm)
  const frames = stepsOf(s, window)
  return { frames, from: 0, to: frames.length, loop: true }
}

function oneShot (s: Stepper, start: () => void): Take {
  s.player.command({ speed: 0, heading: EAST })
  const lead = stepsOf(s, SETTLE_FRAMES).slice(-LEAD_FRAMES)
  start()
  const frames = untilStill(s, s.step())
  return { frames: [...lead, ...frames], from: lead.length, to: lead.length + frames.length, loop: false }
}

export function takeOf (subject: Subject, behaviour: Behaviour, shift = 0): Take {
  const s = stepper(subject)
  if (loopingOf(subject, behaviour) !== undefined) return looping(s, subject, behaviour, shift)
  if (behaviour === 'turn') return oneShot(s, () => s.player.command({ speed: 0, heading: EAST + TURN_ANGLE }))
  if (behaviour === 'crouch' || behaviour === 'attack') {
    performanceOf(subject, behaviour)
    return oneShot(s, () => { s.player.perform(behaviour) })
  }
  return oneShot(s, () => {
    const { run } = standingJump(subject.member.capture!)
    if (!s.player.jump({ x: run, height: 0 })) throw new Error(`${subject.name} cannot jump ${run.toFixed(2)} m`)
  })
}

function turned (m: Moment, by: number): Moment {
  const [x, , z] = m.position
  const about = (p: Vec3): Vec3 => {
    const r = turnToWorld([p[0] - x, p[1], p[2] - z], by)
    return [x + r[0], r[1], z + r[2]]
  }
  const joints = Object.fromEntries(Object.entries(m.joints).map(([name, p]) => [name, about(p)]))
  const curves = Object.fromEntries(Object.entries(m.curves).map(([name, points]) => [name, points.map(about)]))
  return { ...m, joints, curves, yaw: m.yaw + by }
}

export function footParts (subject: Subject, leg: Leg): string[] {
  return legFootParts(subject.member.mannequin, leg)
}

function lowestOf (pixels: Iterable<number>, box: Camera): Sole | undefined {
  let lowest = -1
  let sum = 0
  let count = 0
  for (const i of pixels) {
    const y = Math.floor(i / box.width)
    if (y > lowest) {
      lowest = y
      sum = 0
      count = 0
    }
    if (y === lowest) {
      sum += i % box.width + 0.5
      count++
    }
  }
  return count === 0 ? undefined : { x: sum / count - box.width / 2, y: lowest - box.baseline }
}

function partIndices (sprite: Sprite, names: string[]): Set<number> {
  return new Set((sprite.parts ?? []).flatMap((part, i) => names.includes(part.name) ? [i] : []))
}

function visiblePixels (sprite: Sprite, names: string[]): number[] {
  const mine = partIndices(sprite, names)
  const found: number[] = []
  sprite.owner?.forEach((owner, i) => {
    if (mine.has(owner)) found.push(i)
  })
  return found
}

function footprintPixels (sprite: Sprite, names: string[]): number[] {
  return (sprite.parts ?? []).filter(part => names.includes(part.name)).flatMap(part => part.footprint ?? [])
}

function screenRow (box: Camera, m: Moment, point: Vec3): number {
  return project(box, [point[0] - m.position[0], point[1] - m.position[1], point[2] - m.position[2]]).y
}

function groundRow (subject: Subject, m: Moment, leg: Leg, box: Camera): number {
  const { mannequin } = subject.member
  return Math.max(...solePoints(m.joints, leg, mannequin).map(point => screenRow(box, m, point))) - box.baseline
}

function feetOf (subject: Subject, m: Moment, sprite: Sprite, box: Camera): Foot[] {
  return legsOf(subject.member.rig).map((leg, k) => {
    const names = footParts(subject, leg)
    return {
      planted: m.planted[k] ?? false,
      sole: lowestOf(visiblePixels(sprite, names), box),
      drawn: lowestOf(footprintPixels(sprite, names), box),
      level: groundRow(subject, m, leg, box)
    }
  })
}

function travelOf (box: Camera, from: Vec3, to: Vec3, by: number): [number, number] {
  const there = turnToWorld([to[0] - from[0], 0, to[2] - from[2]], by)
  const at = project(box, there)
  const origin = project(box, [0, 0, 0])
  return [at.x - origin.x, at.y - origin.y]
}

function drawFrame (
  subject: Subject, frames: Moment[], k: number, direction: Direction, box: Camera, painting: Painting,
  grounded: boolean
): Frame {
  const by = yawOf(direction) - EAST
  const m = turned(frames[k], by)
  const placed = { joints: m.joints, curves: m.curves, anchor: m.position, yaw: m.yaw }
  const feet = footNames(subject.member.mannequin, subject.member.rig)
  const sprite = paintSprite(subject.look, painting, box, placed, { painter: 'strip', footprints: grounded, feet })
  const travel = k === 0 ? [0, 0] as [number, number] : travelOf(box, frames[k - 1].position, m.position, by)
  return { image: sprite.image, sector: sprite.sector, travel, feet: feetOf(subject, m, sprite, box) }
}

export function drawTake (
  subject: Subject, frames: Moment[], direction: Direction, box: Camera, grounded = false
): Frame[] {
  const painting = freshPainting()
  return frames.map((_, k) => drawFrame(subject, frames, k, direction, box, painting, grounded))
}

function drawerOf (subject: Subject, frames: Moment[], box: Camera, grounded: boolean): Drawer {
  const lanes = DIRECTIONS.map(direction => {
    const painting = freshPainting()
    return { direction, painting, before: [clonePainting(painting)] }
  })
  const paintingBefore = (lane: typeof lanes[number], k: number): Painting => {
    while (lane.before.length <= k) {
      drawFrame(subject, frames, lane.before.length - 1, lane.direction, box, lane.painting, grounded)
      lane.before.push(clonePainting(lane.painting))
    }
    return clonePainting(lane.before[k])
  }
  return {
    whole: () => DIRECTIONS.map(direction => drawTake(subject, frames, direction, box, grounded)),
    span: (shut, { from, to }) => lanes.map(lane => {
      const painting = paintingBefore(lane, from)
      const span = Array.from({ length: to - from }, (_, k) => from + k)
      return span.map(k => drawFrame(subject, shut, k, lane.direction, box, painting, grounded))
    })
  }
}

export function canvasOf (subject: Subject): Camera {
  const box = spriteBox(subject.look, SPRITE_PER_METRE)
  const room = Math.ceil(box.width * CANVAS_ROOM)
  const width = box.width + 2 * room
  return { ...box, width: width + (width % 2), height: box.height + 2 * room, baseline: box.baseline + room }
}

function extent (tracks: Track[], canvas: Camera): { left: number, right: number, top: number, bottom: number } {
  const pivot = canvas.width / 2
  const found = { left: 0, right: 0, top: 0, bottom: 0 }
  for (const { frames } of tracks) {
    for (const { image } of frames) {
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          if (getPixel(image, x, y) === TRANSPARENT) continue
          found.left = Math.max(found.left, pivot - x)
          found.right = Math.max(found.right, x + 1 - pivot)
          found.top = Math.max(found.top, canvas.baseline - y)
          found.bottom = Math.max(found.bottom, y + 1 - canvas.baseline)
        }
      }
    }
  }
  return found
}

function cropped (image: Image, x0: number, y0: number, width: number, height: number): Image {
  const out = createImage(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) setPixel(out, x, y, getPixel(image, x0 + x, y0 + y))
  }
  return out
}

function fitted (tracks: Track[], canvas: Camera): { tracks: Track[], cell: Cell } {
  const { left, right, top, bottom } = extent(tracks, canvas)
  const half = Math.max(left, right) + CELL_MARGIN
  const above = top + CELL_MARGIN
  const x0 = canvas.width / 2 - half
  const y0 = canvas.baseline - above
  const at = project(canvas, [0, 0, 0])
  const cell: Cell = {
    width: 2 * half, height: above + bottom + CELL_MARGIN, pivot: [half, above], root: [at.x - x0, at.y - y0]
  }
  const own = tracks.map(track => ({
    ...track,
    frames: track.frames.map(frame => ({ ...frame, image: cropped(frame.image, x0, y0, cell.width, cell.height) }))
  }))
  return { tracks: own, cell }
}

type Drawn = { take: Take, drawn: Frame[][], seams: Seam[] }

function drawnAt (subject: Subject, behaviour: Behaviour, canvas: Camera, shift: number): Drawn {
  const take = takeOf(subject, behaviour, shift)
  const drawer = drawerOf(subject, take.frames, canvas, behaviour === 'idle')
  const looped = loopingOf(subject, behaviour, shift)
  if (looped === undefined) return { take, drawn: drawer.whole().map(own => own.slice(take.from, take.to)), seams: [] }
  const drawn = loopOf(take.frames, drawer, looped)
  return { take, drawn, seams: seamsOf(drawn, looped.holding) }
}

function drawnBest (subject: Subject, behaviour: Behaviour, canvas: Camera): Drawn {
  let best: Drawn | undefined
  for (const shift of lapShiftsOf(subject, behaviour)) {
    const own = drawnAt(subject, behaviour, canvas, shift)
    if (passes(own)) return own
    if (best === undefined || beats(own, best)) best = own
  }
  return best!
}

export function record (subject: Subject, behaviours: Behaviour[] = BEHAVIOURS): Recording {
  const canvas = canvasOf(subject)
  const tracks = behaviours.flatMap(behaviour => {
    const { take, drawn } = drawnBest(subject, behaviour, canvas)
    return DIRECTIONS.map((direction, d): Track => ({ behaviour, direction, loop: take.loop, frames: drawn[d] }))
  })
  const { cell, tracks: own } = fitted(tracks, canvas)
  return { name: subject.name, cell, spritePerMetre: SPRITE_PER_METRE, tracks: own }
}
