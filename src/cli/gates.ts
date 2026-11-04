import {
  MID_AIR_PX, PLANTED_TOLERANCE_PX, readWorld, run, scenario, standing, withoutBindings
} from '../diagnostics/page-scenarios.ts'
import type { Standing } from '../diagnostics/page-scenarios.ts'
import type { Sample } from '../page/cast.ts'
import { LAYOUTS, readLayout } from '../page/fixture.ts'
import { DROP_HEIGHTS, landings, PLANTED_TOLERANCE, REACTION_SECONDS } from '../diagnostics/landings.ts'
import type { Landings } from '../diagnostics/landings.ts'
import {
  countCastJumps, deepestInJump, FEWEST_TRIPS, jumps, runSettled, SMALLEST_SHARE_LANDED, totalJumps
} from '../diagnostics/jumps.ts'
import type { CastJumps, JumpRun, Tally } from '../diagnostics/jumps.ts'
import { flickerFraction } from '../diagnostics/stability.ts'
import type { Image } from '../image.ts'
import type { ReadWorld } from '../world/bundle.ts'
import type { LayoutSpec } from '../page/fixture.ts'
import { load, pause, withSite } from './chrome.ts'
import type { Session } from './chrome.ts'
import { ROOT } from './paths.ts'
import { worldBundle } from './world-bundle.ts'

const NODE_SECONDS = 60
const FEWEST_SUPER_JUMPS = 4
const FLICKER_LAYOUTS = ['demo-1200', 'demo-390']
const FLICKER_SEEDS = [1, 2, 3]
const FLICKER_WARMUP_SECONDS = 4
const FLICKER_SECONDS = 4
const MOST_ADDED_FLICKER = 0.01
const BROWSER_SECONDS = 20

function report (m: Standing, where: string): void {
  const line = (met: boolean, name: string, detail: string): string => {
    return `${met ? 'GATE MET' : 'GATE MISSED'} ${name} ${where} (${detail})`
  }
  console.log(line(m.off === 0, `every planted foot within ${PLANTED_TOLERANCE_PX} CSS px of its surface`,
    `${m.off} of ${m.planted} off, worst ${m.worst.toFixed(2)} px`))
  console.log(line(m.midAir === 0, 'no character in mid-air except while falling',
    `${m.midAir} of ${m.frames} frames with every foot more than ${MID_AIR_PX} px up`))
}

async function inChrome (session: Session, spec: LayoutSpec): Promise<Sample[]> {
  await load(session, { page: spec.page, width: spec.width, height: spec.height })
  await session.evaluate('window.__pinata.samples()')
  await pause(BROWSER_SECONDS * 1000)
  return await session.evaluate<Sample[]>('window.__pinata.samples()')
}

function clothFlicker (world: ReadWorld): void {
  const unbound: ReadWorld = { ...world, cast: world.cast.map(withoutBindings) }
  const sprites = (from: ReadWorld, layout: string, seed: number, name: string): Image[] => {
    const s = scenario(from, readLayout(ROOT, layout), seed)
    run(s, FLICKER_WARMUP_SECONDS)
    const images: Image[] = []
    run(s, FLICKER_SECONDS, () => {
      const d = s.cast.drawables().find(x => x.name === name)
      if (d !== undefined) images.push(d.sprite().image)
    })
    return images
  }
  const windows = FLICKER_LAYOUTS.flatMap(layout => FLICKER_SEEDS.map(seed => ({ layout, seed })))
  for (const member of world.cast.filter(m => m.cloth?.scenario.bind !== undefined)) {
    const worst = (from: ReadWorld): number[] => {
      return windows.map(({ layout, seed }) => flickerFraction(sprites(from, layout, seed, member.name)))
    }
    const rigid = worst(unbound)
    const added = worst(world).map((v, i) => v - rigid[i])
    const met = added.every(a => a <= MOST_ADDED_FLICKER)
    console.log(`${met ? 'GATE MET' : 'GATE MISSED'} ${member.name}'s drawn cloth adds at most 1% flicker in each ` +
      `${FLICKER_SECONDS} s window on ${FLICKER_LAYOUTS.join(' and ')}, seeds ${FLICKER_SEEDS.join(', ')} ` +
      `(${added.map(a => (100 * a).toFixed(2)).join(', ')}%)`)
  }
}

