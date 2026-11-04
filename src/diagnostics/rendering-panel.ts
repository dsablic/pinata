import type { Image } from '../image.ts'
import { FPS, pageCamera } from '../page/cast.ts'
import { readLayout } from '../page/fixture.ts'
import { LANDING_RECOVERY_SECONDS } from '../mocap/player.ts'
import { facingAngle } from '../style/views.ts'
import type { ReadWorld } from '../world/bundle.ts'
import { countMotion, emptyTally, stressDriver, TURN_SECONDS } from './glitches.ts'
import type { SurveyRun, Track } from './glitches.ts'
import { run, scenario } from './page-scenarios.ts'
import type { Scenario } from './page-scenarios.ts'

export type MotionKind = 'walk' | 'turn' | 'fall'
export type Step = {
  falling: boolean
  activity: string
  onSurface: boolean
  yaw: number
  speed: number
  planted: boolean
  side: boolean
}
export type PanelWindow = {
  character: string
  kind: string
  run: SurveyRun
  seed: number
  frames: number[]
}
export type Strips = { current: Image[], later: Image[], page: Image[] }

export const KINDS: MotionKind[] = ['walk', 'turn', 'fall']
export const WALK_FRAMES = 4
export const MOST_FRAMES = 4
export const BEFORE_FALL = 3
export const STEADY_BEFORE_FALL = 12
export const AFTER_LANDING = 4
export const AFTER_TURN = 4
export const EARLIEST_SECONDS = 4
export const STRIDE_FRAMES = 8
export const SHORTEST_STRIDE = 8
export const LONGEST_STRIDE = 48
export const AIRBORNE_BEFORE_LANDING = 2
export const AFTER_TOUCHDOWN = 5
const WALKING_SPEED = 0.3
const TURN_STARTED = 0.05
const SIDE_TOLERANCE = Math.PI / 8

const earliest = EARLIEST_SECONDS * FPS

export function sampled (first: number, last: number, most = MOST_FRAMES): number[] {
  const count = last - first + 1
  if (count <= most) return Array.from({ length: count }, (_, k) => first + k)
  return Array.from({ length: most }, (_, k) => first + Math.round(k * (count - 1) / (most - 1)))
}

function walking (step: Step): boolean {
  return !step.falling && step.onSurface && step.speed > WALKING_SPEED
}

export function walkWindow (steps: Step[]): number[] | undefined {
  for (let i = earliest; i + WALK_FRAMES <= steps.length; i++) {
    if (steps.slice(i, i + WALK_FRAMES).every(walking)) return sampled(i, i + WALK_FRAMES - 1)
  }
  return undefined
}

function walkedOff (steps: Step[], i: number): boolean {
  const before = steps.slice(i - STEADY_BEFORE_FALL, i)
  const steady = before.length === STEADY_BEFORE_FALL && before.every(s => !s.falling && s.onSurface)
  return steady && steps[i].falling && steps[i].activity !== 'drop' && before.every(s => s.activity !== 'drop')
}

export function fallWindow (steps: Step[]): number[] | undefined {
  for (let i = Math.max(earliest, STEADY_BEFORE_FALL); i < steps.length; i++) {
    if (!walkedOff(steps, i)) continue
    const landed = steps.findIndex((step, k) => k > i && !step.falling)
    if (landed >= 0) return sampled(i - BEFORE_FALL, Math.min(steps.length - 1, landed + AFTER_LANDING))
  }
  return undefined
}

const turnedBy = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

export function turnWindow (steps: Step[]): number[] | undefined {
  const track: Track = { seen: [], yaws: [], speeds: [] }
  const tally = emptyTally()
  const longest = Math.round(TURN_SECONDS * FPS)
  for (let i = 0; i < steps.length; i++) {
    const turns = tally.turns
    countMotion(track, tally, steps[i].falling, steps[i].yaw, steps[i].speed)
    if (tally.turns === turns) continue
    const from = Math.max(0, i - longest)
    const started = steps.findIndex((step, k) => k >= from && turnedBy(step.yaw, steps[from].yaw) > TURN_STARTED)
    const first = Math.max(from, started - 1)
    if (first >= earliest) return sampled(first, Math.min(steps.length - 1, i + AFTER_TURN))
  }
  return undefined
}

export type Finders = Record<string, (steps: Step[]) => number[] | undefined>

const FINDERS: Finders = { walk: walkWindow, turn: turnWindow, fall: fallWindow }

function plantings (steps: Step[]): number[] {
  return steps.flatMap((step, i) => step.planted && i > 0 && !steps[i - 1].planted ? [i] : [])
}

function steadyStride (steps: Step[], from: number, to: number): boolean {
  return steps.slice(from, to + 1).every(step => walking(step) && step.side)
}

function recovered (steps: Step[], i: number): boolean {
  return steps.slice(Math.max(0, i - Math.ceil(LANDING_RECOVERY_SECONDS * FPS)), i).every(step => !step.falling)
}

