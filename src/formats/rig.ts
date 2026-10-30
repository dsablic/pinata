import type { Mannequin } from './mannequin.ts'
import { checkKnownKeys, copyKnownKeys, isFiniteNumber, isNonEmptyString, isRecord } from './validate.ts'
import type { Validated, ValidationError } from './validate.ts'

export type Leg = { side: 'left' | 'right', hip: string, knee: string, ankle: string, toe: string }
export type Arm = {
  side: 'left' | 'right'
  shoulder: string
  elbow: string
  wrist: string
  hand: string
  carried?: string[]
}
export type Gait = {
  strideLength: number
  referenceSpeed: number
  stanceFraction: number
  stepHeight: number
  bobAmplitude: number
  armSwingDegrees: number
  footSpacing: number
  strideExponent?: number
}
export type Rig = { legs: Leg[], arms: Arm[], pelvis: string, upperBody: string[], gait: Gait }

const RIG_FIELDS = ['legs', 'arms', 'pelvis', 'upperBody', 'gait'] as const
const LEG_JOINTS = ['hip', 'knee', 'ankle', 'toe'] as const
const ARM_JOINTS = ['shoulder', 'elbow', 'wrist', 'hand'] as const
const LEG_FIELDS = ['side', ...LEG_JOINTS] as const
const ARM_FIELDS = ['side', ...ARM_JOINTS, 'carried'] as const
const GAIT_FIELDS = [
  'strideLength', 'referenceSpeed', 'stanceFraction', 'stepHeight', 'bobAmplitude', 'armSwingDegrees', 'footSpacing',
  'strideExponent'
] as const

const GAIT_RANGES: Record<keyof Gait, { min: number, max: number, note: string }> = {
  strideLength: { min: 0, max: 10, note: 'metres per full cycle, above 0 and at most 10' },
  referenceSpeed: { min: 0, max: 20, note: 'm/s, above 0 and at most 20' },
  stanceFraction: { min: 0.5, max: 0.8, note: 'fraction of the cycle a foot is planted, 0.5 to 0.8' },
  stepHeight: { min: 0, max: 2, note: 'metres of swing-foot lift, 0 to 2' },
  bobAmplitude: { min: 0, max: 1, note: 'metres of pelvis bob, 0 to 1' },
  armSwingDegrees: { min: 0, max: 90, note: 'degrees, 0 to 90' },
  footSpacing: { min: 0, max: 2, note: 'metres between foot plants, 0 to 2' },
  strideExponent: { min: 0.2, max: 1, note: 'how fast stride grows with speed, 0.2 to 1, default 0.5' }
}
const OPTIONAL_GAIT: ReadonlySet<string> = new Set(['strideExponent'])
const EXCLUSIVE_MINIMUM: ReadonlySet<string> = new Set(['strideLength', 'referenceSpeed'])

export function stride (gait: Gait, speed: number): number {
  const ratio = (Math.max(0, speed) / gait.referenceSpeed) ** (gait.strideExponent ?? 0.5)
  return gait.strideLength * Math.min(1.5, Math.max(0.5, ratio))
}

export function validateRig (input: unknown): Validated<Rig> {
  if (!isRecord(input)) return { errors: [{ path: '', message: 'expected a JSON object' }] }
  const errors: ValidationError[] = []
  checkKnownKeys(input, RIG_FIELDS, '', errors)
  validateLimbs(input.legs, 'legs', LEG_FIELDS, errors)
  validateLimbs(input.arms, 'arms', ARM_FIELDS, errors)
  if (!isNonEmptyString(input.pelvis)) errors.push({ path: 'pelvis', message: 'expected a joint name' })
  if (!Array.isArray(input.upperBody) || !input.upperBody.every(isNonEmptyString)) {
    errors.push({ path: 'upperBody', message: 'expected an array of joint names that move rigidly with the pelvis' })
  }
  validateGait(input.gait, errors)
  if (errors.length > 0) return { errors }
  return { value: copyKnownKeys<Rig>(input, RIG_FIELDS), errors }
}