const SMALLEST_DEEP_KNEE = 35
const SMALLEST_DIP_CM = 4
const LARGEST_RECOVERY_SECONDS = 1.5
const [LOW, MIDDLE, HIGH] = DROP_HEIGHTS

function landingGates (all: Landings[]): void {
  const each = (values: number[], digits: number): string => values.map(v => v.toFixed(digits)).join(', ')
  const heights = DROP_HEIGHTS.join(', ')
  for (const { name, drops } of all) {
    const knees = drops.map(d => d.knee)
    const at = (height: number): number => drops.findIndex(d => d.height === height)
    const grows = knees.every((k, i) => i === 0 || k > knees[i - 1])
    const deep = knees[at(HIGH)] >= SMALLEST_DEEP_KNEE
    const dips = drops[at(MIDDLE)].dip >= SMALLEST_DIP_CM
    const under = Math.max(...drops.map(d => d.soleDepth))
    const absorbs = grows && deep && dips && under <= 100 * PLANTED_TOLERANCE
    console.log(`${absorbs ? 'GATE MET' : 'GATE MISSED'} ${name} absorbs a landing: knee flexion within ` +
      `${REACTION_SECONDS} s grows with the drop and is at least ${SMALLEST_DEEP_KNEE} degrees at ${HIGH} m, the ` +
      `pelvis dips at least ${SMALLEST_DIP_CM} cm at ${MIDDLE} m, no sole more than ${(100 * PLANTED_TOLERANCE)
        .toFixed(1)} cm under (drops of ${heights} m: knee ${each(knees, 0)} degrees, pelvis dip ` +
      `${each(drops.map(d => d.dip), 1)} cm, deepest sole ${each(drops.map(d => d.soleDepth), 1)} cm)`)
    const recoveries = drops.map(d => d.recovery)
    const recovers = recoveries.every(r => r <= LARGEST_RECOVERY_SECONDS)
    console.log(`${recovers ? 'GATE MET' : 'GATE MISSED'} ${name} is walking or resting normally within ` +
      `${LARGEST_RECOVERY_SECONDS} s of a landing (drops of ${heights} m: ${each(recoveries, 2)} s, ${LOW} m first)`)
  }
}

function jumpGates (runs: JumpRun[]): void {
  const shown = (t: Tally): string => {
    return `${t.arrived} of ${t.trips} trips, ${t.jumps.landed} of ${t.jumps.planned} jumps, ${t.climbs} climbs`
  }
  for (const run of runs) {
    const { synthetic: a, recorded: b } = run
    const trips = a.trips + b.trips
    const arrived = a.arrived + b.arrived
    const climbs = a.climbs + b.climbs
    const deepest = Math.max(a.deepest, b.deepest)
    const met = trips >= FEWEST_TRIPS && arrived >= SMALLEST_SHARE_LANDED * trips && climbs === 0 &&
      deepest <= PLANTED_TOLERANCE
    const verdict = met ? 'GATE MET' : 'GATE MISSED'
    console.log(`${verdict} ${run.name}: at least ${100 * SMALLEST_SHARE_LANDED}% of planned jumps land on the ` +
      `surface they aim for (a planned jump is a visit to a top that needs one; refusals, time-outs and short ` +
      `landings are misses), nobody climbs a rise above the jump height of ` +
      `${run.jumpHeight.toFixed(2)} m, and no sole goes more than ` +
      `${(100 * PLANTED_TOLERANCE).toFixed(1)} cm under a surface in a jump (${arrived} of ${trips} trips, at least ` +
      `${FEWEST_TRIPS}; ${climbs} climbs; deepest sole ${(100 * deepest).toFixed(1)} cm; recorded jump page: ` +
      `${shown(b)}; synthetic grounds: ${shown(a)})`)
  }
}

const SMALLEST_CROUCH_SHARE = 0.1
const SMALLEST_WRIST_SHARE = 0.15

