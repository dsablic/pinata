import type { Vec3 } from '../math/vec.ts'
import { readArtifact } from './artifact.ts'
import type { LiveCharacter } from './artifact.ts'
import { createLive } from './character.ts'
import type { Live, LiveFrame } from './character.ts'
import { createView, DEFAULT_VIEW, frameHash, pickHook } from './render.ts'
import type { View, ViewOptions } from './render.ts'

export { readArtifact } from './artifact.ts'
export { createLive } from './character.ts'
export { createView, DEFAULT_VIEW, frameHash } from './render.ts'

export type MountOptions = {
  /** CSS pixels per character pixel. */
  scale: number
  /** Sub-samples per pixel along each axis. */
  samples: number
  reduced: boolean
  fps: number
  substeps: number
  view: Partial<ViewOptions>
}
export type Stats = { frames: number, meanMs: number, p95Ms: number, maxMs: number }
export type Mounted = {
  character: LiveCharacter
  live: Live
  view: View
  /** Simulation and render time of the last frames, for a readout. */
  stats: () => Stats
  /** Hash of the last drawn frame (for determinism checks). */
  lastHash: () => string
  /** Advances one frame now, without waiting for the clock (tests). */
  tick: () => LiveFrame
  pause: () => void
  resume: () => void
  destroy: () => void
}

const STAT_WINDOW = 240
const DRAG_PIXELS = 4
const POKE_IMPULSE = 1.1
const POKE_SPIN = 1.8

function percentile (values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
}

/**
 * Animates a live character on a canvas: the simulation steps at a fixed rate on the animation clock, every step is
 * drawn with putImageData and scaled up with crisp pixels by CSS. A click on the character hits it from that side;
 * dragging it pulls the rope and letting go swings it from there.
 */
