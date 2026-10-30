import { length, sub } from '../math/vec.ts'
import type { Mannequin } from './mannequin.ts'
import type { Cape } from './sim.ts'
import { checkKnownKeys, copyKnownKeys, isFiniteNumber, isNonEmptyString, isRecord } from './validate.ts'
import type { Validated, ValidationError } from './validate.ts'

export type Bend = 'forward' | 'backward'
export type Leg = {
  side: 'left' | 'right'
  hip: string
  knee: string
  ankle: string
  toe: string
  phase?: number
  bend?: Bend
}
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
const LEG_FIELDS = ['side', ...LEG_JOINTS, 'phase', 'bend'] as const
const WALK_ORDER = 'left hind 0, left front 0.25, right hind 0.5, right front 0.75'
const PHASE_TOLERANCE = 1e-9
const NON_JOINT_FIELDS: ReadonlySet<string> = new Set(['side', 'carried', 'phase', 'bend'])
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

/** Gait cycle offset of every leg: the leg's `phase`, else 0 for a left and 0.5 for a right leg. */
export function legPhases (rig: Rig): number[] {
  return rig.legs.map(leg => leg.phase ?? (leg.side === 'left' ? 0 : 0.5))
}

export function legBend (leg: Leg): Bend {
  return leg.bend ?? 'forward'
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
    if (path === 'legs') validateLegGait(limb, here, value.length, errors)
    for (const field of fields.filter(f => !NON_JOINT_FIELDS.has(f))) {
      if (!isNonEmptyString(limb[field])) errors.push({ path: `${here}.${field}`, message: 'expected a joint name' })
    }
    if (fields.includes('carried') && limb.carried !== undefined) {
      const ok = Array.isArray(limb.carried) && limb.carried.every(isNonEmptyString)
      if (!ok) errors.push({ path: `${here}.carried`, message: 'expected an array of joint names' })
    }
  })
  if (path === 'legs' && value.length !== 2 && value.length !== 4) {
    errors.push({ path, message: `expected two or four legs; found ${value.length}` })
  }
}

function validateLegGait (leg: Record<string, unknown>, here: string, count: number, errors: ValidationError[]): void {
  const { phase, bend } = leg
  if (phase === undefined && count === 4) {
    errors.push({
      path: `${here}.phase`,
      message: `expected a number from 0 up to 1: four legs need a phase each (the usual walk order is ${WALK_ORDER})`
    })
  } else if (phase !== undefined && !(isFiniteNumber(phase) && phase >= 0 && phase < 1)) {
    const message = "expected a number from 0 up to 1: the leg's offset in the gait cycle"
    errors.push({ path: `${here}.phase`, message })
  }
  if (bend !== undefined && bend !== 'forward' && bend !== 'backward') {
    errors.push({ path: `${here}.bend`, message: "expected 'forward' or 'backward': the side the knee points" })
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
  checkBones(rig, mannequin, errors)
  const sides = rig.legs.map(l => l.side).sort().join(',')
  const expected = rig.legs.length === 4 ? 'left,left,right,right' : 'left,right'
  if (sides !== expected) {
    const want = rig.legs.length === 4 ? 'two left and two right legs' : 'one left and one right leg'
    errors.push({ path: 'legs', message: `expected ${want}; found ${sides}` })
  }
  errors.push(...checkStance(rig))
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

function checkStance (rig: Rig): ValidationError[] {
  const phases = legPhases(rig).sort((a, b) => a - b)
  const widest = Math.max(...phases.map((p, i) => (phases[(i + 1) % phases.length] - p + 1) % 1 || 1))
  const needed = 1 - widest
  if (rig.gait.stanceFraction >= needed - PHASE_TOLERANCE) return []
  return [{
    path: 'gait.stanceFraction',
    message: `with these leg phases a foot is always in the air, so the character could never stand still; ` +
      `raise stanceFraction to at least ${Math.ceil(needed * 1000 - 1e-6) / 1000} (now ${rig.gait.stanceFraction})`
  }]
}

const BONES: Record<'legs' | 'arms', Array<readonly [string, string]>> = {
  legs: [['hip', 'knee'], ['knee', 'ankle'], ['ankle', 'toe']],
  arms: [['shoulder', 'elbow'], ['elbow', 'wrist']]
}
const MIN_BONE_LENGTH = 1e-6

function checkBones (rig: Rig, mannequin: Mannequin, errors: ValidationError[]): void {
  for (const group of ['legs', 'arms'] as const) {
    rig[group].forEach((limb: Record<string, unknown>, i) => {
      for (const [from, to] of BONES[group]) {
        const a = mannequin.joints[limb[from] as string]
        const b = mannequin.joints[limb[to] as string]
        if (a === undefined || b === undefined || length(sub(a, b)) >= MIN_BONE_LENGTH) continue
        errors.push({
          path: `${group}[${i}]`,
          message: `joints '${limb[from]}' and '${limb[to]}' are at the same position, which gives a zero-length ` +
            'bone; move them apart in the mannequin'
        })
      }
    })
  }
}

function groupOf (rig: Rig, joint: string): string {
  if (rig.pelvis === joint || rig.upperBody.includes(joint)) return 'rigid'
  if (rig.legs.some(leg => LEG_JOINTS.some(f => leg[f] === joint))) return 'a leg joint'
  const arm = rig.arms.find(a => ARM_JOINTS.some(f => a[f] === joint) || a.carried?.includes(joint))
  return arm === undefined ? 'unlisted' : 'an arm joint'
}

export function checkCapeAnchors (cape: Pick<Cape, 'anchorLeft' | 'anchorRight'>, rig: Rig): ValidationError[] {
  const errors: ValidationError[] = []
  for (const field of ['anchorLeft', 'anchorRight'] as const) {
    const joint = cape[field]
    const group = groupOf(rig, joint)
    if (group === 'rigid' || group === 'unlisted') continue
    errors.push({
      path: `cape.${field}`,
      message: `'${joint}' is ${group}, which moves on its own; both cape ` +
        'anchors must be pelvis or upperBody joints, which move together rigidly (the cloth is pinned to the body ' +
        'as one piece)'
    })
  }
  return errors
}
