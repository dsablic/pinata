import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateMannequin } from '../../src/formats/mannequin.ts'
import type { Mannequin } from '../../src/formats/mannequin.ts'
import { checkRig, validateRig } from '../../src/formats/rig.ts'
import type { Rig } from '../../src/formats/rig.ts'
import { validateScenario } from '../../src/formats/sim.ts'
import type { Scenario } from '../../src/formats/sim.ts'
import { validateStyle } from '../../src/formats/style.ts'
import { formatErrors } from '../../src/formats/validate.ts'
import type { Validated } from '../../src/formats/validate.ts'
import { planGait } from '../../src/motion/gait.ts'
import type { GaitFrame } from '../../src/motion/gait.ts'
import * as metrics from '../../src/motion/metrics.ts'
import type { LocomotionRecording } from '../../src/motion/metrics.ts'
import { posedMannequin, restPose } from '../../src/motion/pose.ts'
import type { Pose } from '../../src/motion/pose.ts'
import { createRootTrack, scriptDuration } from '../../src/motion/script.ts'
import { planSkating } from '../../src/motion/skating.ts'
import { fitCamera } from '../../src/raster/camera.ts'
import { rasterize } from '../../src/raster/gbuffer.ts'
import { stylize } from '../../src/style/stylize.ts'
import { footprintTrace, legOnionSkin, pixelStrip } from '../../src/diagnostics/locomotion-images.ts'
import { sheet } from '../../src/diagnostics/images.ts'
import { evaluate, summarize, writeOutput } from '../../src/diagnostics/report.ts'
import { encodePng } from '../../src/png/encode.ts'
import { gate, SCENARIOS } from './gates.ts'

const METRES_PER_PIXEL = 1.8 / 48
const FOOTPRINT_SIZE = 384
const ONION = { width: 480, height: 270, seconds: 1, every: 2 }
const STRIP = { frames: 8, elevationDeg: 0, targetHeightPx: 48, scale: 6, gap: 4 }
const DIRECTIONS = { count: 8, elevationDeg: 30, targetHeightPx: 48, scale: 6, gap: 4 }
const STYLE_FILE = join('..', 'p1-static-style', 'style.json')
const BACKGROUND = 0xf7f7f7
const CHILD_TIMEOUT_MS = 120000

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', '..', 'reports', 'p4')
const hashesMode = process.argv.includes('--hashes')

if (!hashesMode) rmSync(outDir, { recursive: true, force: true })

function fail (message: string): never {
  console.error(message)
  if (!hashesMode) writeOutput(join(outDir, 'summary.txt'), `automated gates: ERROR\n${message}\n`)
  process.exit(2)
}

process.on('uncaughtException', err => {
  try {
    fail(err instanceof Error ? (err.stack ?? err.message) : String(err))
  } catch {
    process.exit(2)
  }
})

function requireValid<T> (file: string, result: Validated<T>): T {
  if (result.value === undefined || result.errors.length > 0) fail(formatErrors(file, result.errors))
  return result.value
}

function loadJson (file: string): unknown {
  try {
    return JSON.parse(readFileSync(join(here, file), 'utf8'))
  } catch (err) {
    if (err instanceof SyntaxError) fail(`${file}: invalid JSON: ${err.message}`)
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') fail(`${file}: file not found`)
    throw err
  }
}

const rig: Rig = requireValid('rig.json', validateRig(loadJson('rig.json')))
const style = requireValid(STYLE_FILE, validateStyle(loadJson(STYLE_FILE)))
const scenarios = SCENARIOS.map(name => requireValid(`${name}.json`, validateScenario(loadJson(`${name}.json`))))
const mannequins = new Map<string, Mannequin>()
for (const scenario of scenarios) {
  const body = requireValid(scenario.body, validateMannequin(loadJson(scenario.body)))
  const errors = checkRig(rig, body)
  if (errors.length > 0) fail(formatErrors('rig.json', errors))
  mannequins.set(scenario.name, body)
}

type Run = { scenario: Scenario, mannequin: Mannequin, frames: GaitFrame[], recording: LocomotionRecording }

