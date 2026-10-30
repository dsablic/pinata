import { rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { formatCharacterErrors, loadCharacter } from '../formats/character.ts'
import type { Character } from '../formats/character.ts'
import { simulateCharacter } from '../motion/character.ts'
import { encodePng } from '../png/encode.ts'
import { writeOutput } from '../diagnostics/report.ts'
import { clothChecks, hasCloth } from './cloth.ts'
import { locomotionChecks, locomotionRecording } from './locomotion.ts'
import { contactSheet, renderStatic, staticChecks } from './static.ts'
import { clothOnionSkin, footprints, walkStrip, withSettledCloth } from './stills.ts'
import { formatSummary, runChecks } from './summary.ts'
import type { Check } from './summary.ts'

const USAGE = 'usage: npm run check -- <character dir> [--out <dir>]'
const OUTPUTS = ['summary.txt', 'metrics.json', 'sheet.png', 'walk.png', 'footprints.png', 'cloth.png']

type Args = { dir: string, out: string }

function parseArgs (argv: string[]): Args | string {
  const positional: string[] = []
  let out: string | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') {
      out = argv[++i]
      if (out === undefined) return `--out needs a directory\n${USAGE}`
    } else if (argv[i].startsWith('--')) return `unknown option '${argv[i]}'\n${USAGE}`
    else positional.push(argv[i])
  }
  if (positional.length !== 1) return USAGE
  return { dir: resolve(positional[0]), out: resolve(out ?? join(positional[0], 'report')) }
}

function finite (key: string, value: unknown): unknown {
  return typeof value === 'number' && !Number.isFinite(value) ? String(value) : value
}

function pathKind (path: string): 'directory' | 'other' | 'missing' {
  try {
    return statSync(path).isDirectory() ? 'directory' : 'other'
  } catch {
    return 'missing'
  }
}

function writeError (args: Args, message: string): void {
  console.error(message)
  if (pathKind(args.dir) !== 'directory') return
  try {
    writeOutput(join(args.out, 'summary.txt'), `automated gates: ERROR\n${message}\n`)
  } catch (err) {
    console.error(`could not write ${join(args.out, 'summary.txt')}: ${err instanceof Error ? err.message : err}`)
  }
}

function clearReport (out: string): void {
  try {
    for (const name of OUTPUTS) rmSync(join(out, name), { force: true })
  } catch {
    return
  }
}

function analyse (character: Character, out: string): number {
  const started = performance.now()
  const frames = renderStatic(character.mannequin, character.style)
  const run = simulateCharacter({
    mannequin: character.mannequin, rig: character.rig, scenario: character.scenario, materials: character.materials
  })
  const recording = locomotionRecording(character, run)
  const cloth = hasCloth(character)
  const shown = cloth ? renderStatic(withSettledCloth(character, recording, run.recording), character.style) : frames
  writeOutput(join(out, 'sheet.png'), encodePng(contactSheet(shown)))
  writeOutput(join(out, 'walk.png'), encodePng(walkStrip(character, recording, cloth ? run.recording : undefined)))
  writeOutput(join(out, 'footprints.png'), encodePng(footprints(character, recording)))
  if (cloth) writeOutput(join(out, 'cloth.png'), encodePng(clothOnionSkin(character, recording, run.recording)))
  const checks: Check[] = [
    ...staticChecks(character.mannequin, character.style, frames),
    ...locomotionChecks(character, recording),
    ...(cloth ? clothChecks(character, run) : [])
  ]
  const results = runChecks(checks)
  const seconds = (performance.now() - started) / 1000
  const header = `check: ${character.name} (${character.dir})${cloth ? '' : ' [no cloth: cloth gates skipped]'}`
  const summary = formatSummary(header, results)
  writeOutput(join(out, 'summary.txt'), `${summary}\n`)
  const metricsReport = { gates: results, timing: { seconds, ...run.timing } }
  writeOutput(join(out, 'metrics.json'), JSON.stringify(metricsReport, finite, 2))
  console.log(summary)
  console.log(`report: ${out} (${seconds.toFixed(1)} s)`)
  return results.every(r => r.pass) ? 0 : 1
}

function main (): number {
  const args = parseArgs(process.argv.slice(2))
  if (typeof args === 'string') {
    console.error(args)
    return 2
  }
  if (pathKind(args.dir) === 'other') {
    console.error(`'${args.dir}' is not a directory; pass the directory that holds character.json`)
    return 2
  }
  clearReport(args.out)
  try {
    const loaded = loadCharacter(args.dir)
    if (loaded.value === undefined || loaded.errors.length > 0) {
      writeError(args, formatCharacterErrors(loaded.errors))
      return 2
    }
    return analyse(loaded.value, args.out)
  } catch (err) {
    writeError(args, err instanceof Error ? (err.stack ?? err.message) : String(err))
    return 2
  }
}

process.exitCode = main()
