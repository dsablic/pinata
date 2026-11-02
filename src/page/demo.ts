import { createPageWorld } from './page.ts'
import type { PageWorld } from './page.ts'

const BUNDLE = 'world.bundle.json'
const PIXELS_PER_METRE = 54
const SCALE = 2
const READOUT_MS = 1000

function byId<T extends HTMLElement> (id: string): T {
  const element = document.getElementById(id)
  if (element === null) throw new Error(`#${id} is missing`)
  return element as T
}

const count = byId<HTMLSelectElement>('count')
const seed = byId<HTMLInputElement>('seed')
const readout = byId<HTMLElement>('readout')
const timing = byId<HTMLInputElement>('timing')
let world: PageWorld | undefined
let starting: Promise<void> | undefined

async function start (): Promise<void> {
  world?.destroy()
  world = undefined
  Object.assign(globalThis, { __pinata: undefined })
  world = await createPageWorld({
    bundle: BUNDLE,
    pixelsPerMetre: PIXELS_PER_METRE,
    scale: SCALE,
    seed: Number(seed.value) || 1,
    count: Number(count.value),
    measure: new URLSearchParams(location.search).has('measure')
  })
  Object.assign(globalThis, { __pinata: world })
}

function restart (): void {
  starting = (starting ?? Promise.resolve()).then(start).catch(error => {
    readout.textContent = `could not start: ${String(error)}`
  })
}

function report (): void {
  if (world === undefined || !timing.checked) return
  const costs = world.costs().sort((a, b) => a - b)
  const p95 = costs[Math.floor(0.95 * (costs.length - 1))] ?? 0
  const doing = world.characters().map(c => `${c.name} ${c.activity}`).join(', ')
  readout.textContent = `${p95.toFixed(1)} ms per frame (p95) · ${doing}`
}

byId<HTMLButtonElement>('restart').addEventListener('click', restart)
timing.addEventListener('change', () => { readout.textContent = timing.checked ? 'measuring…' : '' })
count.addEventListener('change', restart)
seed.addEventListener('change', restart)
restart()
setInterval(report, READOUT_MS)