function plan (scenario: Scenario, planner: typeof planGait): Run {
  const mannequin = mannequins.get(scenario.name) as Mannequin
  const rest = restPose(mannequin)
  const fps = scenario.fps
  const frames = planner({
    track: createRootTrack(scenario.script), rig, rest, mannequin, duration: scriptDuration(scenario.script), fps
  })
  return { scenario, mannequin, frames, recording: metrics.recordLocomotion(frames, { rig, rest, mannequin, fps }) }
}

const runs = scenarios.map(scenario => plan(scenario, planGait))

function runHashes (run: Run): Array<[string, string]> {
  return metrics.frameHashes(run.recording).map((hash, i) => [`${run.scenario.name}#${i}`, hash])
}

if (hashesMode) {
  for (const run of runs) for (const [id, hash] of runHashes(run)) console.log(`${id} ${hash}`)
  process.exit(0)
}

function childHashes (): Map<string, string> {
  const output = execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--hashes'], {
    encoding: 'utf8', timeout: CHILD_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024
  })
  return new Map(output.split('\n').filter(l => l !== '').map(l => l.split(' ') as [string, string]))
}

function frameOf (run: Run, time: number): number {
  return Math.min(run.recording.frames.length - 1, Math.max(0, Math.round(time * run.scenario.fps)))
}

function steadyMiddle (run: Run): number {
  const [first] = metrics.steadySegments(run.scenario.script)
  if (first === undefined) return fail(`${run.scenario.name}.json: the script has no steady move segment`)
  return (first.start + first.end) / 2
}

const geometry = (run: Run): metrics.Geometry => ({ rig, mannequin: run.mannequin })

function evaluateRun (run: Run): Record<string, number> {
  const rest = restPose(run.mannequin)
  const g = geometry(run)
  const steady = metrics.steadySegments(run.scenario.script)
  return {
    footSlidePx: metrics.footSlidePx(run.recording, g, METRES_PER_PIXEL),
    groundPenetrationPx: metrics.groundPenetrationPx(run.recording, g, METRES_PER_PIXEL),
    partGroundPenetrationPx: metrics.partGroundPenetrationPx(run.recording, {
      mannequin: run.mannequin, rig, metresPerPixel: METRES_PER_PIXEL
    }),
    reachViolations: metrics.reachViolations(run.recording),
    kneeLimitViolations: metrics.kneeLimitViolations(run.recording, g),
    kneeSpeedDegPerSec: metrics.kneeSpeedDegPerSec(run.recording, g),
    boneLengthError: metrics.boneLengthError(run.recording, g, rest),
    rootSpeedError: metrics.rootSpeedError(run.recording, g, steady),
    unsupportedFrames: metrics.unsupportedFrames(run.recording, g),
    alternationViolations: metrics.alternationViolations(run.recording, g, steady)
  }
}

function plantedOf (run: Run): Record<'left' | 'right', number> {
  return metrics.plantedFrames(run.recording, geometry(run))
}

const walkTurnStop = runs.find(r => r.scenario.name === 'walk-turn-stop') as Run
const control = plan(walkTurnStop.scenario, planSkating)
const planted = new Map([
  ...runs.map((run): [string, Record<'left' | 'right', number>] => [run.scenario.name, plantedOf(run)]),
  ['control', plantedOf(control)] as [string, Record<'left' | 'right', number>]
])
for (const [name, counts] of planted) {
  for (const side of ['left', 'right'] as const) {
    if (counts[side] === 0) fail(`${name}: the ${side} foot never counts as planted; footSlidePx would measure nothing`)
  }
}

const other = childHashes()
const nondeterministic = runs.flatMap(runHashes).filter(([id, hash]) => other.get(id) !== hash).length
const perScenario = Object.fromEntries(runs.map(run => [run.scenario.name, evaluateRun(run)]))
const controlValues = evaluateRun(control)
const controlResults = evaluate(Object.entries(controlValues).map(([name, value]) => {
  return gate(name as Parameters<typeof gate>[0], value, 'control')
}))
const controlSlide = controlValues.footSlidePx
const controlSlides = !controlResults.find(r => r.name === 'footSlidePx.control')?.pass
const controlFair = controlResults.every(r => r.pass || r.name === 'footSlidePx.control')

