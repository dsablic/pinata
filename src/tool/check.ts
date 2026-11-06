import { existsSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { formatCharacterErrors, loadCharacter, readJson, tag } from '../formats/character.ts'
import type { Character } from '../formats/character.ts'
import { checkSkin, validateSkin } from '../formats/skin.ts'
import type { ValidationError } from '../formats/validate.ts'
import { simulateCharacter } from '../motion/character.ts'
import { record } from '../export/record.ts'
import { GROUND_PX } from '../export/gates.ts'
import { checksOf, failedGates } from '../export/report.ts'
import { encodePng } from '../png/encode.ts'
import { writeOutput } from '../diagnostics/report.ts'
import { clothChecks, hasCloth } from '../cli/cloth.ts'
import { locomotionChecks, locomotionRecording } from '../cli/locomotion.ts'
import { contactSheet, renderStatic, staticChecks } from '../cli/static.ts'
import { clothOnionSkin, footprints, walkStrip, withSettledCloth } from '../cli/stills.ts'
import { formatSummary, runChecks } from '../cli/summary.ts'
import type { Check } from '../cli/summary.ts'
import { directionChecks } from './direction-checks.ts'
import { messageOf } from './io.ts'
import type { Invoke, Io } from './io.ts'
import { subjectFor } from './subject.ts'

export const checkUsage = (invoke: Invoke): string => `usage: ${invoke('check')} <character dir> [--out <dir>]`
const IDLE_GATES = ['ground', 'drawn']
const ONLY_EXPORT = 'loop, feet, facing, border and anchor'
const OUTPUTS = ['summary.txt', 'metrics.json', 'sheet.png', 'walk.png', 'footprints.png', 'cloth.png']

type Args = { dir: string, out: string }

function parseArgs (argv: string[], usage: string): Args | string {
  const positional: string[] = []
  let out: string | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') {
      out = argv[++i]
      if (out === undefined) return `--out needs a directory\n${usage}`
    } else if (argv[i].startsWith('--')) return `unknown option '${argv[i]}'\n${usage}`
    else positional.push(argv[i])
  }
  if (positional.length !== 1) return usage
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

function writeError (args: Args, message: string, io: Io): void {
  io.err(message)
  if (pathKind(args.dir) !== 'directory') return
  try {
    writeOutput(join(args.out, 'summary.txt'), `automated gates: ERROR\n${message}\n`)
  } catch (err) {
    io.err(`could not write ${join(args.out, 'summary.txt')}: ${messageOf(err)}`)
  }
}

function isFileError (err: unknown): boolean {
  return err instanceof Error && 'code' in err
}

function failureText (err: unknown): string {
  if (isFileError(err) || !(err instanceof Error)) return messageOf(err)
  return err.stack ?? err.message
}

function clearReport (out: string): void {
  try {
    for (const name of OUTPUTS) rmSync(join(out, name), { force: true })
  } catch {
    return
  }
}

const SKIN_FILE = 'skin.json'
const RETARGET_FILE = 'retarget.json'

function isSkinned (dir: string): boolean {
  return [SKIN_FILE, RETARGET_FILE].every(file => existsSync(join(dir, file)))
}

function skinErrors (character: Character): string {
  if (!existsSync(join(character.dir, SKIN_FILE))) return ''
  const errors: ValidationError[] = []
  const input = readJson(character.dir, SKIN_FILE, errors)
  const read = input === undefined ? undefined : validateSkin(input)
  const crossed = read?.value === undefined ? [] : checkSkin(read.value, character.mannequin)
  return formatCharacterErrors([...errors, ...tag(SKIN_FILE, [...(read?.errors ?? []), ...crossed])])
}

