import { join } from 'node:path'
import { validateMannequin } from '../../src/formats/mannequin.ts'
import type { Mannequin } from '../../src/formats/mannequin.ts'
import { checkScenario, scenarioDuration, validateScenario, validateSimMaterials } from '../../src/formats/sim.ts'
import type { Scenario, SimMaterial } from '../../src/formats/sim.ts'
import { formatErrors } from '../../src/formats/validate.ts'
import type { Vec3 } from '../../src/math/vec.ts'
import { createRootTrack, scriptDuration } from '../../src/motion/script.ts'
import type { RootState } from '../../src/motion/script.ts'
import { bodyCollider, toWorld } from '../../src/sim/body.ts'
import { buildCape, buildChain, capeHemIndices, mergeSystems } from '../../src/sim/cloth.ts'
import type { System } from '../../src/sim/cloth.ts'
import { step } from '../../src/sim/solver.ts'
import * as metrics from '../../src/sim/metrics.ts'
import type { Recording, SwingOptions } from '../../src/sim/metrics.ts'
import { angleChart, bodyFrameOnionSkin, sideOnionSkin, topDownTrace } from '../../src/diagnostics/motion-images.ts'
import { evaluate, optionalGate, summarize, writeOutput } from '../../src/diagnostics/report.ts'
import { childHashes, nonFiniteAsText, startGatedRun } from '../harness.ts'
import { encodePng } from '../../src/png/encode.ts'
import { gate, MATERIALS } from './gates.ts'

const SCENARIOS = ['turn-stop', 'wind', 'soak']
const SETTLE_SPEED = 0.05
const PENETRATION_PX = 0.5
const PX_SCALE = 48
const STILL_SIZE = 384
const CHART = { width: 640, height: 280 }
const MAX_ONION_FRAMES = 60
const BODY_STEP = 4
const STOP_STEP = 2
const FOLLOW_SECONDS = 1.5
const MIN_LAG_PEAK_DEGREES = 0.5
const CHILD_TIMEOUT_MS = 120000

const { outDir, hashesMode, verify, fail, loadJson, requireValid } = startGatedRun(import.meta.url, 'p3')

type Run = {
  id: string
  scenario: Scenario
  material: string
  recording: Recording
  swing: SwingOptions
  hem: number[]
}

const materials = requireValid('materials.json', validateSimMaterials(loadJson('materials.json')))
const scenarios = SCENARIOS.map(name => requireValid(`${name}.json`, validateScenario(loadJson(`${name}.json`))))
const bodies = new Map<string, Mannequin>()
for (const scenario of scenarios) {
  const body = requireValid(scenario.body, validateMannequin(loadJson(scenario.body)))
  bodies.set(scenario.name, body)
  const errors = checkScenario(scenario, body, materials)
  if (errors.length > 0) fail(formatErrors(`${scenario.name}.json`, errors))
}
const materialByName = new Map(materials.map(m => [m.name, m]))
for (const name of MATERIALS) {
  if (!materialByName.has(name)) fail(`materials.json: missing material '${name}'`)
}

function buildSystem (scenario: Scenario, material: SimMaterial): System {
  const body = bodies.get(scenario.name) as Mannequin
  const systems = []
  if (scenario.cape !== undefined) {
    systems.push(buildCape({ ...scenario.cape, material: material.name }, body, material))
  }
  for (const chain of scenario.chains) systems.push(buildChain({ ...chain, material: material.name }, body, material))
  return mergeSystems(systems)
}

function swingOptions (scenario: Scenario): SwingOptions {
  const cape = scenario.cape as NonNullable<Scenario['cape']>
  const joints = (bodies.get(scenario.name) as Mannequin).joints
  const left = joints[cape.anchorLeft]
  const right = joints[cape.anchorRight]
  return {
    hem: capeHemIndices(cape),
    anchorLocal: [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2, (left[2] + right[2]) / 2]
  }
}