function jumpTakeGates (runs: JumpRun[]): void {
  const percent = (value: number): string => (100 * value).toFixed(1)
  for (const run of runs) {
    const crouches = [...run.synthetic.crouches, ...run.recorded.crouches]
    const strays = run.synthetic.strays + run.recorded.strays
    const drop = Math.min(...crouches.map(c => c.drop)) / run.legLength
    const wrist = Math.min(...crouches.map(c => c.wrist)) / run.armLength
    const used = Object.entries(run.synthetic.takes).map(([name, n]) => `${name} ${n}`).join(', ')
    const crouched = crouches.length > 0 && drop >= SMALLEST_CROUCH_SHARE && wrist >= SMALLEST_WRIST_SHARE
    const where = `${run.name}: ${crouches.length} planned jumps`
    console.log(`${strays === 0 ? 'GATE MET' : 'GATE MISSED'} walking never plays a jump take outside a jump ` +
      `(${where}, ${strays} take frames outside a jump command to the end of its landing)`)
    console.log(`${crouched ? 'GATE MET' : 'GATE MISSED'} a real crouch: in every planned jump the pelvis drops ` +
      `at least ${100 * SMALLEST_CROUCH_SHARE}% of the leg length before lift-off and a wrist travels at least ` +
      `${100 * SMALLEST_WRIST_SHARE}% of the arm length between crouch and flight (${where}: smallest drop ` +
      `${percent(drop)}% of ${run.legLength.toFixed(2)} m, smallest wrist travel ${percent(wrist)}% of ` +
      `${run.armLength.toFixed(2)} m; takes on the synthetic grounds: ${used})`)
  }
}

function eachOf (counts: CastJumps[]): string {
  return counts.map(c => `${c.name} ${c.jumps.landed} of ${c.jumps.planned}`).join(', ')
}

function superJumpGates (world: ReadWorld): void {
  for (const spec of LAYOUTS.filter(l => l.name !== 'jumps')) {
    const s = scenario(world, readLayout(ROOT, spec.name), undefined, 0, false, 'strip', 'super')
    const { samples, ends } = runSettled(s, NODE_SECONDS)
    const counts = countCastJumps(samples, ends)
    const { planned, landed } = totalJumps(counts)
    const each = eachOf(counts)
    const deepest = deepestInJump(samples)
    const met = planned >= FEWEST_SUPER_JUMPS && landed >= SMALLEST_SHARE_LANDED * planned &&
      deepest <= PLANTED_TOLERANCE_PX
    console.log(`${met ? 'GATE MET' : 'GATE MISSED'} super jumps on ${spec.name} over ${NODE_SECONDS} s: at least ` +
      `${FEWEST_SUPER_JUMPS} planned jumps, at least ${100 * SMALLEST_SHARE_LANDED}% landed on the surface they ` +
      `aim for, and no sole more than ${PLANTED_TOLERANCE_PX} CSS px under a surface in a jump (${landed} of ` +
      `${planned} landed: ${each}; deepest sole ${deepest.toFixed(2)} px)`)
  }
}

function recordedJumps (world: ReadWorld): void {
  for (const spec of LAYOUTS) {
    const s = scenario(world, readLayout(ROOT, spec.name))
    run(s, NODE_SECONDS)
    const counts = countCastJumps(s.cast.samples())
    const { planned, landed } = totalJumps(counts)
    const each = eachOf(counts)
    console.log(`jumps on ${spec.name} over ${NODE_SECONDS} s: ${landed} of ${planned} planned jumps landed on ` +
      `their surface (${each})`)
  }
}

async function main (): Promise<number> {
  if (process.argv.includes('--browser')) {
    await withSite(async session => {
      for (const spec of LAYOUTS) {
        report(standing(await inChrome(session, spec)), `on ${spec.name} in Chrome over ${BROWSER_SECONDS} s`)
      }
    })
    return 0
  }
  const world = readWorld(worldBundle())
  if (process.argv.includes('--landings')) {
    landingGates(landings(world))
    return 0
  }
  if (process.argv.includes('--jumps')) {
    jumpGates(jumps(world, [readLayout(ROOT, 'jumps')]))
    recordedJumps(world)
    return 0
  }
  if (process.argv.includes('--jump-takes')) {
    jumpTakeGates(jumps(world, [readLayout(ROOT, 'jumps')]))
    return 0
  }
  if (process.argv.includes('--super-jumps')) {
    superJumpGates(world)
    return 0
  }
  clothFlicker(world)
  for (const spec of LAYOUTS) {
    const s = scenario(world, readLayout(ROOT, spec.name))
    run(s, NODE_SECONDS)
    report(standing(s.cast.samples()), `on ${spec.name} over ${NODE_SECONDS} s`)
  }
  landingGates(landings(world))
  jumpGates(jumps(world, [readLayout(ROOT, 'jumps')]))
  recordedJumps(world)
  superJumpGates(world)
  return 0
}

process.exitCode = await main()
