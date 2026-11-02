import type { Vec3 } from '../math/vec.ts'
import type { CastMember } from '../world/world.ts'
import type { Look } from '../world/render.ts'
import { random } from '../world/terrain.ts'
import type { MotionDatabase } from '../mocap/database.ts'
import type { Pose } from '../motion/pose.ts'
import type { RootState } from '../motion/script.ts'
import { makeCamera } from '../raster/camera.ts'
import type { Camera } from '../raster/camera.ts'
import { renderSkinned } from '../style/skins.ts'
import type { Image } from '../image.ts'
import type { Hints } from './dom.ts'
import { surfaceGraph } from './graph.ts'
import type { Node } from './graph.ts'
import { groundOf, surfaceBelow } from './surfaces.ts'
import type { Box, Ground, Surface } from './surfaces.ts'
import { createWalker, DROP_LIMIT, STEP_HEIGHT } from './walker.ts'
import type { Activity, Place, Walker, WalkerFrame } from './walker.ts'
import { createSecondary } from '../motion/secondary.ts'
import type { Secondary, SecondaryEnvironment } from '../motion/secondary.ts'
import type { WorldConfig } from '../world/config.ts'
import type { System } from '../sim/cloth.ts'

export type Mark<K> = { key: K, box: Box, hints: Hints }
export type Viewport = { top: number, height: number }
export type Interest<K> = { key: K, place: Place, say?: string }
export type CastOptions = {
  cast: CastMember[]
  looks: Look[]
  environment: SecondaryEnvironment
  springSubsteps: number
  pixelsPerMetre: number
  scale: number
  seed: number
  count?: number
  measure?: boolean
}
export type Sprite = { image: Image, camera: Camera }
export type Drawable = { name: string, x: number, y: number, sprite: () => Sprite, saying?: string }
export type Moving = {
  name: string
  frame: WalkerFrame
  cloth: Float64Array | undefined
  system: System | undefined
  curves: Record<string, Vec3[]>
}
export type CharacterState<K> = {
  name: string
  x: number
  y: number
  surface: number
  yaw: number
  heading: number
  falling: boolean
  on: K | undefined
  lowestSole: number
  activity: string
  started: number
  elements: number
  saying: string
  placedAgain: number
}
export type FootSample = { planted: boolean, gap: number | null }
export type Sample = { name: string, falling: boolean, feet: FootSample[] }
export type Visit<K> = { name: string, key: K, say?: string }
export type Advance = { stepped: boolean, changed: boolean }
export type Cast<K> = {
  setLayout: (marks: Array<Mark<K>>) => void
  advance: (seconds: number, viewport: Viewport, moving: boolean) => Advance
  interest: (interest: Interest<K>) => boolean
  poke: (name: string) => void
  surfaceOf: (key: K) => Surface | undefined
  ground: () => Ground
  layout: () => Array<Mark<K>>
  drawables: () => Drawable[]
  moving: () => Moving[]
  characters: () => Array<CharacterState<K>>
  samples: () => Sample[]
  visits: () => Array<Visit<K>>
}

type Skinned = Look & { skin: NonNullable<Look['skin']> }
type Standing<K> = { key: K, from: number, height: number }
type Saying = { text: string, until: number }
type Character<K> = {
  name: string
  look: Skinned
  database: MotionDatabase
  walker?: Walker
  secondary: Secondary
  cloth?: Float64Array
  on?: Standing<K>
  visited: Set<K>
  sameSince: number
  placedAgain: number
  steps: number
  ticks: number
  activity?: Activity
  interest?: string
  saying?: Saying
  view: { sector?: number }
  angles: Map<string, number>
  lengths: Map<string, number>
  anchors: Map<string, [number, number]>
  sprite?: Sprite & { frame: WalkerFrame }
}

export const FPS = 24
export const MOST_STEPS_PER_FRAME = 3
const CAMERA_ELEVATION_DEGREES = 8
const SPRITE_BOX_IN_CHARACTER_HEIGHTS = 1.6
const FEET_LINE_SHARE_OF_BOX = 0.85
const MARGIN_FROM_SURFACE_ENDS = 0.3
const MOVED = 1e-3
const KEPT_SAMPLES = 8000
const KEPT_VISITS = 100
const SAYING_SECONDS = 2.5
const STALE_SECONDS = 30
const LEAST_DROP_IN = 2.5
const ABOVE_VIEWPORT = 1
const DROP_IN_TRIES = 8
const PAGE_CLOTH = {
  collisionPasses: 2, settlePasses: 8, settleOnStart: true, fabric: { drag: 6, damping: 0.2, bend: 300 }
}

