import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { verticalExtent } from '../motion/extent.ts'
import { steadySegments } from '../motion/metrics.ts'
import { restPose, soleHeight } from '../motion/pose.ts'
import { checkRenderMaterials, checkScenario, validateScenario, validateSimMaterials } from './sim.ts'
import type { Scenario, SimMaterial } from './sim.ts'
import { checkReferences } from './references.ts'
import { validateMannequin } from './mannequin.ts'
import type { Mannequin } from './mannequin.ts'
import { checkCapeAnchors, checkRig, legsOf, validateRig } from './rig.ts'
import type { Rig } from './rig.ts'
import { validateStyle } from './style.ts'
import type { Style } from './style.ts'
import { checkKnownKeys, isNonEmptyString, isRecord } from './validate.ts'
import type { Validated, ValidationError } from './validate.ts'

export type CharacterFiles = { mannequin: string, style: string, rig: string, materials: string, motion: string }

export type Character = {
  name: string
  description: string
  dir: string
  files: CharacterFiles
  mannequin: Mannequin
  style: Style
  rig: Rig
  materials: SimMaterial[]
  scenario: Scenario
}

const MANIFEST_FILE = 'character.json'
const DEFAULT_FILES: CharacterFiles = {
  mannequin: 'mannequin.json',
  style: 'style.json',
  rig: 'rig.json',
  materials: 'materials.json',
  motion: 'motion.json'
}
const FILE_KEYS = Object.keys(DEFAULT_FILES) as Array<keyof CharacterFiles>
const MANIFEST_FIELDS = ['name', 'description', ...FILE_KEYS]
const MOTION_FIELDS = [
  'exclude', 'script', 'cape', 'chains', 'wind', 'gravity', 'fps', 'substeps', 'particleRadius', 'durationSeconds'
]

type Errors = ValidationError[]

function tag (file: string, errors: Errors): Errors {
  return errors.map(e => ({ path: `${file}: ${e.path === '' ? '(root)' : e.path}`, message: e.message }))
}

/** One line per error: `file: path: message`. The file name is the first part of each error's path. */
export function formatCharacterErrors (errors: Errors): string {
  return errors.map(e => `${e.path}: ${e.message}`).join('\n')
}

function readJson (dir: string, file: string, errors: Errors): unknown {
  try {
    return JSON.parse(readFileSync(join(dir, file), 'utf8'))
  } catch (err) {
    if (err instanceof SyntaxError) errors.push(...tag(file, [{ path: '', message: `invalid JSON: ${err.message}` }]))
    else if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      errors.push(...tag(file, [{ path: '', message: 'file not found' }]))
    } else if ((err as NodeJS.ErrnoException).code === 'EISDIR') {
      errors.push(...tag(file, [{ path: '', message: 'expected a file, found a directory' }]))
    } else throw err
    return undefined
  }
}

type Validator<T> = (input: unknown) => Validated<T>

function load<T> (dir: string, file: string, validate: Validator<T>, errors: Errors): T | undefined {
  const input = readJson(dir, file, errors)
  if (input === undefined) return undefined
  const result = validate(input)
  errors.push(...tag(file, result.errors))
  return result.errors.length > 0 ? undefined : result.value
}

function resolveFiles (manifest: Record<string, unknown>, errors: Errors): CharacterFiles {
  const files = { ...DEFAULT_FILES }
  for (const key of FILE_KEYS) {
    const value = manifest[key]
    if (value === undefined) continue
    if (!isNonEmptyString(value) || isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
      const message = `expected a file name inside the character directory, default '${DEFAULT_FILES[key]}'`
      errors.push(...tag(MANIFEST_FILE, [{ path: key, message }]))
    } else files[key] = value
  }
  return files
}

function validateManifest (input: unknown, errors: Errors): Record<string, unknown> | undefined {
  if (!isRecord(input)) {
    errors.push(...tag(MANIFEST_FILE, [{ path: '', message: 'expected a JSON object' }]))
    return undefined
  }
  const found: Errors = []
  checkKnownKeys(input, MANIFEST_FIELDS, '', found)
  if (!isNonEmptyString(input.name)) found.push({ path: 'name', message: 'expected a non-empty string' })
  if (input.description !== undefined && typeof input.description !== 'string') {
    found.push({ path: 'description', message: 'expected a string' })
  }
  errors.push(...tag(MANIFEST_FILE, found))
  return input
}

function fromExclude (errors: Errors): Errors {
  return errors.map(e => ({ ...e, path: e.path.replace(/^bodyExcludeParts/, 'exclude') }))
}

