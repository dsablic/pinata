import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { worldBundle } from '../../src/cli/world-bundle.ts'
import { ROOT } from '../../src/cli/paths.ts'
import { readWorld, run, scenario } from '../../src/diagnostics/page-scenarios.ts'
import type { Pixel, WalkFrame } from '../../src/formats/skin.ts'
import { parseHex } from '../../src/image.ts'
import type { Image } from '../../src/image.ts'
import { readLayout } from '../../src/page/fixture.ts'
import { anchorHeight } from '../../src/page/cast.ts'
import { project } from '../../src/raster/camera.ts'
import type { Camera } from '../../src/raster/camera.ts'
import type { WalkerFrame } from '../../src/page/walker.ts'

const LAYOUT = 'page-test'
const SECONDS = 60
const FRAMES = Number(process.argv[2] ?? 8)
const LEAST_CYCLE_TICKS = 16
const STEADY_SPEED = 1
const LIFTED_TICKS = 4
const OUT = join(ROOT, 'test', 'fixtures', 'walk-frames')

type Tick = { image: Image, camera: Camera, frame: WalkerFrame }
type Bounds = { left: number, top: number, right: number, bottom: number }

function steadyCycle (ticks: Array<Tick | undefined>): Tick[] {
  const lifted = (i: number): boolean => ticks.slice(i - LIFTED_TICKS, i).every(t => t?.frame.feet[0].planted === false)
  const starts = ticks.flatMap((t, i) => i >= LIFTED_TICKS && t?.frame.feet[0].planted === true && lifted(i) ? [i] : [])
  for (let k = 0; k + 1 < starts.length; k++) {
    const cycle = ticks.slice(starts[k], starts[k + 1])
    const steady = cycle.every(t => t !== undefined && !t.frame.falling && t.frame.root.yaw > 0 &&
      Math.hypot(t.frame.root.velocity[0], t.frame.root.velocity[2]) >= STEADY_SPEED)
    if (steady && cycle.length >= LEAST_CYCLE_TICKS) return cycle as Tick[]
  }
  throw new Error('no steady walking cycle found')
}

function solePixel (t: Tick, foot: number): Pixel {
  const [x, , z] = t.frame.root.position
  const y = anchorHeight(t.frame)
  const points = t.frame.feet[foot].soles.map(([sx, sy]) => project(t.camera, [sx - x, sy - y, -z]))
  const lowest = Math.max(...points.map(p => p.y))
  return [Math.floor(points.reduce((sum, p) => sum + p.x, 0) / points.length), Math.ceil(lowest) - 1]
}

function plantedFoot (cycle: Tick[], at: number): 0 | 1 {
  const heldFor = (foot: number): number => {
    let length = 0
    for (let i = at; i >= 0 && cycle[i].frame.feet[foot].planted; i--) length++
    return length
  }
  const planted = [0, 1].filter(foot => cycle[at].frame.feet[foot].planted)
  if (planted.length === 0) return 0
  return planted.reduce((a, b) => heldFor(b) > heldFor(a) ? b : a) as 0 | 1
}

function boundsOf (image: Image): Bounds {
  const found = { left: image.width, top: image.height, right: -1, bottom: -1 }
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] === 0) continue
      found.left = Math.min(found.left, x)
      found.right = Math.max(found.right, x)
      found.top = Math.min(found.top, y)
      found.bottom = Math.max(found.bottom, y)
    }
  }
  return found
}

function keyAt (image: Image, x: number, y: number, keys: Map<number, string>): string {
  const i = (y * image.width + x) * 4
  if (image.data[i + 3] === 0) return '.'
  const key = keys.get((image.data[i] << 16) | (image.data[i + 1] << 8) | image.data[i + 2])
  if (key === undefined) throw new Error(`the colour at ${x},${y} is not in the palette`)
  return key
}

function main (): void {
  const world = readWorld(worldBundle())
  const own = world.looks[world.cast.findIndex(m => m.name === 'knight')].skin
  if (own === undefined) throw new Error('the knight has no skin')
  const keys = new Map(Object.entries(own.skin.palette).map(([key, hex]) => [parseHex(hex), key]))
  const s = scenario(world, readLayout(ROOT, LAYOUT))
  const ticks: Array<Tick | undefined> = []
  run(s, SECONDS, () => {
    const d = s.cast.drawables().find(x => x.name === 'knight')
    const m = s.cast.moving().find(x => x.name === 'knight')
    if (d === undefined || m === undefined) {
      ticks.push(undefined)
      return
    }
    const sprite = d.sprite()
    ticks.push({ image: sprite.image, camera: sprite.camera, frame: m.frame })
  })
  const cycle = steadyCycle(ticks)
  const chosen = Array.from({ length: FRAMES }, (_, k) => Math.floor(k * cycle.length / FRAMES))
  const boxes = chosen.map(i => boundsOf(cycle[i].image))
  const left = Math.min(...boxes.map(b => b.left))
  const top = Math.min(...boxes.map(b => b.top))
  const right = Math.max(...boxes.map(b => b.right))
  const bottom = Math.max(...boxes.map(b => b.bottom))
  const frames = chosen.map((i): WalkFrame => {
    const t = cycle[i]
    const rows: string[] = []
    for (let y = top; y <= bottom; y++) {
      let row = ''
      for (let x = left; x <= right; x++) row += keyAt(t.image, x, y, keys)
      rows.push(row)
    }
    const shift = ([x, y]: Pixel): Pixel => [x - left, y - top]
    return { rows, soles: [shift(solePixel(t, 0)), shift(solePixel(t, 1))], planted: plantedFoot(cycle, i) }
  })
  mkdirSync(OUT, { recursive: true })
  const file = join(OUT, 'knight-side.json')
  writeFileSync(file, `${JSON.stringify({ frames })}\n`)
  const size = `${right - left + 1}x${bottom - top + 1}`
  console.log(`${file}: ${frames.length} frames of ${size}, from a cycle of ${cycle.length} ticks`)
}

main()
