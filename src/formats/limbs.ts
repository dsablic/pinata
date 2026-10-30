import type { Vec3 } from '../math/vec.ts'
import { checkKnownKeys, copyKnownKeys, isDirection, isFiniteNumber, isNonEmptyString, isRecord } from './validate.ts'
import type { ValidationError } from './validate.ts'

export type Side = 'left' | 'right'
export type Bend = 'forward' | 'backward'
export type Limits = { min: number, max: number }
export type LegLimb = {
  kind: 'leg'
  name: string
  joints: string[]
  side: Side
  phase?: number
  bend?: Bend | Bend[]
  limits?: Limits
}
export type ArmLimb = { kind: 'arm', name: string, joints: string[], side: Side, carried?: string[] }
export type Oscillator = { axis: Vec3, degrees: number, phase: number }
export type AppendageLimb = {
  kind: 'appendage'
  name: string
  joints: string[]
  side?: Side
  stiffness: number
  damping: number
  oscillate?: Oscillator
}
export type Limb = LegLimb | ArmLimb | AppendageLimb
export type LimbKind = Limb['kind']

export type LegacyLeg = {
  side: Side
  hip: string
  knee: string
  ankle: string
  toe: string
  phase?: number
  bend?: Bend
}
export type LegacyArm = { side: Side, shoulder: string, elbow: string, wrist: string, hand: string, carried?: string[] }

export type Leg = {
  index: number
  limb: LegLimb
  name: string
  side: Side
  joints: string[]
  hip: string
  knee: string
  ankle: string
  toe: string
  phase?: number
  bend?: Bend
}
export type Arm = {
  index: number
  limb: ArmLimb
  name: string
  side: Side
  joints: string[]
  shoulder: string
  elbow: string
  wrist: string
  hand: string
  carried?: string[]
}

type Source = { limbs: readonly Limb[] }

export const MIN_JOINTS: Record<LimbKind, number> = { leg: 3, arm: 2, appendage: 2 }
export const DEFAULT_STIFFNESS = 0.6
export const DEFAULT_DAMPING = 0.4
const MAX_OSCILLATION_DEGREES = 180
const LIMIT_RANGE = 180
const LIMB_FIELDS: Record<LimbKind, readonly string[]> = {
  leg: ['name', 'kind', 'joints', 'side', 'phase', 'bend', 'limits'],
  arm: ['name', 'kind', 'joints', 'side', 'carried'],
  appendage: ['name', 'kind', 'joints', 'side', 'stiffness', 'damping', 'oscillate']
}
const JOINT_NOTE: Record<LimbKind, string> = {
  leg: 'from the hip to the toe',
  arm: 'from the shoulder outward',
  appendage: 'from the root outward'
}
const OSCILLATE_FIELDS = ['axis', 'degrees', 'phase'] as const

export function legsOf ({ limbs }: Source): Leg[] {
  const legs: Leg[] = []
  limbs.forEach((limb, index) => {
    if (limb.kind !== 'leg') return
    const { joints } = limb
    legs.push({
      index,
      limb,
      name: limb.name,
      side: limb.side,
      joints,
      hip: joints[0],
      knee: joints[1],
      ankle: joints[joints.length - 2],
      toe: joints[joints.length - 1],
      phase: limb.phase,
      bend: Array.isArray(limb.bend) ? limb.bend[0] : limb.bend
    })
  })
  return legs
}

/** Arms with the four joints (shoulder, elbow, wrist, hand) the locomotion code moves; longer or shorter arms wait. */
export function armsOf ({ limbs }: Source): Arm[] {
  const arms: Arm[] = []
  limbs.forEach((limb, index) => {
    if (limb.kind !== 'arm' || limb.joints.length !== 4) return
    const [shoulder, elbow, wrist, hand] = limb.joints
    arms.push({
      index, limb, name: limb.name, side: limb.side, joints: limb.joints, shoulder, elbow, wrist, hand,
      carried: limb.carried
    })
  })
  return arms
}

export function translateLegacy (legs: readonly LegacyLeg[], arms: readonly LegacyArm[]): Limb[] {
  const legLimbs = legs.map((leg, i): Limb => {
    const limb: LegLimb = {
      kind: 'leg', name: `leg${i + 1}`, joints: [leg.hip, leg.knee, leg.ankle, leg.toe], side: leg.side
    }
    if (leg.phase !== undefined) limb.phase = leg.phase
    if (leg.bend !== undefined) limb.bend = leg.bend
    return limb
  })
  const armLimbs = arms.map((arm, i): Limb => {
    const limb: ArmLimb = {
      kind: 'arm', name: `arm${i + 1}`, joints: [arm.shoulder, arm.elbow, arm.wrist, arm.hand], side: arm.side
    }
    if (arm.carried !== undefined) limb.carried = arm.carried
    return limb
  })
  return [...legLimbs, ...armLimbs]
}