export function strideWindow (steps: Step[]): number[] | undefined {
  const starts = plantings(steps).filter(i => i >= earliest && recovered(steps, i))
  for (let k = 0; k + 1 < starts.length; k++) {
    const [from, to] = [starts[k], starts[k + 1]]
    const length = to - from
    if (length < SHORTEST_STRIDE || length > LONGEST_STRIDE || !steadyStride(steps, from, to)) continue
    return Array.from({ length: STRIDE_FRAMES }, (_, j) => from + Math.round(j * length / STRIDE_FRAMES))
  }
  return undefined
}

export function landingWindow (steps: Step[]): number[] | undefined {
  const count = AIRBORNE_BEFORE_LANDING + 1 + AFTER_TOUCHDOWN
  for (let i = Math.max(earliest, STEADY_BEFORE_FALL); i < steps.length; i++) {
    if (!walkedOff(steps, i)) continue
    const landed = steps.findIndex((step, k) => k > i && !step.falling)
    const first = landed - AIRBORNE_BEFORE_LANDING
    if (landed < 0 || first < i || landed + AFTER_TOUCHDOWN >= steps.length) continue
    return Array.from({ length: count }, (_, j) => first + j)
  }
  return undefined
}

export const GAME_FINDERS: Finders = { walk: strideWindow, landing: landingWindow }

export function windowsIn (
  world: ReadWorld, runs: SurveyRun[], root: string, finders: Finders = FINDERS
): PanelWindow[] {
  const names = world.cast.filter((_, i) => world.looks[i].skin !== undefined).map(m => m.name)
  const wanted = names.flatMap(character => Object.keys(finders).map(kind => ({ character, kind })))
  const found: PanelWindow[] = []
  for (const r of runs) {
    const fixture = readLayout(root, r.layout)
    const seed = r.seed ?? fixture.seed
    const s = scenario(world, fixture, seed, r.wind ?? 0)
    const steps = new Map<string, Step[]>()
    const camera = pageCamera(1)
    const stress = stressDriver(s, r.stress)
    run(s, r.seconds, step => {
      stress(step)
      for (const { name, frame } of s.cast.moving()) {
        const list = steps.get(name) ?? []
        steps.set(name, list)
        const { yaw, velocity } = frame.root
        list[step] = {
          falling: frame.falling,
          activity: frame.activity,
          onSurface: frame.support !== undefined,
          yaw,
          speed: Math.hypot(velocity[0], velocity[2]),
          planted: frame.feet[0]?.planted ?? false,
          side: Math.abs(Math.abs(facingAngle(camera, yaw)) - Math.PI / 2) < SIDE_TOLERANCE
        }
      }
    })
    for (const { character, kind } of wanted) {
      if (found.some(w => w.character === character && w.kind === kind)) continue
      const frames = finders[kind](steps.get(character) ?? [])
      if (frames !== undefined) found.push({ character, kind, run: r, seed, frames })
    }
  }
  return found
}

function sameMotion (a: Scenario, b: Scenario, step: number): void {
  const movers = (s: Scenario): string => JSON.stringify(s.cast.moving().map(m => [m.name, m.frame.root]))
  if (movers(a) !== movers(b)) throw new Error(`the painters moved the cast differently at step ${step}`)
}

export function render (world: ReadWorld, windows: PanelWindow[], root: string): Map<PanelWindow, Strips> {
  const strips = new Map<PanelWindow, Strips>()
  const runs = [...new Set(windows.map(w => w.run))]
  for (const r of runs) {
    const own = windows.filter(w => w.run === r)
    const fixture = readLayout(root, r.layout)
    const seed = r.seed ?? fixture.seed
    const [page, current] = (['strip', 'rotate'] as const).map(painter => {
      return scenario(world, fixture, seed, r.wind ?? 0, false, painter)
    })
    const drivers = [page, current].map(s => stressDriver(s, r.stress))
    const kept = new Map<string, Image>()
    const wanted = (name: string, step: number): boolean => {
      return own.some(w => w.character === name && w.frames.some(f => f === step || f + 1 === step))
    }
    run(page, r.seconds, step => {
      current.cast.advance(1 / FPS, current.viewport, true)
      drivers.forEach(driver => driver(step))
      sameMotion(page, current, step)
      for (const [label, s] of [['page', page], ['current', current]] as const) {
        for (const d of s.cast.drawables()) {
          const image = d.sprite().image
          if (wanted(d.name, step)) kept.set(`${label} ${d.name} ${step}`, image)
        }
      }
    })
    for (const w of own) {
      const at = (label: string, shift: number): Image[] => {
        return w.frames.map(f => kept.get(`${label} ${w.character} ${f + shift}`) as Image)
      }
      strips.set(w, { page: at('page', 0), current: at('current', 0), later: at('current', 1) })
    }
  }
  return strips
}