function validateLimbs (
  value: unknown,
  path: string,
  fields: readonly string[],
  errors: ValidationError[]
): void {
  if (!Array.isArray(value)) {
    errors.push({ path, message: 'expected an array' })
    return
  }
  value.forEach((limb: unknown, i) => {
    const here = `${path}[${i}]`
    if (!isRecord(limb)) {
      errors.push({ path: here, message: 'expected an object' })
      return
    }
    checkKnownKeys(limb, fields, here, errors)
    if (limb.side !== 'left' && limb.side !== 'right') {
      errors.push({ path: `${here}.side`, message: "expected 'left' or 'right'" })
    }
    for (const field of fields.filter(f => f !== 'side' && f !== 'carried')) {
      if (!isNonEmptyString(limb[field])) errors.push({ path: `${here}.${field}`, message: 'expected a joint name' })
    }
    if (fields.includes('carried') && limb.carried !== undefined) {
      const ok = Array.isArray(limb.carried) && limb.carried.every(isNonEmptyString)
      if (!ok) errors.push({ path: `${here}.carried`, message: 'expected an array of joint names' })
    }
  })
  if (path === 'legs' && value.length !== 2) {
    errors.push({ path, message: `expected exactly two legs, one left and one right; found ${value.length}` })
  }
}

function validateGait (gait: unknown, errors: ValidationError[]): void {
  if (!isRecord(gait)) {
    errors.push({ path: 'gait', message: `expected an object with ${GAIT_FIELDS.join(', ')}` })
    return
  }
  checkKnownKeys(gait, GAIT_FIELDS, 'gait', errors)
  for (const field of GAIT_FIELDS) {
    const { min, max, note } = GAIT_RANGES[field]
    const v = gait[field]
    if (v === undefined && OPTIONAL_GAIT.has(field)) continue
    const ok = isFiniteNumber(v) && (EXCLUSIVE_MINIMUM.has(field) ? v > min : v >= min) && v <= max
    if (!ok) errors.push({ path: `gait.${field}`, message: `expected a number: ${note}` })
  }
}

export function checkRig (rig: Rig, mannequin: Mannequin): ValidationError[] {
  const errors: ValidationError[] = []
  const known = Object.keys(mannequin.joints)
  const used = new Map<string, string>()
  const use = (joint: string, path: string): void => {
    if (!known.includes(joint)) {
      errors.push({ path, message: `unknown joint '${joint}'; known joints: ${known.join(', ')}` })
      return
    }
    const first = used.get(joint)
    if (first !== undefined) {
      errors.push({ path, message: `joint '${joint}' is already used by ${first}; each joint belongs to one group` })
      return
    }
    used.set(joint, path)
  }
  rig.legs.forEach((leg, i) => {
    for (const f of LEG_JOINTS) use(leg[f], `legs[${i}].${f}`)
  })
  rig.arms.forEach((arm, i) => {
    for (const f of ARM_JOINTS) use(arm[f], `arms[${i}].${f}`)
    arm.carried?.forEach((joint, k) => { use(joint, `arms[${i}].carried[${k}]`) })
  })
  use(rig.pelvis, 'pelvis')
  rig.upperBody.forEach((joint, i) => { use(joint, `upperBody[${i}]`) })
  const sides = rig.legs.map(l => l.side).sort().join(',')
  if (sides !== 'left,right') {
    errors.push({ path: 'legs', message: `expected one left and one right leg; found ${sides}` })
  }
  const missing = known.filter(joint => !used.has(joint))
  if (missing.length > 0) {
    errors.push({
      path: 'upperBody',
      message: `joints not moved by any group would stay at rest: ${missing.map(j => `'${j}'`).join(', ')}; ` +
        'add them to upperBody, legs, arms or pelvis'
    })
  }
  return errors
}
