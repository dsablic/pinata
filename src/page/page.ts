import { fetchWorldBundle } from '../world/bundle.ts'
import type { Look } from '../world/render.ts'
import { random } from '../world/terrain.ts'
import type { Pose } from '../motion/pose.ts'
import { makeCamera } from '../raster/camera.ts'
import type { Camera } from '../raster/camera.ts'
import { renderSkinned } from '../style/skins.ts'
import { getPixel, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import type { MotionDatabase } from '../mocap/database.ts'
import { sayOf, scan, watch } from './dom.ts'
import type { Marked } from './dom.ts'
import { groundOf, surfaceBelow } from './surfaces.ts'
import type { Ground, Surface } from './surfaces.ts'
import { surfaceGraph } from './graph.ts'
import { createWalker, DROP_LIMIT, STEP_HEIGHT } from './walker.ts'
import type { Activity, Place, Walker, WalkerFrame } from './walker.ts'
import { perceive } from './perception.ts'
import type { Interest } from './perception.ts'
import { drawBubble } from './speech.ts'

export type PageWorldOptions = {
  bundle: string
  pixelsPerMetre: number
  scale: number
  seed: number
  count?: number
  measure?: boolean
}

type Skinned = Look & { skin: NonNullable<Look['skin']> }
type Sprite = { image: Image, camera: Camera, canvas: HTMLCanvasElement, frame: WalkerFrame }
type Drawn = { left: number, top: number, pixel: number }
type Standing = { element: Element, from: number, height: number }
type Saying = { text: string, until: number }
type Character = {
  name: string
  look: Skinned
  database: MotionDatabase
  walker?: Walker
  on?: Standing
  visited: Set<Element>
  activity?: Activity
  interest?: Element
  saying?: Saying
  view: { sector?: number }
  sprite?: Sprite
  drawn?: Drawn
}

export type CharacterState = {
  name: string
  x: number
  y: number
  surface: number
  yaw: number
  heading: number
  falling: boolean
  element: string
  lowestSole: number
  activity: string
  started: number
  elements: number
  saying: string
}
export type Visit = { name: string, element: string }
export type Hint = { element: string, say?: string, attract: number }
export type FootSample = { planted: boolean, gap: number | null }
export type Sample = { name: string, falling: boolean, feet: FootSample[] }
export type PageWorld = {
  ground: () => Ground
  characters: () => CharacterState[]
  samples: () => Sample[]
  visits: () => Visit[]
  hints: () => Hint[]
  costs: () => number[]
  pokes: () => number
  rebuilds: () => number
  destroy: () => void
}

const FPS = 24
const MOST_STEPS_PER_FRAME = 3
const CAMERA_ELEVATION_DEGREES = 8
const SPRITE_BOX_IN_CHARACTER_HEIGHTS = 1.6
const FEET_LINE_SHARE_OF_BOX = 0.85
const MARGIN_FROM_SURFACE_ENDS = 0.3
const MOVED = 1e-3
const KEPT_SAMPLES = 8000
const KEPT_COSTS = 600
const SAYING_MS = 2500
const KEPT_VISITS = 100
const GESTURE_EVENTS = ['mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu']
const GESTURE_TIMEOUT_MS = 800

function overlayCanvas (): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    margin: '0',
    padding: '0',
    border: '0',
    background: 'transparent',
    overflow: 'visible',
    pointerEvents: 'none',
    zIndex: '2147483646',
    imageRendering: 'pixelated'
  })
  if ('showPopover' in canvas) {
    canvas.popover = 'manual'
    document.body.appendChild(canvas)
    canvas.showPopover()
  } else document.documentElement.appendChild(canvas)
  return canvas
}

function somethingCoversThePage (overlay: Element): boolean {
  const covering = document.querySelector(':modal') ?? document.fullscreenElement
  const popovers = [...document.querySelectorAll(':popover-open')].filter(element => element !== overlay)
  return covering !== null || popovers.length > 0
}

function keep<T> (list: T[], most: number): void {
  if (list.length > most) list.splice(0, list.length - most)
}

function anchorHeight (frame: WalkerFrame): number {
  return frame.falling || frame.support === undefined ? frame.base : frame.support.height
}