export function mount (
  canvas: HTMLCanvasElement,
  character: LiveCharacter,
  options: Partial<MountOptions> = {}
): Mounted {
  const settings: MountOptions = {
    scale: 3, samples: DEFAULT_VIEW.samples, reduced: false, fps: 24, substeps: 8, view: {}, ...options
  }
  const viewOptions: ViewOptions = { ...DEFAULT_VIEW, ...settings.view, samples: settings.samples }
  const live = createLive(character, character.behaviours, {
    fps: settings.fps, substeps: settings.substeps, reduced: settings.reduced, anchor: [0, 2, 0], gravity: 9.81,
    wind: [0, 0, 0]
  })
  const view = createView(character, viewOptions)
  canvas.width = viewOptions.width
  canvas.height = viewOptions.height
  canvas.style.width = `${viewOptions.width * settings.scale}px`
  canvas.style.height = `${viewOptions.height * settings.scale}px`
  canvas.style.imageRendering = 'pixelated'
  canvas.style.touchAction = 'none'
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('no 2d context')
  const times: number[] = []
  let frames = 0
  let hash = ''
  let opaque: Uint8ClampedArray = new Uint8ClampedArray(0)

  const draw = (frame: LiveFrame): void => {
    const image = view.render(frame)
    opaque = image.data
    hash = frameHash(image)
    context.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
  }
  const tick = (): LiveFrame => {
    const start = performance.now()
    const frame = live.step()
    draw(frame)
    times.push(performance.now() - start)
    if (times.length > STAT_WINDOW) times.shift()
    frames++
    return frame
  }
  draw(live.frame())

  let running = true
  let last = performance.now()
  let owed = 0
  let request = 0
  const loop = (now: number): void => {
    if (!running) return
    owed += Math.min(0.25, (now - last) / 1000)
    last = now
    const step = 1 / settings.fps
    if (owed >= step) {
      while (owed >= 2 * step) {
        live.step()
        owed -= step
      }
      tick()
      owed -= step
    }
    request = requestAnimationFrame(loop)
  }
  request = requestAnimationFrame(loop)

  const pixelAt = (event: PointerEvent): [number, number] => {
    const box = canvas.getBoundingClientRect()
    return [
      (event.clientX - box.left) * canvas.width / box.width,
      (event.clientY - box.top) * canvas.height / box.height
    ]
  }
  const onCharacter = ([x, y]: [number, number]): boolean => {
    const i = (Math.floor(y) * canvas.width + Math.floor(x)) * 4 + 3
    return opaque[i] !== undefined && opaque[i] > 0
  }
  let pressed: { at: [number, number], dragging: boolean } | undefined
  const down = (event: PointerEvent): void => {
    const at = pixelAt(event)
    if (!onCharacter(at)) return
    pressed = { at, dragging: false }
    canvas.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const move = (event: PointerEvent): void => {
    if (pressed === undefined) return
    const at = pixelAt(event)
    if (!pressed.dragging && Math.hypot(at[0] - pressed.at[0], at[1] - pressed.at[1]) < DRAG_PIXELS) return
    pressed.dragging = true
    live.grab(pickHook(view, live.frame(), viewOptions, at[0], at[1]))
  }
  const up = (event: PointerEvent): void => {
    if (pressed === undefined) return
    if (pressed.dragging) live.grab(undefined)
    else {
      const side = pressed.at[0] < viewOptions.anchorAt[0] ? 1 : -1
      const impulse: Vec3 = [side * POKE_IMPULSE, 0, 0.3]
      live.hit(impulse, side * POKE_SPIN)
    }
    pressed = undefined
    canvas.releasePointerCapture(event.pointerId)
  }
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', up)

  return {
    character,
    live,
    view,
    tick,
    lastHash: () => hash,
    stats: () => ({
      frames,
      meanMs: times.reduce((a, b) => a + b, 0) / Math.max(1, times.length),
      p95Ms: percentile(times, 0.95),
      maxMs: Math.max(0, ...times)
    }),
    pause: () => {
      running = false
      cancelAnimationFrame(request)
    },
    resume: () => {
      if (running) return
      running = true
      last = performance.now()
      request = requestAnimationFrame(loop)
    },
    destroy: () => {
      running = false
      cancelAnimationFrame(request)
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
    }
  }
}

/**
 * `<pinata-character src="unicorn.json" scale="3" samples="3">`: loads a live artifact and animates it. Page events
 * drive it: dispatch `new CustomEvent('pinata', { detail: 'toolStart' })` on the element or the window (also
 * `loading`, `thinking`, `success`, `error`, `idle`); `element.hit()`, `element.play(name)`. It honours
 * `prefers-reduced-motion` unless `motion="full"` is set, and it covers only its own box.
 */
export class PinataCharacter extends HTMLElement {
  mounted?: Mounted
  #canvas = document.createElement('canvas')
  #onEvent = (event: Event): void => {
    const name = (event as CustomEvent<unknown>).detail
    if (typeof name === 'string') this.mounted?.live.dispatch(name)
  }

  connectedCallback (): void {
    this.style.display = 'inline-block'
    this.append(this.#canvas)
    window.addEventListener('pinata', this.#onEvent)
    this.addEventListener('pinata', this.#onEvent)
    void this.#load()
  }

  disconnectedCallback (): void {
    window.removeEventListener('pinata', this.#onEvent)
    this.removeEventListener('pinata', this.#onEvent)
    this.mounted?.destroy()
  }

  hit (): void { this.mounted?.live.hit() }
  play (name: string): void { this.mounted?.live.play(name) }

  async #load (): Promise<void> {
    const src = this.getAttribute('src')
    if (src === null) throw new Error('<pinata-character> needs a src')
    const response = await fetch(src)
    const read = readArtifact(await response.json())
    if (read.value === undefined) {
      throw new Error(`${src}: ${read.errors.map(e => `${e.path}: ${e.message}`).join('; ')}`)
    }
    const reduced = this.getAttribute('motion') !== 'full' && matchMedia('(prefers-reduced-motion: reduce)').matches
    this.mounted = mount(this.#canvas, read.value, {
      scale: Number(this.getAttribute('scale') ?? 3),
      samples: Number(this.getAttribute('samples') ?? DEFAULT_VIEW.samples),
      reduced
    })
    this.dispatchEvent(new CustomEvent('pinata-ready', { bubbles: true }))
  }
}

if (typeof customElements !== 'undefined' && customElements.get('pinata-character') === undefined) {
  customElements.define('pinata-character', PinataCharacter)
}