const results = evaluate([
  ...runs.flatMap(run => Object.entries(perScenario[run.scenario.name]).map(([name, value]) => {
    return gate(name as Parameters<typeof gate>[0], value, run.scenario.name)
  })),
  gate('skatingControlFails', controlSlides ? 1 : 0),
  gate('skatingControlFair', controlFair ? 1 : 0),
  gate('nondeterministicFrames', nondeterministic)
])
const plantedLines = [...planted].map(([name, c]) => `planted frames ${name}: left ${c.left}, right ${c.right}`)
const summary = [
  summarize('P4 locomotion', results),
  ...controlResults.map(r => `skating control ${r.name}: ${r.value.toFixed(3)} ${r.pass ? 'pass' : 'FAIL'}`),
  ...plantedLines
].join('\n')

function legsImage (run: Run): ReturnType<typeof legOnionSkin> {
  const { recording, mannequin, scenario } = run
  const centre = frameOf(run, steadyMiddle(run))
  const half = Math.round(ONION.seconds * scenario.fps / 2)
  return legOnionSkin(recording, {
    rig,
    mannequin,
    axis: 'z',
    width: ONION.width,
    height: ONION.height,
    every: ONION.every,
    from: Math.max(0, centre - half),
    to: Math.min(recording.frames.length - 1, centre + half)
  })
}

function stills (run: Run): void {
  const name = run.scenario.name
  const options = { rig, mannequin: run.mannequin, size: FOOTPRINT_SIZE }
  writeOutput(join(outDir, `${name}-footprints.png`), encodePng(footprintTrace(run.recording, options)))
  writeOutput(join(outDir, `${name}-legs.png`), encodePng(legsImage(run)))
}

function stripOptions (run: Run): Parameters<typeof pixelStrip>[1] {
  const first = frameOf(run, steadyMiddle(run)) - STRIP.frames / 2
  return {
    mannequin: run.mannequin,
    style,
    frames: Array.from({ length: STRIP.frames }, (_, i) => first + i),
    azimuthDeg: 90,
    elevationDeg: STRIP.elevationDeg,
    targetHeightPx: STRIP.targetHeightPx,
    scale: STRIP.scale,
    gap: STRIP.gap
  }
}

function directionsSheet (run: Run): ReturnType<typeof sheet> {
  const frame = run.recording.frames[frameOf(run, steadyMiddle(run))]
  const origin = frame.root.position
  const joints: Pose = {}
  for (const [name, p] of Object.entries(frame.joints)) joints[name] = [p[0] - origin[0], p[1], p[2] - origin[2]]
  const posed = posedMannequin(run.mannequin, joints)
  const cells = Array.from({ length: DIRECTIONS.count }, (_, d) => {
    const camera = fitCamera(posed, {
      azimuthDeg: d * 360 / DIRECTIONS.count,
      elevationDeg: DIRECTIONS.elevationDeg,
      targetHeightPx: DIRECTIONS.targetHeightPx,
      margin: 2
    })
    const { image } = stylize(rasterize(posed, camera), posed, camera, style)
    return { image, anchor: [0, 0] as [number, number] }
  })
  return sheet([cells], { scale: DIRECTIONS.scale, gap: DIRECTIONS.gap, background: BACKGROUND })
}

for (const run of runs) stills(run)
writeOutput(join(outDir, 'skating-legs.png'), encodePng(legsImage(control)))
writeOutput(join(outDir, 'walk-strip.png'), encodePng(pixelStrip(walkTurnStop.recording, stripOptions(walkTurnStop))))
writeOutput(join(outDir, 'skating-strip.png'), encodePng(pixelStrip(control.recording, stripOptions(walkTurnStop))))
writeOutput(join(outDir, 'directions.png'), encodePng(directionsSheet(walkTurnStop)))

function finite (key: string, value: unknown): unknown {
  return typeof value === 'number' && !Number.isFinite(value) ? String(value) : value
}

const metricsReport = {
  gates: results,
  perScenario,
  skatingControl: { values: controlValues, gates: controlResults },
  skatingControlSlidePx: controlSlide,
  planted: Object.fromEntries(planted)
}
writeOutput(join(outDir, 'metrics.json'), JSON.stringify(metricsReport, finite, 2))
writeOutput(join(outDir, 'summary.txt'), `${summary}\n`)

console.log(summary)
process.exitCode = results.every(r => r.pass) ? 0 : 1