export async function createPageWorld (options: PageWorldOptions): Promise<PageWorld> {
  const { cast, looks } = await fetchWorldBundle(options.bundle)
  const next = random(options.seed)
  const { pixelsPerMetre } = options
  const spritePerMetre = pixelsPerMetre / options.scale
  const camera = makeCamera({
    azimuthDeg: 0, elevationDeg: CAMERA_ELEVATION_DEGREES, targetHeightPx: spritePerMetre, modelHeight: 1, margin: 0
  })
  const characters: Character[] = looks
    .flatMap((look, i) => {
      const database = cast[i].capture
      if (look.skin === undefined || database === undefined) return []
      return [{ name: cast[i].name, look: look as Skinned, database, view: {}, visited: new Set<Element>() }]
    })
    .slice(0, options.count)
  const heightOf = (c: Character): number => Math.max(...Object.values(c.database.options.rest).map(p => p[1]))
  const tallest = Math.max(1, ...characters.map(heightOf))
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

  let marked: Marked[] = []
  let ground: Ground = { surfaces: [], walls: [] }
  let rebuilds = 0
  let pokes = 0
  const samples: Sample[] = []
  const visits: Visit[] = []
  const costs: number[] = []

  const placeAnywhere = (): Place | undefined => {
    const graph = surfaceGraph(ground, { step: STEP_HEIGHT, drop: DROP_LIMIT, body: tallest })
    const wide = graph.nodes.filter(n => n.to - n.from > 2 * MARGIN_FROM_SURFACE_ENDS)
    const total = wide.reduce((sum, n) => sum + n.to - n.from, 0)
    let pick = next() * total
    const node = wide.find(n => (pick -= n.to - n.from) <= 0) ?? wide.at(-1)
    if (node === undefined) return undefined
    const usable = node.to - node.from - 2 * MARGIN_FROM_SURFACE_ENDS
    return { x: node.from + MARGIN_FROM_SURFACE_ENDS + usable * next(), height: node.height }
  }
  const surfaceOf = (element: Element): Surface | undefined => {
    const index = marked.findIndex(m => m.element === element)
    return ground.surfaces.find(s => s.id === index)
  }
  const standingOn = (surface: Surface | undefined): Standing | undefined => {
    const element = surface === undefined ? undefined : marked[surface.id]?.element
    return surface === undefined || element === undefined
      ? undefined
      : { element, from: surface.from, height: surface.height }
  }
  const attraction = (surface: number): number => marked[surface]?.hints.attract ?? 0
  const replace = (walker: Walker): void => {
    const place = placeAnywhere()
    if (place !== undefined) walker.moveTo(place)
  }
  const carry = (walker: Walker, on: Standing, now: Surface): void => {
    const dx = now.from - on.from
    const dy = now.height - on.height
    if (Math.abs(dx) > MOVED || Math.abs(dy) > MOVED) walker.shiftBy(dx, dy)
    const x = walker.frame().root.position[0]
    if (x < now.from || x > now.to) walker.moveTo({ x: Math.min(now.to, Math.max(now.from, x)), height: now.height })
  }
  const follow = (c: Character, walker: Walker): void => {
    const now = c.on === undefined ? undefined : surfaceOf(c.on.element)
    if (now !== undefined && c.on !== undefined) carry(walker, c.on, now)
    walker.setGround(ground)
    if (walker.support() === undefined) replace(walker)
  }
  const rescan = (): void => {
    marked = scan()
    ground = groundOf(marked.map(m => m.box), pixelsPerMetre)
    for (const c of characters) {
      if (c.walker !== undefined) follow(c, c.walker)
      else {
        const place = placeAnywhere()
        if (place === undefined) continue
        const yaw = next() < 0.5 ? Math.PI / 2 : -Math.PI / 2
        c.walker = createWalker({ database: c.database, fps: FPS, random: next, ground, place, yaw, attraction })
      }
      c.on = standingOn(c.walker.support())
    }
  }

  const canvas = overlayCanvas()
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('the page world needs a 2d canvas context')
  const draw2d = context

  const spriteOf = (c: Character, frame: WalkerFrame): Sprite => {
    if (c.sprite?.frame === frame) return c.sprite
    const { mannequin, skin } = c.look.skin
    const height = Math.max(...Object.values(mannequin.joints).map(p => p[1]))
    const size = Math.ceil(SPRITE_BOX_IN_CHARACTER_HEIGHTS * height * spritePerMetre)
    const box: Camera = { ...camera, width: size, height: size, baseline: Math.round(size * FEET_LINE_SHARE_OF_BOX) }
    const [x, , z] = frame.root.position
    const y = anchorHeight(frame)
    const pose: Pose = {}
    for (const [name, p] of Object.entries(frame.joints)) pose[name] = [p[0] - x, p[1] - y, p[2] - z]
    const image = renderSkinned({
      mannequin, pose: { ...mannequin.joints, ...pose }, skin, camera: box, yaw: frame.root.yaw, view: c.view
    })
    const canvas = c.sprite?.canvas ?? document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const pixels = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height)
    canvas.getContext('2d')?.putImageData(pixels, 0, 0)
    c.sprite = { image, camera: box, canvas, frame }
    return c.sprite
  }

  const redraw = (): void => {
    const ratio = window.devicePixelRatio || 1
    const width = window.innerWidth
    const height = window.innerHeight
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }
    draw2d.clearRect(0, 0, canvas.width, canvas.height)
    const now = performance.now()
    for (const c of characters) if (c.saying !== undefined && now > c.saying.until) c.saying = undefined
    draw2d.imageSmoothingEnabled = false
    const devicePixel = Math.max(1, Math.round(options.scale * ratio))
    for (const c of characters) {
      c.drawn = undefined
      const frame = c.walker?.frame()
      if (frame === undefined) continue
      const footX = (frame.root.position[0] * pixelsPerMetre - window.scrollX) * ratio
      const footY = (-anchorHeight(frame) * pixelsPerMetre - window.scrollY) * ratio
      const reach = SPRITE_BOX_IN_CHARACTER_HEIGHTS * 2 * pixelsPerMetre * ratio
      if (footX < -reach || footY < -reach || footX > canvas.width + reach || footY > canvas.height + reach) continue
      const sprite = spriteOf(c, frame)
      const left = Math.round(footX - sprite.camera.width / 2 * devicePixel)
      const top = Math.round(footY - sprite.camera.baseline * devicePixel)
      draw2d.drawImage(sprite.canvas, left, top, sprite.image.width * devicePixel, sprite.image.height * devicePixel)
      c.drawn = { left: left / ratio + window.scrollX, top: top / ratio + window.scrollY, pixel: devicePixel / ratio }
      if (c.saying !== undefined) drawBubble(draw2d, c.saying.text, footX, top, ratio)
    }
  }

  const gapOf = ([x, y]: [number, number]): number | null => {
    const under = surfaceBelow(ground, x, y + STEP_HEIGHT, 0)
    return under === undefined ? null : (y - under.height) * pixelsPerMetre
  }
  const record = (c: Character, frame: WalkerFrame): void => {
    const feet = frame.feet.map(foot => {
      const gaps = foot.soles.map(gapOf)
      const known = gaps.filter((gap): gap is number => gap !== null)
      return { planted: foot.planted, gap: known.length === 0 ? null : Math.min(...known) }
    })
    samples.push({ name: c.name, falling: frame.falling, feet })
    keep(samples, KEPT_SAMPLES)
  }

  const wordsAt = (c: Character, visited: boolean): string | undefined => {
    const asked = c.interest?.closest('[data-pinata-say]') ?? undefined
    if (visited && asked !== undefined) return sayOf(asked)
    return c.on === undefined ? undefined : marked.find(m => m.element === c.on?.element)?.hints.say
  }
  const notice = (c: Character, frame: WalkerFrame): void => {
    const was = c.activity
    c.activity = frame.activity
    if (frame.activity !== 'rest' || was === 'rest' || was === undefined) return
    const said = frame.reached ? wordsAt(c, was === 'visit') : undefined
    c.interest = undefined
    if (said !== undefined) c.saying = { text: said, until: performance.now() + SAYING_MS }
  }
  const visitBy = (interest: Interest): void => {
    if (reducedMotion.matches) return
    const distance = (c: Character): number => {
      const frame = c.walker?.frame()
      if (frame === undefined) return Infinity
      return Math.hypot(frame.root.position[0] - interest.place.x, anchorHeight(frame) - interest.place.height)
    }
    const nearest = characters.filter(c => c.walker?.reaches(interest.place) === true)
      .sort((a, b) => distance(a) - distance(b))[0]
    if (nearest?.walker?.visit(interest.place) !== true) return
    nearest.interest = interest.element
    nearest.activity = 'visit'
    visits.push({ name: nearest.name, element: interest.element.id })
    keep(visits, KEPT_VISITS)
  }

  const stepAll = (): void => {
    for (const c of characters) {
      const walker = c.walker
      if (walker === undefined) continue
      const frame = walker.step()
      if (frame.support === undefined) replace(walker)
      c.on = frame.falling ? undefined : standingOn(frame.support) ?? c.on
      if (c.on !== undefined) c.visited.add(c.on.element)
      notice(c, frame)
      if (options.measure === true) record(c, frame)
    }
  }

  let owed = 0
  let previous = performance.now()
  let scrolled = true
  let animation = 0
  const tick = (now: number): void => {
    const begin = performance.now()
    try {
      owed = Math.min(MOST_STEPS_PER_FRAME / FPS, owed + (now - previous) / 1000)
      previous = now
      let stepped = false
      if (!reducedMotion.matches) {
        for (; owed >= 1 / FPS; owed -= 1 / FPS) {
          stepAll()
          stepped = true
        }
      } else owed = 0
      const expired = characters.some(c => c.saying !== undefined && performance.now() > c.saying.until)
      if (stepped || scrolled || expired) redraw()
      scrolled = false
    } finally {
      costs.push(performance.now() - begin)
      keep(costs, KEPT_COSTS)
      animation = requestAnimationFrame(tick)
    }
  }

  const hit = (pageX: number, pageY: number): Character | undefined => characters.findLast(c => {
    if (c.drawn === undefined || c.sprite === undefined) return false
    const x = Math.floor((pageX - c.drawn.left) / c.drawn.pixel)
    const y = Math.floor((pageY - c.drawn.top) / c.drawn.pixel)
    return getPixel(c.sprite.image, x, y) !== TRANSPARENT
  })

  let gestureUntil = 0
  const swallow = (event: Event): void => {
    if (performance.now() > gestureUntil) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.type === 'click') gestureUntil = 0
  }
  const onPointerDown = (event: PointerEvent): void => {
    if (!event.isTrusted || !event.isPrimary || somethingCoversThePage(canvas)) return
    const c = hit(event.clientX + window.scrollX, event.clientY + window.scrollY)
    if (c === undefined) return
    event.preventDefault()
    event.stopImmediatePropagation()
    gestureUntil = performance.now() + GESTURE_TIMEOUT_MS
    pokes++
    if (!reducedMotion.matches) c.walker?.poke()
  }
  document.addEventListener('pointerdown', onPointerDown, true)
  for (const type of GESTURE_EVENTS) document.addEventListener(type, swallow, true)

  rescan()
  const stopWatching = watch(() => {
    rebuilds++
    rescan()
    scrolled = true
  }, () => marked, node => node === canvas)
  const stopPerceiving = perceive({
    ground: () => ground, pixelsPerMetre, onInterest: visitBy, ignore: element => element === canvas, surfaceOf
  })
  const onScroll = (): void => { scrolled = true }
  window.addEventListener('scroll', onScroll, { passive: true })
  redraw()
  animation = requestAnimationFrame(tick)

  return {
    ground: () => ground,
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
        element: c.on?.element.id ?? '',
        lowestSole: -Math.min(...frame.feet.flatMap(f => f.soles.map(p => p[1]))) * pixelsPerMetre,
        activity: frame.activity,
        started: frame.started,
        elements: c.visited.size,
        saying: c.saying?.text ?? ''
      }]
    }),
    samples: () => samples.splice(0),
    visits: () => [...visits],
    hints: () => marked.map(m => ({ element: m.element.id, ...m.hints })),
    costs: () => [...costs],
    pokes: () => pokes,
    rebuilds: () => rebuilds,
    destroy: () => {
      cancelAnimationFrame(animation)
      stopWatching()
      stopPerceiving()
      document.removeEventListener('pointerdown', onPointerDown, true)
      for (const type of GESTURE_EVENTS) document.removeEventListener(type, swallow, true)
      window.removeEventListener('scroll', onScroll)
      canvas.remove()
    }
  }
}
