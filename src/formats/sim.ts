import type { Vec3 } from '../math/vec.ts'
import { scriptDuration } from '../motion/script.ts'
import type { Script } from '../motion/script.ts'
import type { Mannequin } from './mannequin.ts'
import {
  checkKnownKeys, copyKnownKeys, isDirection, isFiniteNumber, isNonEmptyString, isPositive, isRecord, isVec3
} from './validate.ts'
import type { Validated, ValidationError } from './validate.ts'

export type SimMaterial = {
  name: string
  particleMass: number
  stretchCompliance: number
  bendCompliance: number
  damping: number
  drag: number
}

export type Cape = {
  anchorLeft: string
  anchorRight: string
  columns: number
  rows: number
  length: number
  material: string
}

export type Chain = { anchor: string, links: number, linkLength: number, direction: Vec3, material: string }

export type Wind = { direction: Vec3, speed: number, gust: number }

export type Scenario = {
  name: string
  body: string
  bodyExcludeParts: string[]
  script: Script
  cape?: Cape
  chains: Chain[]
  wind?: Wind
  gravity: Vec3
  fps: number
  substeps: number
  particleRadius: number
  durationSeconds?: number
}

const MATERIAL_FIELDS = ['name', 'particleMass', 'stretchCompliance', 'bendCompliance', 'damping', 'drag'] as const
const SCENARIO_FIELDS = [
  'name', 'body', 'bodyExcludeParts', 'script', 'cape', 'chains', 'wind', 'gravity', 'fps', 'substeps',
  'particleRadius', 'durationSeconds'
] as const
const SCRIPT_FIELDS = ['segments', 'accelSeconds'] as const
const SEGMENT_FIELDS = {
  move: ['action', 'speed', 'duration'],
  turn: ['action', 'degrees', 'duration'],
  hold: ['action', 'duration']
} as const
const CAPE_FIELDS = ['anchorLeft', 'anchorRight', 'columns', 'rows', 'length', 'material'] as const
const CHAIN_FIELDS = ['anchor', 'links', 'linkLength', 'direction', 'material'] as const
const WIND_FIELDS = ['direction', 'speed', 'gust'] as const

function isNonNegative (v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0
}

function isIntegerBetween (v: unknown, minimum: number, maximum: number): v is number {
  return Number.isInteger(v) && (v as number) >= minimum && (v as number) <= maximum
}

function isPositiveAtMost (v: unknown, maximum: number): v is number {
  return isPositive(v) && v <= maximum
}

export function scenarioDuration (scenario: Scenario): number {
  return scenario.durationSeconds ?? scriptDuration(scenario.script) + 3
}

function expect (ok: boolean, path: string, message: string, errors: ValidationError[]): void {
  if (!ok) errors.push({ path, message })
}

export function validateSimMaterials (input: unknown): Validated<SimMaterial[]> {
  if (!Array.isArray(input)) {
    return { errors: [{ path: '', message: 'expected an array of materials' }] }
  }
  if (input.length === 0) return { errors: [{ path: '', message: 'expected at least one material' }] }
  const errors: ValidationError[] = []
  const names = new Set<string>()
  input.forEach((material, i) => {
    const path = `[${i}]`
    if (!isRecord(material)) {
      errors.push({ path, message: 'expected an object' })
      return
    }
    checkKnownKeys(material, MATERIAL_FIELDS, path, errors)
    if (!isNonEmptyString(material.name)) {
      errors.push({ path: `${path}.name`, message: 'expected a non-empty string' })
    } else if (names.has(material.name)) {
      errors.push({ path: `${path}.name`, message: `duplicate material name '${material.name}'` })
    } else {
      names.add(material.name)
    }
    expect(isPositive(material.particleMass), `${path}.particleMass`, 'expected a positive mass in kg', errors)
    for (const field of ['stretchCompliance', 'bendCompliance'] as const) {
      expect(isNonNegative(material[field]), `${path}.${field}`, 'expected a number >= 0 in m/N', errors)
    }
    expect(isNonNegative(material.damping), `${path}.damping`, 'expected a number >= 0 in 1/s', errors)
    expect(isNonNegative(material.drag), `${path}.drag`, 'expected a number >= 0 in N per (m/s)', errors)
  })
  if (errors.length > 0) return { errors }
  return { value: input.map(m => copyKnownKeys<SimMaterial>(m as Record<string, unknown>, MATERIAL_FIELDS)), errors }
}

