import { fetchWorldBundle } from '../world/bundle.ts'
import { getPixel, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import { createCast, keep, pageEnvironment, spriteReach } from './cast.ts'
import type { CharacterState, Mark, Sample } from './cast.ts'
import { sayOf, scan, watch } from './dom.ts'
import type { Hints } from './dom.ts'
import { perceive } from './perception.ts'
import type { Noticed } from './perception.ts'
import { drawBubble } from './speech.ts'
import type { Box, Ground } from './surfaces.ts'

export type PageWorldOptions = {
  bundle: string
  pixelsPerMetre: number
  scale: number
  seed: number
  count?: number
  measure?: boolean
  wind?: number
}
export type PageCharacter = Omit<CharacterState<Element>, 'on'> & { element: string }
export type Visit = { name: string, element: string, say?: string }
export type LaidOut = { element: string, box: Box, hints: Hints }
export type PageWorld = {
  ground: () => Ground
  layout: () => LaidOut[]
  characters: () => PageCharacter[]
  samples: () => Sample[]
  visits: () => Visit[]
  costs: () => number[]
  pokes: () => number
  rebuilds: () => number
  destroy: () => void
}

type Drawn = { name: string, left: number, top: number, pixel: number, image: Image }
type Canvased = { image: Image, canvas: HTMLCanvasElement }

const KEPT_COSTS = 600
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

function idOf (element: Element | undefined): string {
  return element?.id ?? ''
}

function toCanvas (image: Image, reuse?: HTMLCanvasElement): HTMLCanvasElement {
  const sprite = reuse ?? document.createElement('canvas')
  sprite.width = image.width
  sprite.height = image.height
  const pixels = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height)
  sprite.getContext('2d')?.putImageData(pixels, 0, 0)
  return sprite
}

export async function createPageWorld (options: PageWorldOptions): Promise<PageWorld> {
  const { cast, looks, config } = await fetchWorldBundle(options.bundle)
  const { pixelsPerMetre } = options
  const world = createCast<Element>({ ...options, cast, looks, ...pageEnvironment(config, options.wind) })
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  const canvas = overlayCanvas()
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('the page world needs a 2d canvas context')
  const draw2d = context
  const canvases = new Map<string, Canvased>()
  let drawn: Drawn[] = []
  let rebuilds = 0
  let pokes = 0
  const costs: number[] = []

  const rescan = (): void => {
    world.setLayout(scan().map((m): Mark<Element> => ({ key: m.element, box: m.box, hints: m.hints })))
  }
  const viewport = (): { top: number, height: number } => ({ top: window.scrollY, height: window.innerHeight })
  const canvasOf = (name: string, image: Image): HTMLCanvasElement => {
    const kept = canvases.get(name)
    if (kept?.image === image) return kept.canvas
    const sprite = toCanvas(image, kept?.canvas)
    canvases.set(name, { image, canvas: sprite })
    return sprite
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
    draw2d.imageSmoothingEnabled = false
    const devicePixel = Math.max(1, Math.round(options.scale * ratio))
    const reach = spriteReach(pixelsPerMetre) * ratio
    drawn = []
    for (const d of world.drawables()) {
      const footX = (d.x - window.scrollX) * ratio
      const footY = (d.y - window.scrollY) * ratio
      if (footX < -reach || footY < -reach || footX > canvas.width + reach || footY > canvas.height + reach) continue
      const { image, camera } = d.sprite()
      const left = Math.round(footX - camera.width / 2 * devicePixel)
      const top = Math.round(footY - camera.baseline * devicePixel)
      draw2d.drawImage(canvasOf(d.name, image), left, top, image.width * devicePixel, image.height * devicePixel)
      const at = { left: left / ratio + window.scrollX, top: top / ratio + window.scrollY }
      drawn.push({ name: d.name, ...at, pixel: devicePixel / ratio, image })
      if (d.saying !== undefined) drawBubble(draw2d, d.saying, footX, top, ratio)
    }
  }

  let previous = performance.now()
  let scrolled = true
  let animation = 0
  const tick = (now: number): void => {
    const begin = performance.now()
    try {
      const { stepped, changed } = world.advance((now - previous) / 1000, viewport(), !reducedMotion.matches)
      previous = now
      if (stepped || changed || scrolled) redraw()
      scrolled = false
    } finally {
      costs.push(performance.now() - begin)
      keep(costs, KEPT_COSTS)
      animation = requestAnimationFrame(tick)
    }
  }

  const hit = (pageX: number, pageY: number): string | undefined => drawn.findLast(d => {
    const x = Math.floor((pageX - d.left) / d.pixel)
    const y = Math.floor((pageY - d.top) / d.pixel)
    return getPixel(d.image, x, y) !== TRANSPARENT
  })?.name

  let gestureUntil = 0
  const swallow = (event: Event): void => {
    if (performance.now() > gestureUntil) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.type === 'click') gestureUntil = 0
  }
  const onPointerDown = (event: PointerEvent): void => {
    if (!event.isTrusted || !event.isPrimary || somethingCoversThePage(canvas)) return
    const name = hit(event.clientX + window.scrollX, event.clientY + window.scrollY)
    if (name === undefined) return
    event.preventDefault()
    event.stopImmediatePropagation()
    gestureUntil = performance.now() + GESTURE_TIMEOUT_MS
    pokes++
    if (!reducedMotion.matches) world.poke(name)
  }
  const onNotice = (noticed: Noticed): void => {
    if (reducedMotion.matches) return
    const say = sayOf(noticed.element.closest('[data-pinata-say]') ?? noticed.element)
    world.interest({ key: noticed.element, place: noticed.place, ...(say === undefined ? {} : { say }) })
  }
  document.addEventListener('pointerdown', onPointerDown, true)
  for (const type of GESTURE_EVENTS) document.addEventListener(type, swallow, true)

  rescan()
  const marked = (): Array<{ element: Element, box: Box, hints: Hints }> => {
    return world.layout().map(m => ({ element: m.key, box: m.box, hints: m.hints }))
  }
  const stopWatching = watch(() => {
    rebuilds++
    rescan()
    scrolled = true
  }, marked, node => node === canvas)
  const stopPerceiving = perceive({
    ground: world.ground,
    pixelsPerMetre,
    onInterest: onNotice,
    ignore: element => element === canvas,
    surfaceOf: world.surfaceOf
  })
  const onScroll = (): void => { scrolled = true }
  window.addEventListener('scroll', onScroll, { passive: true })
  redraw()
  animation = requestAnimationFrame(tick)

  return {
    ground: world.ground,
    layout: () => world.layout().map(m => ({ element: idOf(m.key), box: m.box, hints: m.hints })),
    characters: () => world.characters().map(({ on, ...c }) => ({ ...c, element: idOf(on) })),
    samples: world.samples,
    visits: () => world.visits().map(({ key, ...v }) => ({ ...v, element: idOf(key) })),
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