function simulate (scenario: Scenario, material: SimMaterial): Recording {
  const body = bodies.get(scenario.name) as Mannequin
  const system = buildSystem(scenario, material)
  const track = createRootTrack(scenario.script)
  const env = { gravity: scenario.gravity, wind: scenario.wind, particleRadius: scenario.particleRadius }
  const frameDt = 1 / scenario.fps
  const dt = frameDt / scenario.substeps
  const frames = Math.round(scenarioDuration(scenario) * scenario.fps)
  const recording = metrics.createRecording(system)
  const record = (frame: number): void => {
    const root = track(frame * frameDt)
    const { distance } = bodyCollider(body, scenario.bodyExcludeParts, root)
    metrics.recordFrame(recording, {
      time: frame * frameDt, root, particles: system.particles, distance, particleRadius: scenario.particleRadius
    })
  }
  record(0)
  for (let frame = 1; frame <= frames; frame++) {
    for (let s = 0; s < scenario.substeps; s++) {
      const k = (frame - 1) * scenario.substeps + s
      step(system, { env, body, exclude: scenario.bodyExcludeParts, track, t: (k + 1) * dt, dt })
    }
    record(frame)
  }
  return recording
}

const runs: Run[] = scenarios.flatMap(scenario => MATERIALS.map(name => ({
  id: `${scenario.name}-${name}`,
  scenario,
  material: name,
  recording: simulate(scenario, materialByName.get(name) as SimMaterial),
  swing: swingOptions(scenario),
  hem: capeHemIndices(scenario.cape as NonNullable<Scenario['cape']>)
})))

function runHashes (run: Run): Array<[string, string]> {
  return metrics.frameHashes(run.recording).map((hash, i) => [`${run.id}#${i}`, hash])
}

if (hashesMode) {
  for (const run of runs) for (const [id, hash] of runHashes(run)) console.log(`${id} ${hash}`)
  process.exit(0)
}

function find (scenario: string, material: string): Run {
  return runs.find(r => r.scenario.name === scenario && r.material === material) as Run
}

function finalHold (scenario: Scenario): number {
  const { segments } = scenario.script
  return scriptDuration(scenario.script) - segments[segments.length - 1].duration
}

function turnWindow (scenario: Scenario): { turnStart: number, turnEnd: number } {
  let start = 0
  for (const segment of scenario.script.segments) {
    if (segment.action === 'turn') return { turnStart: start, turnEnd: start + segment.duration }
    start += segment.duration
  }
  return fail(`${scenario.name}.json: the script has no turn segment`)
}

const restHems = new Map<string, Vec3>()

function windlessRestHem (run: Run): Vec3 {
  const cached = restHems.get(run.material)
  if (cached !== undefined) return cached
  const calm = { ...run.scenario, wind: undefined }
  const { frames } = simulate(calm, materialByName.get(run.material) as SimMaterial)
  const last = frames[frames.length - 1].positions
  const hem = run.hem
  const mean = (axis: number): number => hem.reduce((sum, i) => sum + last[3 * i + axis], 0) / hem.length
  const rest: Vec3 = [mean(0), mean(1), mean(2)]
  restHems.set(run.material, rest)
  return rest
}

function rigidRecording (run: Run): Recording {
  const system = buildSystem(run.scenario, materialByName.get(run.material) as SimMaterial)
  const rest = system.particles.position
  const frames = run.recording.frames.map(({ time, root }) => {
    const positions = new Float64Array(rest.length)
    for (let i = 0; i < rest.length; i += 3) {
      positions.set(toWorld([rest[i], rest[i + 1], rest[i + 2]], root as RootState), i)
    }
    return {
      time,
      root,
      positions,
      penetration: new Float64Array(rest.length / 3),
      linkPenetration: new Float64Array(system.constraints.length)
    }
  })
  return { constraints: system.constraints, frames }
}

const rigids = new Map<string, Recording>()