export function validateScenario (input: unknown): Validated<Scenario> {
  if (!isRecord(input)) return { errors: [{ path: '', message: 'expected a JSON object' }] }
  const errors: ValidationError[] = []
  checkKnownKeys(input, SCENARIO_FIELDS, '', errors)
  expect(isNonEmptyString(input.name), 'name', 'expected a non-empty string', errors)
  expect(isNonEmptyString(input.body), 'body', 'expected a path to a mannequin JSON, relative to this file', errors)
  const exclude = input.bodyExcludeParts
  if (!Array.isArray(exclude) || !exclude.every(isNonEmptyString)) {
    errors.push({ path: 'bodyExcludeParts', message: 'expected an array of part names (may be empty)' })
  } else {
    exclude.forEach((name, i) => {
      if (exclude.indexOf(name) !== i) {
        errors.push({ path: `bodyExcludeParts[${i}]`, message: `duplicate part name '${name}'` })
      }
    })
  }
  validateScript(input.script, errors)
  if (input.cape !== undefined) validateCape(input.cape, errors)
  if (!Array.isArray(input.chains)) {
    errors.push({ path: 'chains', message: 'expected an array of chains (may be empty)' })
  } else {
    input.chains.forEach((chain, i) => { validateChain(chain, `chains[${i}]`, errors) })
  }
  if (input.wind !== undefined) validateWind(input.wind, errors)
  expect(isVec3(input.gravity), 'gravity', 'expected [x, y, z] in m/s^2, for example [0, -9.81, 0]', errors)
  expect(isPositiveAtMost(input.fps, 120), 'fps', 'expected a number of output frames per second up to 120', errors)
  expect(isIntegerBetween(input.substeps, 1, 100), 'substeps', 'expected an integer from 1 to 100', errors)
  expect(isPositive(input.particleRadius), 'particleRadius', 'expected a positive radius in metres', errors)
  if (input.durationSeconds !== undefined) {
    expect(
      isPositiveAtMost(input.durationSeconds, 600),
      'durationSeconds',
      'expected a number of seconds up to 600',
      errors
    )
  }
  if (errors.length > 0) return { errors }
  return { value: copyKnownKeys<Scenario>(input, SCENARIO_FIELDS), errors }
}

function validateScript (script: unknown, errors: ValidationError[]): void {
  if (!isRecord(script)) {
    errors.push({ path: 'script', message: 'expected an object with segments and accelSeconds' })
    return
  }
  checkKnownKeys(script, SCRIPT_FIELDS, 'script', errors)
  expect(isNonNegative(script.accelSeconds), 'script.accelSeconds', 'expected a number of seconds >= 0', errors)
  if (!Array.isArray(script.segments)) {
    errors.push({ path: 'script.segments', message: 'expected an array of segments (may be empty)' })
    return
  }
  script.segments.forEach((segment, i) => { validateSegment(segment, `script.segments[${i}]`, errors) })
  const last = script.segments[script.segments.length - 1]
  if (script.segments.length > 0 && !(isRecord(last) && last.action === 'hold')) {
    const message = "expected the last segment to be a 'hold', so the motion ends at rest"
    errors.push({ path: 'script.segments', message })
  }
}

function validateSegment (segment: unknown, path: string, errors: ValidationError[]): void {
  if (!isRecord(segment)) {
    errors.push({ path, message: 'expected an object' })
    return
  }
  const action = segment.action
  if (action !== 'move' && action !== 'turn' && action !== 'hold') {
    const message = `unknown action '${String(action)}'; expected 'move', 'turn' or 'hold'`
    errors.push({ path: `${path}.action`, message })
    return
  }
  checkKnownKeys(segment, SEGMENT_FIELDS[action], path, errors)
  expect(isPositiveAtMost(segment.duration, 600), `${path}.duration`, 'expected seconds above 0 and up to 600', errors)
  if (action === 'move') {
    expect(isNonNegative(segment.speed), `${path}.speed`, 'expected a speed >= 0 in m/s', errors)
  } else if (action === 'turn') {
    expect(isFiniteNumber(segment.degrees), `${path}.degrees`, 'expected a yaw change in degrees', errors)
  }
}

function validateMaterialName (record: Record<string, unknown>, path: string, errors: ValidationError[]): void {
  expect(isNonEmptyString(record.material), `${path}.material`, 'expected a material name', errors)
}

