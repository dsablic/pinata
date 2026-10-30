import { readWorldBundle } from './bundle.ts'
import type { ReadWorld } from './bundle.ts'
import type { Palette } from './config.ts'
import { createWorldView } from './render.ts'
import { createWorld } from './world.ts'
import type { World, WorldFrame } from './world.ts'

const FPS = 24
const SCALE = 2
const POKE_RADIUS_PX = 18
const STAT_WINDOW = 120

function byId<T extends HTMLElement> (id: string): T {
  const element = document.getElementById(id)
  if (element === null) throw new Error(`#${id} is missing`)
  return element as T
}

type Running = {
  world: World
  setPalette: (palette: Palette) => void
  render: (frame: WorldFrame) => ImageData
  screen: (p: [number, number, number]) => [number, number]
}

const canvas = byId<HTMLCanvasElement>('world')
const context = canvas.getContext('2d')
if (context === null) throw new Error('no 2d context')
const draw = context
let data: ReadWorld | undefined
let running: Running | undefined
let last: WorldFrame | undefined
const times: number[] = []

/** Builds a world from the controls: the seed, how many of the cast, and the render samples. */
function build (): void {
  if (data === undefined) return
  const seed = Number(byId<HTMLInputElement>('seed').value) || 1
  const count = Number(byId<HTMLInputElement>('count').value)
  const samples = Number(byId<HTMLInputElement>('samples').value)
  const hills = Number(byId<HTMLInputElement>('hills').value)
  const config = {
    ...data.config,
    cast: data.config.cast.slice(0, count),
    terrain: { ...data.config.terrain, maxHeight: hills },
    view: { ...data.config.view, samples }
  }
  const cast = data.cast.slice(0, count)
  const world = createWorld({ seed, cast, config, fps: FPS })
  const scene = byId<HTMLSelectElement>('scene').value || config.view.scene
  const view = createWorldView(world.terrain, data.looks.slice(0, count), {
    ...config.view,
    depth: 2 * world.lanes + 0.8,
    extent: world.extent,
    glyphs: config.glyphs,
    palette: config.scenes[scene]
  })
  const { width, height } = view.camera
  canvas.width = width
  canvas.height = height
  canvas.style.width = `${width * SCALE}px`
  canvas.style.height = `${height * SCALE}px`
  weather(world)
  running = {
    world,
    setPalette: view.setPalette,
    screen: view.screen,
    render: frame => {
      const image = view.render(frame)
      return new ImageData(new Uint8ClampedArray(image.data), image.width, image.height)
    }
  }
  times.length = 0
}

function tick (): void {
  if (running === undefined) return
  const start = performance.now()
  last = running.world.step()
  draw.putImageData(running.render(last), 0, 0)
  times.push(performance.now() - start)
  if (times.length > STAT_WINDOW) times.shift()
}

let owed = 0
let previous = performance.now()
function loop (now: number): void {
  owed += Math.min(0.25, (now - previous) / 1000)
  previous = now
  if (owed >= 1 / FPS) {
    owed %= 1 / FPS
    tick()
  }
  requestAnimationFrame(loop)
}

canvas.addEventListener('click', event => {
  if (running === undefined || last === undefined) return
  const box = canvas.getBoundingClientRect()
  const x = (event.clientX - box.left) * canvas.width / box.width
  const y = (event.clientY - box.top) * canvas.height / box.height
  let best = -1
  let bestDistance = POKE_RADIUS_PX
  last.actors.forEach((actor, i) => {
    const [px, py] = running!.screen(actor.root.position)
    const distance = Math.hypot(px - x, py - 10 - y)
    if (distance < bestDistance) {
      best = i
      bestDistance = distance
    }
  })
  if (best < 0) return
  const poked = last.actors[best].root.position
  const side = x < running.screen(poked)[0] ? -1 : 1
  running.world.poke(best, poked[0] + side * 0.5)
})

/** Copies the environment sliders into the running world; cloth reads them every frame. */
function weather (world: World): void {
  world.environment.wind.speed = Math.abs(Number(byId<HTMLInputElement>('wind').value))
  world.environment.wind.direction = [Math.sign(Number(byId<HTMLInputElement>('wind').value)) || 1, 0, 0]
  world.environment.wind.gust = Number(byId<HTMLInputElement>('gust').value)
  world.environment.gravity = Number(byId<HTMLInputElement>('gravity').value)
}

for (const id of ['count', 'samples', 'hills', 'wind', 'gust', 'gravity']) {
  byId<HTMLInputElement>(id).addEventListener('input', event => {
    byId<HTMLOutputElement>(`${id}Out`).value = (event.target as HTMLInputElement).value
    if (['wind', 'gust', 'gravity'].includes(id)) {
      if (running !== undefined) weather(running.world)
    } else build()
  })
}
byId<HTMLSelectElement>('scene').addEventListener('change', event => {
  const name = (event.target as HTMLSelectElement).value
  const palette = data?.config.scenes[name]
  if (palette !== undefined) running?.setPalette(palette)
  document.body.style.background = palette?.sky ?? ''
})
byId<HTMLButtonElement>('new').addEventListener('click', () => {
  byId<HTMLInputElement>('seed').value = String(1 + Math.floor(Math.random() * 9999))
  build()
})
byId<HTMLInputElement>('seed').addEventListener('change', build)
window.setInterval(() => {
  if (times.length === 0 || last === undefined) return
  const sorted = [...times].sort((a, b) => a - b)
  const mean = times.reduce((a, b) => a + b, 0) / times.length
  const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))]
  const count = last.actors.length
  byId<HTMLDivElement>('readout').textContent = `${count} characters · frame ${mean.toFixed(1)} ms mean, ` +
    `${p95.toFixed(1)} ms p95 (budget 40 ms)`
  byId<HTMLUListElement>('doing').replaceChildren(...last.actors.map(actor => {
    const item = document.createElement('li')
    item.textContent = `${actor.name}: ${actor.activity}`
    return item
  }))
}, 500)

void (async () => {
  const read = readWorldBundle(await (await fetch('world.bundle.json')).json())
  if (read.value === undefined) throw new Error(read.errors.map(e => `${e.path}: ${e.message}`).join('; '))
  data = read.value
  const scene = byId<HTMLSelectElement>('scene')
  scene.replaceChildren(...Object.keys(data.config.scenes).map(name => {
    const option = document.createElement('option')
    option.textContent = name
    return option
  }))
  scene.value = data.config.view.scene
  const count = byId<HTMLInputElement>('count')
  count.max = String(data.cast.length)
  count.value = String(data.cast.length)
  byId<HTMLOutputElement>('countOut').value = count.value
  build()
  requestAnimationFrame(loop)
})()