function rigidOf (material: string): Recording {
  const cached = rigids.get(material)
  if (cached !== undefined) return cached
  const rigid = rigidRecording(find('turn-stop', material))
  rigids.set(material, rigid)
  return rigid
}

function capeParticles (scenario: Scenario): number[] {
  const cape = scenario.cape as NonNullable<Scenario['cape']>
  return Array.from({ length: cape.columns * cape.rows }, (_, i) => i)
}

function motionMetrics (run: Run, recording: Recording): { settle: number, overshoot: number, lag: number } {
  const stopTime = finalHold(run.scenario)
  return {
    settle: metrics.settleSeconds(recording, {
      fromTime: stopTime + run.scenario.script.accelSeconds,
      speedThreshold: SETTLE_SPEED,
      particles: capeParticles(run.scenario)
    }),
    overshoot: metrics.overshootDegrees(recording, { stopTime, swing: run.swing }),
    lag: metrics.lagFrames(recording, {
      ...turnWindow(run.scenario), swing: run.swing, minPeakDegrees: MIN_LAG_PEAK_DEGREES
    })
  }
}

function rigidControlFails (material: string, rigid: { settle: number, overshoot: number, lag: number }): number {
  const gates = [
    gate('settleSecondsMin', rigid.settle, material),
    gate('lagFrames', rigid.lag, material),
    gate('overshootDegrees', rigid.overshoot, material)
  ]
  return evaluate(gates).some(g => !g.pass) ? 1 : 0
}

function windMetric (material: string): number {
  const run = find('wind', material)
  const wind = run.scenario.wind as NonNullable<Scenario['wind']>
  return metrics.windAlignment(run.recording, {
    hem: run.hem, restHem: windlessRestHem(run), windDirection: wind.direction
  })
}

function windDrift (material: string): number {
  const run = find('wind', material)
  return metrics.windDriftMetres(run.recording, { hem: run.hem, restHem: windlessRestHem(run) })
}

const penetrationLimit = PENETRATION_PX * (bodies.get('turn-stop') as Mannequin).height / PX_SCALE
function mismatches (): number {
  const other = childHashes(import.meta.url, CHILD_TIMEOUT_MS)
  return runs.flatMap(runHashes).filter(([id, hash]) => other.get(id) !== hash).length
}

const nondeterministic = verify ? mismatches() : 0

const perMaterial = Object.fromEntries(MATERIALS.map(name => {
  const run = find('turn-stop', name)
  const rigid = motionMetrics(run, rigidOf(name))
  return [name, {
    ...motionMetrics(run, run.recording),
    wind: windMetric(name),
    windDriftMetres: windDrift(name),
    maxSpeed: metrics.maxSpeed(find('soak', name).recording),
    rigid,
    rigidControlFails: rigidControlFails(name, rigid)
  }]
}))
const perRun = runs.map(r => ({
  id: r.id,
  nonFinite: metrics.nonFinite(r.recording),
  maxStrain: metrics.maxStrain(r.recording),
  penetratingFrames: metrics.penetratingFrames(r.recording, penetrationLimit)
}))

const settles = MATERIALS.map(name => perMaterial[name].settle)
const ordered = settles[0] > settles[1] && settles[1] > settles[2]

const results = evaluate([
  gate('nonFinite', perRun.reduce((sum, r) => sum + r.nonFinite, 0)),
  gate('maxStrain', Math.max(...perRun.map(r => r.maxStrain))),
  gate('penetratingFrames', Math.max(...perRun.map(r => r.penetratingFrames))),
  ...MATERIALS.map(name => gate('maxSpeed', perMaterial[name].maxSpeed, name)),
  ...MATERIALS.map(name => gate('settleSecondsMin', perMaterial[name].settle, name)),
  ...MATERIALS.map(name => gate('settleSecondsMax', perMaterial[name].settle, name)),
  gate('settleOrder', ordered ? 1 : 0),
  ...MATERIALS.slice(0, 2).map(name => gate('overshootDegrees', perMaterial[name].overshoot, name)),
  ...MATERIALS.map(name => gate('lagFrames', perMaterial[name].lag, name)),
  ...MATERIALS.map(name => gate('windAlignment', perMaterial[name].wind, name)),
  ...MATERIALS.map(name => gate('windDriftMetres', perMaterial[name].windDriftMetres, name)),
  ...MATERIALS.map(name => gate('rigidControlFails', perMaterial[name].rigidControlFails, name)),
  optionalGate(gate('nondeterministicFrames', nondeterministic), verify)
])
const summary = summarize('P3 secondary motion', results)

