import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateMannequin } from '../../src/formats/mannequin.ts'
import type { Mannequin } from '../../src/formats/mannequin.ts'
import { checkRig, validateRig } from '../../src/formats/rig.ts'
import type { Rig } from '../../src/formats/rig.ts'
import { validateScenario } from '../../src/formats/sim.ts'
import { validateStyle } from '../../src/formats/style.ts'
import { formatErrors } from '../../src/formats/validate.ts'
import type { Validated } from '../../src/formats/validate.ts'
import { planGait } from '../../src/motion/gait.ts'
import { recordLocomotion } from '../../src/motion/metrics.ts'
import { restPose } from '../../src/motion/pose.ts'
import { createRootTrack, scriptDuration } from '../../src/motion/script.ts'
import { imageHash } from '../../src/image-hash.ts'
import type { Image } from '../../src/image.ts'
import { encodePng } from '../../src/png/encode.ts'
import { evaluate, optionalGate, summarize, writeOutput } from '../../src/diagnostics/report.ts'
import { flickerFraction, partAreaJump } from '../../src/diagnostics/stability.ts'
import { differenceStrip } from '../../src/diagnostics/stability-images.ts'
import { FLICKER_LIMIT, gate } from './gates.ts'
import { render, shifted, turntable, walk } from './sequences.ts'
import type { Offset, Rendered, View } from './sequences.ts'

const SIZES = [32, 48]
const ELEVATION = 30
const TURN_FRAMES = 91
const TURN_DEGREES_PER_FRAME = 1
const WALK_AZIMUTH = 90
const STRIP = { from: 30, count: 12, scale: 4, gap: 4, background: 0xf7f7f7 }
const P4 = join('..', 'p4-locomotion')
const STYLE_FILE = join('..', 'p1-static-style', 'style.json')
const CHILD_TIMEOUT_MS = 300000

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', '..', 'reports', 'p2')
const hashesMode = process.argv.includes('--hashes')
const verify = process.argv.includes('--verify')

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

const rigFile = join(P4, 'rig.json')
const scenarioFile = join(P4, 'walk-turn-stop.json')
const rig: Rig = requireValid(rigFile, validateRig(loadJson(rigFile)))
const style = requireValid(STYLE_FILE, validateStyle(loadJson(STYLE_FILE)))
const scenario = requireValid(scenarioFile, validateScenario(loadJson(scenarioFile)))
const bodyFile = join(P4, scenario.body)
const knight: Mannequin = requireValid(bodyFile, validateMannequin(loadJson(bodyFile)))
const rigErrors = checkRig(rig, knight)
if (rigErrors.length > 0) fail(formatErrors(rigFile, rigErrors))

const rest = restPose(knight)
const gait = planGait({
  track: createRootTrack(scenario.script),
  rig,
  rest,
  mannequin: knight,
  duration: scriptDuration(scenario.script),
  fps: scenario.fps
})
const recording = recordLocomotion(gait, { rig, rest, mannequin: knight, fps: scenario.fps })

const view = (size: number, azimuthDeg: number): View => ({ azimuthDeg, elevationDeg: ELEVATION, targetHeightPx: size })
const unsnapped: Offset = k => [(0.37 * k) % 1, (0.61 * k) % 1]

type Sequence = { label: string, size: number, rendered: Rendered }

const sequences: Sequence[] = SIZES.flatMap(size => {
  const spin = turntable(knight, TURN_FRAMES, TURN_DEGREES_PER_FRAME)
  const front = view(size, 0)
  return [
    { label: `turntable-${size}`, size, rendered: render(spin, front, style) },
    { label: `walk-${size}`, size, rendered: render(walk(knight, recording), view(size, WALK_AZIMUTH), style) },
    { label: `control-${size}`, size, rendered: render(shifted(spin, front, unsnapped), front, style) }
  ]
})

function hashes (): Array<[string, string]> {
  return sequences.flatMap(s => {
    return s.rendered.images.map((img, i): [string, string] => [`${s.label}#${i}`, imageHash(img)])
  })
}

if (hashesMode) {
  for (const [id, hash] of hashes()) console.log(`${id} ${hash}`)
  process.exit(0)
}

function childHashes (): Map<string, string> {
  const output = execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--hashes'], {
    encoding: 'utf8', timeout: CHILD_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024
  })
  return new Map(output.split('\n').filter(l => l !== '').map(l => l.split(' ') as [string, string]))
}

function mismatches (): number {
  const other = childHashes()
  return hashes().filter(([id, hash]) => other.get(id) !== hash).length
}

const nondeterministic = verify ? mismatches() : 0

const values = new Map(sequences.map(s => [s.label, {
  flickerFraction: flickerFraction(s.rendered.images),
  partAreaJump: partAreaJump(s.rendered.parts),
  outlineGaps: s.rendered.outlineGaps
}]))
const valueOf = (label: string) => values.get(label) as NonNullable<ReturnType<typeof values.get>>
const controlsFailing = SIZES.filter(size => valueOf(`control-${size}`).flickerFraction > FLICKER_LIMIT).length

const results = evaluate([
  ...SIZES.flatMap(size => [
    gate('flickerFraction', valueOf(`turntable-${size}`).flickerFraction, `turntable-${size}`),
    gate('partAreaJump', valueOf(`turntable-${size}`).partAreaJump, `turntable-${size}`)
  ]),
  ...sequences.filter(s => !s.label.startsWith('control')).map(s => {
    return gate('outlineGaps', valueOf(s.label).outlineGaps, s.label)
  }),
  gate('controlFails', controlsFailing),
  optionalGate(gate('nondeterministicFrames', nondeterministic), verify)
])

const reported = sequences.filter(s => s.label.startsWith('walk') || s.label.startsWith('control')).flatMap(s => {
  const v = valueOf(s.label)
  return [
    `${s.label} flickerFraction: ${v.flickerFraction.toFixed(4)}${s.label.startsWith('walk') ? ' (reported)' : ''}`,
    `${s.label} partAreaJump: ${v.partAreaJump.toFixed(4)}`,
    `${s.label} outlineGaps: ${v.outlineGaps}`
  ]
})
const summary = [summarize('P2 pixel stability', results), ...reported].join('\n')

function strip (images: Image[]): Uint8Array {
  return encodePng(differenceStrip(images, STRIP))
}

for (const s of sequences) {
  if (s.size !== Math.max(...SIZES)) continue
  const kind = s.label.split('-')[0]
  writeOutput(join(outDir, `${kind}-differences.png`), strip(s.rendered.images))
}

const metricsReport = { gates: results, sequences: Object.fromEntries(values) }
writeOutput(join(outDir, 'metrics.json'), JSON.stringify(metricsReport, null, 2))
writeOutput(join(outDir, 'summary.txt'), `${summary}\n`)

console.log(summary)
process.exitCode = results.every(r => r.pass) ? 0 : 1