export function pageEnvironment (config: WorldConfig, wind = 0): Pick<CastOptions, 'environment' | 'springSubsteps'> {
  const { environment, motion } = config
  return {
    environment: {
      ...environment,
      wind: { ...environment.wind, speed: wind, gust: wind === 0 ? 0 : environment.wind.gust }
    },
    springSubsteps: motion.springSubsteps
  }
}

function raisedRoot (frame: WalkerFrame): [RootState, Pose] {
  const lift = frame.base - frame.root.position[1]
  const [x, y, z] = frame.root.position
  const body: Pose = {}
  for (const [name, p] of Object.entries(frame.body)) body[name] = [p[0], p[1] - lift, p[2]]
  return [{ ...frame.root, position: [x, y + lift, z] }, body]
}

export function keep<T> (list: T[], most: number): void {
  if (list.length > most) list.splice(0, list.length - most)
}

export function anchorHeight (frame: WalkerFrame): number {
  const under = frame.support
  if (frame.falling || under === undefined || frame.base - under.height > STEP_HEIGHT) return frame.base
  return under.height
}

export function spriteReach (pixelsPerMetre: number): number {
  return SPRITE_BOX_IN_CHARACTER_HEIGHTS * 2 * pixelsPerMetre
}

export function createCast<K> (options: CastOptions): Cast<K> {
  const { cast, looks, pixelsPerMetre } = options
  const next = random(options.seed)
  const spritePerMetre = pixelsPerMetre / options.scale
  const camera = makeCamera({
    azimuthDeg: 0, elevationDeg: CAMERA_ELEVATION_DEGREES, targetHeightPx: spritePerMetre, modelHeight: 1, margin: 0
  })
  const characters: Array<Character<K>> = looks
    .flatMap((look, i) => {
      const database = cast[i].capture
      if (look.skin === undefined || database === undefined) return []
      const fresh = {
        view: {},
        angles: new Map<string, number>(),
        lengths: new Map<string, number>(),
        anchors: new Map<string, [number, number]>(),
        visited: new Set<K>(),
        sameSince: 0,
        placedAgain: 0,
        steps: 0,
        ticks: 0
      }
      const secondary = createSecondary(cast[i], {
        ...PAGE_CLOTH, fps: FPS, springSubsteps: options.springSubsteps, environment: () => options.environment
      })
      return [{ name: cast[i].name, look: look as Skinned, database, secondary, ...fresh }]
    })
    .slice(0, options.count)
  const heightOf = (c: Character<K>): number => Math.max(...Object.values(c.database.options.rest).map(p => p[1]))
  const tallest = Math.max(1, ...characters.map(heightOf))

  let marks: Array<Mark<K>> = []
  let ground: Ground = { surfaces: [], walls: [] }
  let time = 0
  let clock = 0
  const samples: Sample[] = []
  const visits: Array<Visit<K>> = []

  const attraction = (surface: number): number => marks[surface]?.hints.attract ?? 0
  const placeAnywhere = (avoid?: K): Place | undefined => {
    const graph = surfaceGraph(ground, { step: STEP_HEIGHT, drop: DROP_LIMIT, body: tallest })
    const elsewhere = (n: Node): boolean => avoid === undefined || marks[n.surface]?.key !== avoid
    const wide = graph.nodes.filter(n => n.to - n.from > 2 * MARGIN_FROM_SURFACE_ENDS && elsewhere(n))
    const total = wide.reduce((sum, n) => sum + n.to - n.from, 0)
    let pick = next() * total
    const node = wide.find(n => (pick -= n.to - n.from) <= 0) ?? wide.at(-1)
    if (node === undefined) return undefined
    const usable = node.to - node.from - 2 * MARGIN_FROM_SURFACE_ENDS
    return { x: node.from + MARGIN_FROM_SURFACE_ENDS + usable * next(), height: node.height }
  }
  const surfaceOf = (key: K): Surface | undefined => {
    const index = marks.findIndex(m => m.key === key)
    return ground.surfaces.find(s => s.id === index)
  }
  const standingOn = (surface: Surface | undefined): Standing<K> | undefined => {
    const mark = surface === undefined ? undefined : marks[surface.id]
    return surface === undefined || mark === undefined
      ? undefined
      : { key: mark.key, from: surface.from, height: surface.height }
  }
  const restart = (c: Character<K>): void => {
    c.secondary.reset()
    c.cloth = undefined
  }
  const moveTo = (c: Character<K>, walker: Walker, place: Place): void => {
    walker.moveTo(place)
    restart(c)
  }
  const replace = (c: Character<K>, walker: Walker): void => {
    const place = placeAnywhere()
    if (place !== undefined) moveTo(c, walker, place)
  }
  const carry = (c: Character<K>, walker: Walker, on: Standing<K>, now: Surface): void => {
    const dx = now.from - on.from
    const dy = now.height - on.height
    if (Math.abs(dx) > MOVED || Math.abs(dy) > MOVED) {
      walker.shiftBy(dx, dy)
      c.secondary.shift([dx, dy, 0])
      c.cloth = c.cloth?.map((v, i) => i % 3 === 0 ? v + dx : i % 3 === 1 ? v + dy : v)
    }
    const x = walker.frame().root.position[0]
    const inside = Math.min(now.to, Math.max(now.from, x))
    if (x < now.from || x > now.to) moveTo(c, walker, { x: inside, height: now.height })
  }
  const follow = (c: Character<K>, walker: Walker): void => {
    const now = c.on === undefined ? undefined : surfaceOf(c.on.key)
    if (now !== undefined && c.on !== undefined) carry(c, walker, c.on, now)
    walker.setGround(ground)
    if (walker.support() === undefined) replace(c, walker)
  }
  const nextYaw = (): number => next() < 0.5 ? Math.PI / 2 : -Math.PI / 2
  const setLayout = (latest: Array<Mark<K>>): void => {
    marks = latest
    ground = groundOf(marks.map(m => m.box), pixelsPerMetre)
    for (const c of characters) {
      if (c.walker !== undefined) follow(c, c.walker)
      else {
        const place = placeAnywhere()
        if (place === undefined) continue
        const yaw = nextYaw()
        c.walker = createWalker({ database: c.database, fps: FPS, random: next, ground, place, yaw, attraction })
      }
      c.on = standingOn(c.walker.support())
    }
  }
  const spriteOf = (c: Character<K>, frame: WalkerFrame): Sprite => {
    if (c.sprite?.frame === frame) return c.sprite
    const { mannequin, skin } = c.look.skin
    const height = Math.max(...Object.values(mannequin.joints).map(p => p[1]))
    const size = Math.ceil(SPRITE_BOX_IN_CHARACTER_HEIGHTS * height * spritePerMetre)
    const box: Camera = { ...camera, width: size, height: size, baseline: Math.round(size * FEET_LINE_SHARE_OF_BOX) }
    const [x, , z] = frame.root.position
    const y = anchorHeight(frame)
    const pose: Pose = {}
    for (const [name, p] of Object.entries(frame.joints)) pose[name] = [p[0] - x, p[1] - y, p[2] - z]
    const curves = Object.fromEntries(Object.entries(c.secondary.curves())
      .map(([joint, points]) => [joint, points.map((p): Vec3 => [p[0] - x, p[1] - y, p[2] - z])]))
    const image = renderSkinned({
      mannequin, pose: { ...mannequin.joints, ...pose }, skin, camera: box, yaw: frame.root.yaw, view: c.view,
      angles: c.angles, lengths: c.lengths, anchors: c.anchors, curves
    })
    c.sprite = { image, camera: box, frame }
    return c.sprite
  }

  const gapOf = ([x, y]: [number, number]): number | null => {
    const under = surfaceBelow(ground, x, y + STEP_HEIGHT, 0)
    return under === undefined ? null : (y - under.height) * pixelsPerMetre
  }
  const record = (c: Character<K>, frame: WalkerFrame): void => {
    const feet = frame.feet.map(foot => {
      const gaps = foot.soles.map(gapOf)
      const known = gaps.filter((gap): gap is number => gap !== null)
      return { planted: foot.planted, gap: known.length === 0 ? null : Math.min(...known) }
    })
    samples.push({ name: c.name, falling: frame.falling, feet })
    keep(samples, KEPT_SAMPLES)
  }

  const wordsAt = (c: Character<K>, visited: boolean): string | undefined => {
    if (visited && c.interest !== undefined) return c.interest
    return c.on === undefined ? undefined : marks.find(m => m.key === c.on?.key)?.hints.say
  }
  const notice = (c: Character<K>, frame: WalkerFrame): void => {
    const was = c.activity
    c.activity = frame.activity
    if (frame.activity !== 'rest' || was === 'rest' || was === undefined) return
    const said = frame.reached ? wordsAt(c, was === 'visit') : undefined
    c.interest = undefined
    if (said !== undefined) c.saying = { text: said, until: time + SAYING_SECONDS }
  }
  const interest = (wanted: Interest<K>): boolean => {
    const distance = (c: Character<K>): number => {
      const frame = c.walker?.frame()
      if (frame === undefined) return Infinity
      return Math.hypot(frame.root.position[0] - wanted.place.x, anchorHeight(frame) - wanted.place.height)
    }
    const able = characters.filter(c => c.walker?.reaches(wanted.place) === true)
    const nearest = [...able].sort((a, b) => distance(a) - distance(b))[0]
    if (nearest?.walker?.visit(wanted.place) !== true) return false
    nearest.interest = wanted.say
    nearest.activity = 'visit'
    visits.push({ name: nearest.name, key: wanted.key, ...(wanted.say === undefined ? {} : { say: wanted.say }) })
    keep(visits, KEPT_VISITS)
    return true
  }

  const startOf = (place: Place, viewport: Viewport): number => {
    const top = -viewport.top / pixelsPerMetre
    const bottom = top - viewport.height / pixelsPerMetre
    const start = place.height + LEAST_DROP_IN
    return start >= bottom && place.height <= top ? Math.max(start, top + ABOVE_VIEWPORT) : start
  }
  const clearAbove = (place: Place, start: number): boolean => !ground.surfaces.some(s => {
    return s.from <= place.x && s.to >= place.x && s.height > place.height && s.height < start
  })
  const dropElsewhere = (c: Character<K>, walker: Walker, viewport: Viewport): void => {
    c.sameSince = c.steps
    for (let tries = 0; tries < DROP_IN_TRIES; tries++) {
      const place = placeAnywhere(c.on?.key)
      if (place === undefined) return
      const start = startOf(place, viewport)
      if (!clearAbove(place, start)) continue
      walker.dropIn(place, start - place.height)
      restart(c)
      c.interest = undefined
      return
    }
  }

  const stepOne = (c: Character<K>, walker: Walker, viewport: Viewport): void => {
    c.steps++
    const frame = walker.step()
    const [raised, lowered] = raisedRoot(frame)
    c.cloth = c.secondary.step(c.steps, raised, frame.joints, lowered, frame.transforms)
    if (frame.support === undefined) {
      replace(c, walker)
      c.placedAgain++
    }
    const before = c.on?.key
    c.on = frame.falling ? undefined : standingOn(frame.support) ?? c.on
    if (c.on !== undefined && frame.activity !== 'drop') c.visited.add(c.on.key)
    if (c.on?.key !== before) c.sameSince = c.steps
    notice(c, frame)
    const stale = STALE_SECONDS * FPS * (1 + (frame.support === undefined ? 0 : attraction(frame.support.id)))
    if (frame.activity === 'rest' && c.steps - c.sameSince > stale) dropElsewhere(c, walker, viewport)
    if (options.measure === true) record(c, frame)
  }

  const expireWords = (): boolean => {
    let changed = false
    for (const c of characters) {
      if (c.saying === undefined || time <= c.saying.until) continue
      c.saying = undefined
      changed = true
    }
    return changed
  }

  const advance = (seconds: number, viewport: Viewport, moving: boolean): Advance => {
    const elapsed = Math.min(seconds, MOST_STEPS_PER_FRAME / FPS)
    time += elapsed
    let stepped = false
    if (moving) {
      clock += elapsed
      characters.forEach((c, i) => {
        const walker = c.walker
        if (walker === undefined) return
        const due = Math.floor(clock * FPS + i / characters.length)
        for (; c.ticks < due; c.ticks++) {
          stepOne(c, walker, viewport)
          stepped = true
        }
      })
    }
    return { stepped, changed: expireWords() }
  }

  return {
    setLayout,
    advance,
    interest,
    poke: name => { characters.find(c => c.name === name)?.walker?.poke() },
    surfaceOf,
    ground: () => ground,
    layout: () => marks,
    drawables: () => characters.flatMap(c => {
      const frame = c.walker?.frame()
      if (frame === undefined) return []
      const drawable: Drawable = {
        name: c.name,
        x: frame.root.position[0] * pixelsPerMetre,
        y: -anchorHeight(frame) * pixelsPerMetre,
        sprite: () => spriteOf(c, frame),
        ...(c.saying === undefined ? {} : { saying: c.saying.text })
      }
      return [drawable]
    }),
    moving: () => characters.flatMap(c => {
      const frame = c.walker?.frame()
      if (frame === undefined) return []
      return [{ name: c.name, frame, cloth: c.cloth, system: c.secondary.system, curves: c.secondary.curves() }]
    }),
    characters: () => characters.flatMap(c => {
      const frame = c.walker?.frame()
      if (frame === undefined) return []
      return [{
        name: c.name,
        x: frame.root.position[0] * pixelsPerMetre,
        y: -anchorHeight(frame) * pixelsPerMetre,
        surface: frame.support?.id ?? -1,
        yaw: frame.root.yaw,
        heading: frame.heading,
        falling: frame.falling,
        on: c.on?.key,
        lowestSole: -Math.min(...frame.feet.flatMap(f => f.soles.map(p => p[1]))) * pixelsPerMetre,
        activity: frame.activity,
        started: frame.started,
        elements: c.visited.size,
        saying: c.saying?.text ?? '',
        placedAgain: c.placedAgain
      }]
    }),
    samples: () => samples.splice(0),
    visits: () => [...visits]
  }
}