function frameRange (run: Run, fromTime: number, step: number): number[] {
  const fps = run.scenario.fps
  const last = run.recording.frames.length - 1
  const end = Math.min(last, Math.round((finalHold(run.scenario) + FOLLOW_SECONDS) * fps))
  const indices: number[] = []
  for (let i = Math.round(fromTime * fps); i <= end; i += step) indices.push(i)
  return indices
}

function writeBodyFrameStills (run: Run, prefix: string, recording: Recording): void {
  const body = bodies.get(run.scenario.name) as Mannequin
  const base = { size: STILL_SIZE, body, exclude: run.scenario.bodyExcludeParts }
  const whole = frameRange(run, turnWindow(run.scenario).turnStart, BODY_STEP)
  const stop = frameRange(run, finalHold(run.scenario), STOP_STEP)
  writeOutput(join(outDir, `${prefix}-body.png`), encodePng(bodyFrameOnionSkin(recording, { ...base, frames: whole })))
  writeOutput(join(outDir, `${prefix}-stop.png`), encodePng(bodyFrameOnionSkin(recording, { ...base, frames: stop })))
}

function writeWindFront (run: Run): void {
  const body = bodies.get(run.scenario.name) as Mannequin
  const frames = run.recording.frames.map((_, i) => i).filter(i => i % BODY_STEP === 0)
  const options = { size: STILL_SIZE, frames, body, exclude: run.scenario.bodyExcludeParts, horizontal: 'x' as const }
  writeOutput(join(outDir, `${run.id}-front.png`), encodePng(bodyFrameOnionSkin(run.recording, options)))
  const side = { ...options, horizontal: 'z' as const }
  writeOutput(join(outDir, `${run.id}-body.png`), encodePng(bodyFrameOnionSkin(run.recording, side)))
}

function writeStills (run: Run): void {
  const body = bodies.get(run.scenario.name) as Mannequin
  const exclude = run.scenario.bodyExcludeParts
  const every = Math.max(2, Math.ceil(run.recording.frames.length / MAX_ONION_FRAMES))
  const onion = { size: STILL_SIZE, every, body, exclude, horizontal: 'x' as const }
  writeOutput(join(outDir, `${run.id}-top.png`),
    encodePng(topDownTrace(run.recording, { size: STILL_SIZE, hem: run.hem, body, exclude })))
  writeOutput(join(outDir, `${run.id}-side.png`), encodePng(sideOnionSkin(run.recording, onion)))
  writeOutput(join(outDir, `${run.id}-angles.png`),
    encodePng(angleChart(run.recording, { ...CHART, swing: run.swing })))
  if (run.scenario.name === 'turn-stop') writeBodyFrameStills(run, run.id, run.recording)
  if (run.scenario.name === 'wind') writeWindFront(run)
  if (run.id === 'turn-stop-silk') {
    writeBodyFrameStills(run, 'turn-stop-rigid', rigidOf(run.material))
    writeOutput(join(outDir, 'turn-stop-rigid-side.png'), encodePng(sideOnionSkin(rigidOf(run.material), onion)))
  }
}

for (const run of runs) writeStills(run)
writeOutput(join(outDir, 'metrics.json'), JSON.stringify({ gates: results, perMaterial, perRun }, nonFiniteAsText, 2))
writeOutput(join(outDir, 'summary.txt'), `${summary}\n`)

console.log(summary)
process.exitCode = results.every(r => r.pass) ? 0 : 1