type Context = { phaseRequired: boolean, legCount: number }

function isKind (v: unknown): v is LimbKind {
  return v === 'leg' || v === 'arm' || v === 'appendage'
}

function isSide (v: unknown): v is Side {
  return v === 'left' || v === 'right'
}

export function validateLimbList (value: unknown, phaseRequired: boolean, errors: ValidationError[]): Limb[] {
  if (!Array.isArray(value)) {
    errors.push({ path: 'limbs', message: 'expected an array of limbs, each with a kind of leg, arm or appendage' })
    return []
  }
  const legCount = value.filter(l => isRecord(l) && l.kind === 'leg').length
  const counts: Record<LimbKind, number> = { leg: 0, arm: 0, appendage: 0 }
  const limbs: Limb[] = []
  const names = new Map<string, number>()
  value.forEach((input: unknown, i) => {
    const here = `limbs[${i}]`
    if (!isRecord(input)) {
      errors.push({ path: here, message: 'expected an object' })
      return
    }
    if (!isKind(input.kind)) {
      errors.push({ path: `${here}.kind`, message: "expected 'leg', 'arm' or 'appendage'" })
      return
    }
    const { kind } = input
    counts[kind]++
    const before = errors.length
    checkKnownKeys(input, LIMB_FIELDS[kind], here, errors)
    validateName(input, here, names, i, errors)
    validateJoints(input, kind, here, errors)
    if (kind !== 'appendage' || input.side !== undefined) validateSide(input, kind, here, errors)
    if (kind === 'leg') validateLeg(input, here, { phaseRequired, legCount }, errors)
    if (kind === 'arm') validateCarried(input, here, errors)
    if (kind === 'appendage') validateAppendage(input, here, errors)
    if (errors.length > before) return
    const limb = copyKnownKeys<Limb>(input, LIMB_FIELDS[kind])
    if (input.name === undefined) limb.name = `${kind}${counts[kind]}`
    if (limb.kind === 'appendage') {
      limb.stiffness ??= DEFAULT_STIFFNESS
      limb.damping ??= DEFAULT_DAMPING
      if (limb.oscillate !== undefined) limb.oscillate.phase ??= 0
    }
    limbs.push(limb)
  })
  return limbs
}

function validateName (
  limb: Record<string, unknown>,
  here: string,
  names: Map<string, number>,
  index: number,
  errors: ValidationError[]
): void {
  if (limb.name === undefined) return
  if (!isNonEmptyString(limb.name)) {
    errors.push({ path: `${here}.name`, message: 'expected a non-empty name' })
    return
  }
  const first = names.get(limb.name)
  if (first !== undefined) {
    errors.push({ path: `${here}.name`, message: `name '${limb.name}' is already used by limbs[${first}]` })
    return
  }
  names.set(limb.name, index)
}

function validateJoints (limb: Record<string, unknown>, kind: LimbKind, here: string, errors: ValidationError[]): void {
  const { joints } = limb
  const min = MIN_JOINTS[kind]
  if (!Array.isArray(joints) || joints.length < min) {
    const found = Array.isArray(joints) ? `; found ${joints.length}` : ''
    errors.push({
      path: `${here}.joints`,
      message: `expected an array of ${min} or more joint names ${JOINT_NOTE[kind]}${found}`
    })
    return
  }
  joints.forEach((joint: unknown, j) => {
    if (!isNonEmptyString(joint)) errors.push({ path: `${here}.joints[${j}]`, message: 'expected a joint name' })
  })
}

function validateSide (limb: Record<string, unknown>, kind: LimbKind, here: string, errors: ValidationError[]): void {
  if (isSide(limb.side)) return
  const note = kind === 'appendage' ? '' : `: a ${kind} belongs to the left or the right side of the body`
  errors.push({ path: `${here}.side`, message: `expected 'left' or 'right'${note}` })
}