function validateCape (cape: unknown, errors: ValidationError[]): void {
  if (!isRecord(cape)) {
    errors.push({ path: 'cape', message: 'expected an object' })
    return
  }
  checkKnownKeys(cape, CAPE_FIELDS, 'cape', errors)
  expect(isNonEmptyString(cape.anchorLeft), 'cape.anchorLeft', 'expected a joint name', errors)
  expect(isNonEmptyString(cape.anchorRight), 'cape.anchorRight', 'expected a joint name', errors)
  expect(isIntegerBetween(cape.columns, 2, 64), 'cape.columns', 'expected an integer from 2 to 64', errors)
  expect(isIntegerBetween(cape.rows, 2, 64), 'cape.rows', 'expected an integer from 2 to 64', errors)
  expect(isPositive(cape.length), 'cape.length', 'expected a positive length in metres', errors)
  validateMaterialName(cape, 'cape', errors)
}

function validateChain (chain: unknown, path: string, errors: ValidationError[]): void {
  if (!isRecord(chain)) {
    errors.push({ path, message: 'expected an object' })
    return
  }
  checkKnownKeys(chain, CHAIN_FIELDS, path, errors)
  expect(isNonEmptyString(chain.anchor), `${path}.anchor`, 'expected a joint name', errors)
  expect(isIntegerBetween(chain.links, 1, 64), `${path}.links`, 'expected an integer from 1 to 64', errors)
  expect(isPositive(chain.linkLength), `${path}.linkLength`, 'expected a positive length in metres', errors)
  expect(isDirection(chain.direction), `${path}.direction`, 'expected a non-zero [x, y, z]', errors)
  validateMaterialName(chain, path, errors)
}

function validateWind (wind: unknown, errors: ValidationError[]): void {
  if (!isRecord(wind)) {
    errors.push({ path: 'wind', message: 'expected an object' })
    return
  }
  checkKnownKeys(wind, WIND_FIELDS, 'wind', errors)
  expect(isDirection(wind.direction), 'wind.direction', 'expected a non-zero [x, y, z]', errors)
  expect(isNonNegative(wind.speed), 'wind.speed', 'expected a speed >= 0 in m/s', errors)
  expect(
    isFiniteNumber(wind.gust) && wind.gust >= 0 && wind.gust <= 1,
    'wind.gust',
    'expected a fraction of the wind speed between 0 and 1',
    errors
  )
}

export function checkScenario (
  scenario: Scenario,
  mannequin: Mannequin,
  materials: SimMaterial[]
): ValidationError[] {
  const errors: ValidationError[] = []
  const partNames = mannequin.parts.map(p => p.name)
  const materialNames = materials.map(m => m.name)
  const jointNames = Object.keys(mannequin.joints)
  const check = (value: string, known: string[], kind: string, path: string): void => {
    if (known.includes(value)) return
    errors.push({ path, message: `unknown ${kind} '${value}'; known ${kind}s: ${known.join(', ')}` })
  }
  scenario.bodyExcludeParts.forEach((name, i) => { check(name, partNames, 'part', `bodyExcludeParts[${i}]`) })
  if (scenario.cape !== undefined) {
    check(scenario.cape.anchorLeft, jointNames, 'joint', 'cape.anchorLeft')
    check(scenario.cape.anchorRight, jointNames, 'joint', 'cape.anchorRight')
    check(scenario.cape.material, materialNames, 'material', 'cape.material')
    checkCapeWidth(scenario.cape, mannequin, errors)
  }
  scenario.chains.forEach((chain, i) => {
    check(chain.anchor, jointNames, 'joint', `chains[${i}].anchor`)
    check(chain.material, materialNames, 'material', `chains[${i}].material`)
  })
  return errors
}

function checkCapeWidth (cape: Cape, mannequin: Mannequin, errors: ValidationError[]): void {
  const path = 'cape.anchorRight'
  if (cape.anchorLeft === cape.anchorRight) {
    errors.push({ path, message: 'expected a different joint from anchorLeft, or the cape has no width' })
    return
  }
  const left = mannequin.joints[cape.anchorLeft]
  const right = mannequin.joints[cape.anchorRight]
  if (left !== undefined && right !== undefined && left.every((value, i) => value === right[i])) {
    const message = `joints '${cape.anchorLeft}' and '${cape.anchorRight}' coincide, so the cape has no width`
    errors.push({ path, message })
  }
}
