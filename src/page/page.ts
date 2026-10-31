import { readWorldBundle } from '../world/bundle.ts'
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
import { groundOf } from './surfaces.ts'
import type { Ground, Surface } from './surfaces.ts'

export type PageWorldOptions = {
    bundle: string
    pixelsPerMetre: number
  scale: number
  seed: number
    count?: number
}

type Character = {
  name: string
  look: Look & { skin: NonNullable<Look['skin']> }
    x: number
  surface: Surface
    element: Element
  yaw: number
  view: { sector?: number }
  image?: Image
    drawn?: { left: number, top: number }
}

export type PageWorldState = {
  ground: () => Ground
  characters: () => Array<{ name: string, x: number, y: number, surface: number, yaw: number }>
  pokes: () => number
  rebuilds: () => number
}

const CAMERA_ELEVATION_DEGREES = 8
const SPRITE_BOX_IN_CHARACTER_HEIGHTS = 1.6
const FEET_LINE_SHARE_OF_BOX = 0.85
const MARGIN_FROM_SURFACE_ENDS = 0.3

export async function createPageWorld (options: PageWorldOptions): Promise<PageWorldState> {
  const read = readWorldBundle(await (await fetch(options.bundle)).json())
  if (read.value === undefined) throw new Error(read.errors.map(e => `${e.path}: ${e.message}`).join('; '))
  const { cast, looks } = read.value
  const skinned = looks.flatMap((look, i) => look.skin === undefined
    ? []
    : [{ name: cast[i].name, look: look as Character['look'] }])
  const next = random(options.seed)
  const spritePerMetre = options.pixelsPerMetre / options.scale
  const base = makeCamera({
    azimuthDeg: 0, elevationDeg: CAMERA_ELEVATION_DEGREES, targetHeightPx: spritePerMetre, modelHeight: 1, margin: 0
  })

  let marked = scan()
  let ground = groundOf(marked.map(m => m.box), options.pixelsPerMetre)
  let rebuilds = 0
  let pokes = 0
  const place = (): Character['surface'] | undefined => {
    const wide = ground.surfaces.filter(s => s.to - s.from > 2 * MARGIN_FROM_SURFACE_ENDS)
    if (wide.length === 0) return undefined
    const total = wide.reduce((sum, s) => sum + s.to - s.from, 0)
    let pick = next() * total
    for (const s of wide) {
      pick -= s.to - s.from
      if (pick <= 0) return s
    }
    return wide[wide.length - 1]
  }
  const characters: Character[] = []
  for (const { name, look } of skinned.slice(0, options.count ?? skinned.length)) {
    const surface = place()
    if (surface === undefined) break
    const usable = surface.to - surface.from - 2 * MARGIN_FROM_SURFACE_ENDS
    const x = surface.from + MARGIN_FROM_SURFACE_ENDS + usable * next()
    const element = marked[surface.id].element
    const yaw = next() < 0.5 ? Math.PI / 2 : -Math.PI / 2
    characters.push({ name, look, x, surface, element, yaw, view: {} })
  }

  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '100vw',
    height: '100vh',
    pointerEvents: 'none',
    zIndex: '2147483646',
    imageRendering: 'pixelated'
  })
  document.body.appendChild(canvas)
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('no 2d context')
  const draw2d = context
  const sprite = document.createElement('canvas')
  const spriteContext = sprite.getContext('2d')
  if (spriteContext === null) throw new Error('no 2d context')

    const render = (c: Character): { image: Image, camera: Camera } => {
    const { mannequin } = c.look.skin
    const height = Math.max(...Object.values(mannequin.joints).map(p => p[1]))
    const size = Math.ceil(SPRITE_BOX_IN_CHARACTER_HEIGHTS * height * spritePerMetre)
    const camera: Camera = { ...base, width: size, height: size, baseline: Math.round(size * FEET_LINE_SHARE_OF_BOX) }
    const root: RootState = { position: [0, 0, 0], yaw: c.yaw, velocity: [0, 0, 0], angularVelocity: 0 }
    const pose: Pose = Object.fromEntries(Object.entries(restPose(mannequin)).map(([n, p]) => [n, toWorld(p, root)]))
    const image = renderSkinned({ mannequin, pose, skin: c.look.skin.skin, camera, yaw: c.yaw, view: c.view })
    return { image, camera }
  }

  const redraw = (): void => {
    const width = window.innerWidth
    const height = window.innerHeight
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    draw2d.clearRect(0, 0, width, height)
    draw2d.imageSmoothingEnabled = false
    for (const c of characters) {
      const { image, camera } = render(c)
      c.image = image
      const left = c.x * options.pixelsPerMetre - camera.width / 2 * options.scale
      const top = -c.surface.height * options.pixelsPerMetre - camera.baseline * options.scale
      c.drawn = { left, top }
      const screenLeft = left - window.scrollX
      const screenTop = top - window.scrollY
      const w = image.width * options.scale
      const h = image.height * options.scale
      if (screenLeft > width || screenTop > height || screenLeft + w < 0 || screenTop + h < 0) continue
      sprite.width = image.width
      sprite.height = image.height
      spriteContext.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
      draw2d.drawImage(sprite, Math.round(screenLeft), Math.round(screenTop), w, h)
    }
  }

    const hit = (pageX: number, pageY: number): Character | undefined => {
    for (let i = characters.length - 1; i >= 0; i--) {
      const c = characters[i]
      if (c.image === undefined || c.drawn === undefined) continue
      const x = Math.floor((pageX - c.drawn.left) / options.scale)
      const y = Math.floor((pageY - c.drawn.top) / options.scale)
      if (getPixel(c.image, x, y) !== TRANSPARENT) return c
    }
    return undefined
  }

  document.addEventListener('click', event => {
    const c = hit(event.clientX + window.scrollX, event.clientY + window.scrollY)
    if (c === undefined) return
    event.preventDefault()
    event.stopPropagation()
    pokes++
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) c.yaw = -c.yaw
    redraw()
  }, true)

    watch(() => {
    rebuilds++
    marked = scan()
    ground = groundOf(marked.map(m => m.box), options.pixelsPerMetre)
    for (const c of characters) {
      const before = c.surface
      const index = marked.findIndex(m => m.element === c.element)
      const now = ground.surfaces.find(s => s.id === index) ?? place()
      if (now === undefined) continue
      const share = (c.x - before.from) / Math.max(1e-9, before.to - before.from)
      c.surface = now
      c.element = marked[now.id].element
      c.x = now.from + Math.min(1, Math.max(0, share)) * (now.to - now.from)
    }
    redraw()
  })
  window.addEventListener('scroll', redraw, { passive: true })
  redraw()

  return {
    ground: () => ground,
    characters: () => characters.map(c => {
      const { pixelsPerMetre } = options
      const { name, yaw } = c
      return { name, x: c.x * pixelsPerMetre, y: -c.surface.height * pixelsPerMetre, surface: c.surface.id, yaw }
    }),
    pokes: () => pokes,
    rebuilds: () => rebuilds
  }
}