function idleCheck (dir: string): Check {
  const rationale = `idle, eight directions: every foot drawn, within ${GROUND_PX} px of its ground point`
  const gate = (value: number): Check['gate'] => {
    return { name: 'idleFootMisses', value, op: '<=', threshold: 0, rationale }
  }
  try {
    const checks = checksOf(record(subjectFor(dir), ['idle']))
    const misses = failedGates(checks).filter(own => IDLE_GATES.includes(own.gate))
    const hints = [...new Set(misses.flatMap(own => own.hint === undefined ? [] : [own.hint]))]
    return {
      gate: gate(misses.length),
      hint: () => `${misses.map(own => own.line).join('; ')}. ${hints.join(' ')}`
    }
  } catch (err) {
    return { gate: gate(NaN), hint: () => `the idle could not be recorded: ${messageOf(err)}` }
  }
}

function analyse (character: Character, out: string, io: Io): number {
  const started = performance.now()
  const frames = renderStatic(character.mannequin, character.style)
  const run = simulateCharacter({
    mannequin: character.mannequin, rig: character.rig, scenario: character.scenario, materials: character.materials
  })
  const recording = locomotionRecording(character, run)
  const cloth = hasCloth(character)
  const skinned = isSkinned(character.dir)
  const shown = cloth ? renderStatic(withSettledCloth(character, recording, run.recording), character.style) : frames
  writeOutput(join(out, 'sheet.png'), encodePng(contactSheet(shown)))
  writeOutput(join(out, 'walk.png'), encodePng(walkStrip(character, recording, cloth ? run.recording : undefined)))
  writeOutput(join(out, 'footprints.png'), encodePng(footprints(character, recording)))
  if (cloth) writeOutput(join(out, 'cloth.png'), encodePng(clothOnionSkin(character, recording, run.recording)))
  const direction = directionChecks(character)
  const checks: Check[] = [
    ...staticChecks(character.mannequin, character.style, frames),
    ...locomotionChecks(character, recording),
    ...(cloth ? clothChecks(character, run) : []),
    ...(skinned ? [idleCheck(character.dir)] : []),
    ...direction.checks
  ]
  const results = runChecks(checks)
  const seconds = (performance.now() - started) / 1000
  const skipped = [
    ...(cloth ? [] : ['no cloth: cloth gates skipped']),
    ...(skinned ? [] : ['no skin.json and retarget.json: idle foot gate skipped']),
    ...direction.notes
  ]
  const header = [
    `check: ${character.name} (${character.dir})${skipped.length === 0 ? '' : ` [${skipped.join('; ')}]`}`,
    `only export runs: ${ONLY_EXPORT}${skinned ? '' : ', and the idle foot gate'}, over every animation`,
    `attack: ${character.attack.attack} (${character.attack.reason})`
  ].join('\n')
  const summary = formatSummary(header, results)
  writeOutput(join(out, 'summary.txt'), `${summary}\n`)
  const metricsReport = { gates: results, timing: { seconds, ...run.timing } }
  writeOutput(join(out, 'metrics.json'), JSON.stringify(metricsReport, finite, 2))
  io.out(summary)
  io.out(`report: ${out} (${seconds.toFixed(1)} s)`)
  return results.every(r => r.pass) ? 0 : 1
}

export function runCheck (argv: string[], io: Io, invoke: Invoke): number {
  const args = parseArgs(argv, checkUsage(invoke))
  if (typeof args === 'string') {
    io.err(args)
    return 2
  }
  if (pathKind(args.dir) === 'other') {
    io.err(`'${args.dir}' is not a directory; pass the directory that holds character.json`)
    return 2
  }
  clearReport(args.out)
  try {
    const loaded = loadCharacter(args.dir)
    if (loaded.value === undefined || loaded.errors.length > 0) {
      writeError(args, formatCharacterErrors(loaded.errors), io)
      return 2
    }
    const skin = skinErrors(loaded.value)
    if (skin !== '') {
      writeError(args, skin, io)
      return 2
    }
    return analyse(loaded.value, args.out, io)
  } catch (err) {
    writeError(args, failureText(err), io)
    return 2
  }
}
