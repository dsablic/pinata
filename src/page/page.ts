import { fetchWorldBundle } from '../world/bundle.ts'
import type { Look } from '../world/render.ts'
import { random } from '../world/terrain.ts'
import { restPose } from '../motion/pose.ts'
import type { Pose } from '../motion/pose.ts'
import type { RootState } from '../motion/script.ts'
import { makeCamera } from '../raster/camera.ts'
import type { Camera } from '../raster/camera.ts'
import { toWorld } from '../sim/body.ts'
import { renderSkinned } from '../style/skins.ts'
import { getPixel, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import { scan, watch } from './dom.ts'
import type { Marked } from './dom.ts'
import { groundOf } from './surfaces.ts'
import type { Ground, Surface } from './surfaces.ts'

export type PageWorldOptions = {
  bundle: string
  pixelsPerMetre: number
  scale: number
  seed: number
  count?: number
}

type Skinned = Look & { skin: NonNullable<Look['skin']> }
type Placement = { x: number, surface: Surface, element: Element }
type Sprite = { image: Image, camera: Camera, yaw: number, canvas: HTMLCanvasElement }
type Drawn = { left: number, top: number, pixel: number }
type Character = {
  name: string
  look: Skinned
  yaw: number
  view: { sector?: number }
  placed?: Placement
  sprite?: Sprite
  drawn?: Drawn
}

export type CharacterState = { name: string, x: number, y: number, surface: number, yaw: number }
export type PageWorld = {
  ground: () => Ground
  characters: () => CharacterState[]
  pokes: () => number
  rebuilds: () => number
  destroy: () => void
}

const CAMERA_ELEVATION_DEGREES = 8
const SPRITE_BOX_IN_CHARACTER_HEIGHTS = 1.6
const FEET_LINE_SHARE_OF_BOX = 0.85
const MARGIN_FROM_SURFACE_ENDS = 0.3
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

function standingPose (look: Skinned, yaw: number): Pose {
  const root: RootState = { position: [0, 0, 0], yaw, velocity: [0, 0, 0], angularVelocity: 0 }
  return Object.fromEntries(Object.entries(restPose(look.skin.mannequin)).map(([name, p]) => [name, toWorld(p, root)]))
}

export async function createPageWorld (options: PageWorldOptions): Promise<PageWorld> {
  const { cast, looks } = await fetchWorldBundle(options.bundle)
  const next = random(options.seed)
  const spritePerMetre = options.pixelsPerMetre / options.scale
  const camera = makeCamera({
    azimuthDeg: 0, elevationDeg: CAMERA_ELEVATION_DEGREES, targetHeightPx: spritePerMetre, modelHeight: 1, margin: 0
  })
  const characters: Character[] = looks
    .flatMap((look, i) => look.skin === undefined ? [] : [{ name: cast[i].name, look: look as Skinned }])
    .slice(0, options.count)
    .map(({ name, look }) => ({ name, look, yaw: next() < 0.5 ? Math.PI / 2 : -Math.PI / 2, view: {} }))

  let marked: Marked[] = []
  let ground: Ground = { surfaces: [], walls: [] }
  let rebuilds = 0
  let pokes = 0

  const placeAnywhere = (): Placement | undefined => {
    const wide = ground.surfaces.filter(s => s.to - s.from > 2 * MARGIN_FROM_SURFACE_ENDS)
    const total = wide.reduce((sum, s) => sum + s.to - s.from, 0)
    let pick = next() * total
    const surface = wide.find(s => (pick -= s.to - s.from) <= 0) ?? wide.at(-1)
    if (surface === undefined) return undefined
    const usable = surface.to - surface.from - 2 * MARGIN_FROM_SURFACE_ENDS
    const x = surface.from + MARGIN_FROM_SURFACE_ENDS + usable * next()
    return { x, surface, element: marked[surface.id].element }
  }
  const keepOnItsElement = (placed: Placement): Placement | undefined => {
    const index = marked.findIndex(m => m.element === placed.element)
    const surface = ground.surfaces.find(s => s.id === index)
    if (surface === undefined) return undefined
    const share = (placed.x - placed.surface.from) / Math.max(1e-9, placed.surface.to - placed.surface.from)
    const x = surface.from + Math.min(1, Math.max(0, share)) * (surface.to - surface.from)
    return { x, surface, element: placed.element }
  }
  const rescan = (): void => {
    marked = scan()
    ground = groundOf(marked.map(m => m.box), options.pixelsPerMetre)
    for (const c of characters) {
      c.placed = (c.placed === undefined ? undefined : keepOnItsElement(c.placed)) ?? placeAnywhere()
      if (c.placed === undefined) c.drawn = undefined
    }
  }

  const canvas = overlayCanvas()
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('the page world needs a 2d canvas context')
  const draw2d = context

  const spriteOf = (c: Character): Sprite => {
    if (c.sprite !== undefined && c.sprite.yaw === c.yaw) return c.sprite
    const { mannequin, skin } = c.look.skin
    const height = Math.max(...Object.values(mannequin.joints).map(p => p[1]))
    const size = Math.ceil(SPRITE_BOX_IN_CHARACTER_HEIGHTS * height * spritePerMetre)
    const box: Camera = { ...camera, width: size, height: size, baseline: Math.round(size * FEET_LINE_SHARE_OF_BOX) }
    const pose = standingPose(c.look, c.yaw)
    const image = renderSkinned({ mannequin, pose, skin, camera: box, yaw: c.yaw, view: c.view })
    const sprite = document.createElement('canvas')
    sprite.width = image.width
    sprite.height = image.height
    const pixels = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height)
    sprite.getContext('2d')?.putImageData(pixels, 0, 0)
    c.sprite = { image, camera: box, yaw: c.yaw, canvas: sprite }
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
    draw2d.imageSmoothingEnabled = false
    const devicePixel = Math.max(1, Math.round(options.scale * ratio))
    for (const c of characters) {
      c.drawn = undefined
      if (c.placed === undefined) continue
      const footX = (c.placed.x * options.pixelsPerMetre - window.scrollX) * ratio
      const footY = (-c.placed.surface.height * options.pixelsPerMetre - window.scrollY) * ratio
      const reach = SPRITE_BOX_IN_CHARACTER_HEIGHTS * 2 * options.pixelsPerMetre * ratio
      if (footX < -reach || footY < -reach || footX > canvas.width + reach || footY > canvas.height + reach) continue
      const sprite = spriteOf(c)
      const left = Math.round(footX - sprite.camera.width / 2 * devicePixel)
      const top = Math.round(footY - sprite.camera.baseline * devicePixel)
      draw2d.drawImage(sprite.canvas, left, top, sprite.image.width * devicePixel, sprite.image.height * devicePixel)
      c.drawn = { left: left / ratio + window.scrollX, top: top / ratio + window.scrollY, pixel: devicePixel / ratio }
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
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) c.yaw = -c.yaw
    redraw()
  }
  document.addEventListener('pointerdown', onPointerDown, true)
  for (const type of GESTURE_EVENTS) document.addEventListener(type, swallow, true)

  const stopWatching = watch(() => {
    rebuilds++
    rescan()
    redraw()
  }, () => marked.map(m => m.element))
  const onScroll = (): void => { redraw() }
  window.addEventListener('scroll', onScroll, { passive: true })
  rescan()
  redraw()

  return {
    ground: () => ground,
    characters: () => characters.flatMap(c => {
      if (c.placed === undefined) return []
      const { pixelsPerMetre } = options
      const { x, surface } = c.placed
      const y = -surface.height * pixelsPerMetre
      return [{ name: c.name, x: x * pixelsPerMetre, y, surface: surface.id, yaw: c.yaw }]
    }),
    pokes: () => pokes,
    rebuilds: () => rebuilds,
    destroy: () => {
      stopWatching()
      document.removeEventListener('pointerdown', onPointerDown, true)
      for (const type of GESTURE_EVENTS) document.removeEventListener(type, swallow, true)
      window.removeEventListener('scroll', onScroll)
      canvas.remove()
    }
  }
}