function validateCarried (limb: Record<string, unknown>, here: string, errors: ValidationError[]): void {
  if (limb.carried === undefined) return
  const ok = Array.isArray(limb.carried) && limb.carried.every(isNonEmptyString)
  if (!ok) errors.push({ path: `${here}.carried`, message: 'expected an array of joint names' })
}

function validateLeg (limb: Record<string, unknown>, here: string, context: Context, errors: ValidationError[]): void {
  validateLegPhase(limb.phase, here, context, errors)
  validateBend(limb, here, errors)
  validateLimits(limb.limits, here, errors)
}

export function validateLegPhase (phase: unknown, here: string, context: Context, errors: ValidationError[]): void {
  if (phase === undefined && context.phaseRequired && context.legCount > 2) {
    errors.push({
      path: `${here}.phase`,
      message: `expected a number from 0 up to 1: ${context.legCount} legs need a phase each (the usual walk ` +
        'order for four is left hind 0, left front 0.25, right hind 0.5, right front 0.75), or name a template'
    })
  } else if (phase !== undefined && !(isFiniteNumber(phase) && phase >= 0 && phase < 1)) {
    const message = "expected a number from 0 up to 1: the leg's offset in the gait cycle"
    errors.push({ path: `${here}.phase`, message })
  }
}

function validateBend (limb: Record<string, unknown>, here: string, errors: ValidationError[]): void {
  const { bend, joints } = limb
  if (bend === undefined) return
  const isBend = (v: unknown): boolean => v === 'forward' || v === 'backward'
  const expected = Array.isArray(joints) ? joints.length - 2 : 1
  if (Array.isArray(bend)) {
    if (bend.length === expected && bend.every(isBend)) return
    errors.push({
      path: `${here}.bend`,
      message: `expected ${expected} values of 'forward' or 'backward', one for each joint between the first and ` +
        `the last (found ${bend.length})`
    })
  } else if (!isBend(bend)) {
    errors.push({
      path: `${here}.bend`,
      message: "expected 'forward' or 'backward' for every bending joint, or an array with one value per joint " +
        'between the first and the last'
    })
  }
}

function validateLimits (limits: unknown, here: string, errors: ValidationError[]): void {
  if (limits === undefined) return
  const path = `${here}.limits`
  if (!isRecord(limits)) {
    errors.push({ path, message: 'expected an object with min and max in degrees' })
    return
  }
  checkKnownKeys(limits, ['min', 'max'], path, errors)
  const { min, max } = limits
  const inRange = (v: unknown): v is number => isFiniteNumber(v) && Math.abs(v) <= LIMIT_RANGE
  const message = `expected a number of degrees, -${LIMIT_RANGE} to ${LIMIT_RANGE}`
  if (!inRange(min)) errors.push({ path: `${path}.min`, message })
  if (!inRange(max)) errors.push({ path: `${path}.max`, message })
  if (inRange(min) && inRange(max) && min >= max) {
    errors.push({ path, message: `expected min below max; found min ${min} and max ${max}` })
  }
}

function validateAppendage (limb: Record<string, unknown>, here: string, errors: ValidationError[]): void {
  for (const field of ['stiffness', 'damping'] as const) {
    const v = limb[field]
    if (v === undefined) continue
    if (!(isFiniteNumber(v) && v >= 0 && v <= 1)) {
      const note = field === 'stiffness' ? 'how hard it springs back to rest' : 'how fast the motion dies out'
      errors.push({ path: `${here}.${field}`, message: `expected a number from 0 to 1: ${note}` })
    }
  }
  const { oscillate } = limb
  if (oscillate === undefined) return
  const path = `${here}.oscillate`
  if (!isRecord(oscillate)) {
    errors.push({ path, message: 'expected an object with axis, degrees and phase' })
    return
  }
  checkKnownKeys(oscillate, OSCILLATE_FIELDS, path, errors)
  if (!isDirection(oscillate.axis)) {
    errors.push({ path: `${path}.axis`, message: 'expected a direction [x, y, z] that is not the zero vector' })
  }
  const { degrees, phase } = oscillate
  if (!(isFiniteNumber(degrees) && degrees >= 0 && degrees <= MAX_OSCILLATION_DEGREES)) {
    errors.push({ path: `${path}.degrees`, message: `expected a number of degrees, 0 to ${MAX_OSCILLATION_DEGREES}` })
  }
  if (phase !== undefined && !(isFiniteNumber(phase) && phase >= 0 && phase < 1)) {
    errors.push({ path: `${path}.phase`, message: 'expected a number from 0 up to 1: the offset in the cycle' })
  }
}