function validateMotion (name: string, body: string): (input: unknown) => Validated<Scenario> {
  return input => {
    if (!isRecord(input)) return { errors: [{ path: '', message: 'expected a JSON object' }] }
    const errors: Errors = []
    checkKnownKeys(input, MOTION_FIELDS, '', errors)
    const known = Object.fromEntries(Object.entries(input).filter(([key]) => MOTION_FIELDS.includes(key)))
    const { exclude, ...rest } = known
    const result = validateScenario({ chains: [], ...rest, name, body, bodyExcludeParts: exclude ?? [] })
    errors.push(...fromExclude(result.errors))
    return { value: result.value, errors }
  }
}

function checkFeet (rig: Rig, mannequin: Mannequin): Errors {
  const errors: Errors = []
  for (const leg of legsOf(rig)) {
    const foot = mannequin.parts.some(p => p.shape === 'capsule' && p.a === leg.ankle && p.b === leg.toe)
    if (foot) continue
    const message = `no capsule part in the mannequin spans ankle '${leg.ankle}' to toe '${leg.toe}'; ` +
      'the foot is a capsule from the ankle joint to the toe joint, and its radii set the sole height'
    errors.push({ path: `limbs[${leg.index}]`, message })
  }
  return errors
}

const HEIGHT_TOLERANCE = 0.1

function checkHeight (rig: Rig, mannequin: Mannequin): Errors {
  const rest = restPose(mannequin)
  const lowest = Math.min(...legsOf(rig).map(leg => soleHeight(leg, rest, mannequin)))
  const top = Math.max(...mannequin.parts.map(part => verticalExtent(part, rest).high))
  const span = top - lowest
  if (Math.abs(mannequin.height - span) <= HEIGHT_TOLERANCE * span) return []
  const message = `${mannequin.height} m differs from the parts, which span ${span.toFixed(3)} m from the lowest ` +
    `sole point (y = ${lowest.toFixed(3)}) to the top of the highest part (y = ${top.toFixed(3)}); set height to ` +
    'about that span, since height scales the figure to pixels'
  return [{ path: 'height', message }]
}

function checkWalk (scenario: Scenario): Errors {
  if (steadySegments(scenario.script).some(s => s.speed > 0)) return []
  const message = "no steady walking window: add a 'move' segment with speed above 0 that lasts longer than " +
    'script.accelSeconds and does not overlap a turn, so the locomotion gates have something to measure'
  return [{ path: 'script.segments', message }]
}

function crossChecks (parts: Omit<Character, 'name' | 'description' | 'dir' | 'files'>, files: CharacterFiles): Errors {
  const { mannequin, style, rig, materials, scenario } = parts
  const feet = checkFeet(rig, mannequin)
  const capeErrors = scenario.cape === undefined ? [] : checkCapeAnchors(scenario.cape, rig)
  return [
    ...tag(files.mannequin, [
      ...checkReferences(mannequin, style), ...(feet.length === 0 ? checkHeight(rig, mannequin) : [])
    ]),
    ...tag(files.rig, [...checkRig(rig, mannequin), ...feet]),
    ...tag(files.motion, [
      ...fromExclude(checkScenario(scenario, mannequin, materials)), 
      ...checkRenderMaterials(scenario, Object.keys(style.materials)),
      ...capeErrors, ...checkWalk(scenario)
    ])
  ]
}

/**
 * Loads `character.json` and the files it names (defaults: mannequin.json, style.json, rig.json, materials.json,
 * motion.json), validates each with its format's validator and then cross-checks them. Every error's path starts
 * with the file name: `file: path`.
 */
export function loadCharacter (dir: string): Validated<Character> {
  const errors: Errors = []
  const input = readJson(dir, MANIFEST_FILE, errors)
  if (input === undefined) return { errors }
  const manifest = validateManifest(input, errors)
  if (manifest === undefined) return { errors }
  const files = resolveFiles(manifest, errors)
  const name = isNonEmptyString(manifest.name) ? manifest.name : 'character'
  const mannequin = load(dir, files.mannequin, validateMannequin, errors)
  const style = load(dir, files.style, validateStyle, errors)
  const rig = load(dir, files.rig, validateRig, errors)
  const materials = load(dir, files.materials, validateSimMaterials, errors)
  const scenario = load(dir, files.motion, validateMotion(name, files.mannequin), errors)
  if (mannequin !== undefined && style !== undefined && rig !== undefined &&
    materials !== undefined && scenario !== undefined) {
    errors.push(...crossChecks({ mannequin, style, rig, materials, scenario }, files))
    if (errors.length === 0) {
      const description = typeof manifest.description === 'string' ? manifest.description : ''
      return { value: { name, description, dir, files, mannequin, style, rig, materials, scenario }, errors }
    }
  }
  return { errors }
}
