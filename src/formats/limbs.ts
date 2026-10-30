import type { Vec3 } from '../math/vec.ts'
import { checkKnownKeys, copyKnownKeys, isDirection, isFiniteNumber, isNonEmptyString, isRecord } from './validate.ts'
import type { ValidationError } from './validate.ts'

export type Side = 'left' | 'right'
export type Bend = 'forward' | 'backward' | 'up'
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
export type Oscillator = { axis: Vec3, degrees: number, phase: number, period?: number }
export type AppendageLimb = {
  kind: 'appendage'
  name: string
  joints: string[]
  side?: Side
  parent?: string
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
  chain: string[]
  hip: string
  knee: string
  ankle: string
  toe: string
  phase?: number
  bend?: Bend
  bends: Bend[]
  limits?: Limits
}
export type Arm = {
  index: number
  limb: ArmLimb
  name: string
  side: Side
  joints: string[]
  shoulder: string
  carried?: string[]
}

type Source = { limbs: readonly Limb[] }

export const MIN_JOINTS: Record<LimbKind, number> = { leg: 4, arm: 2, appendage: 2 }
export const DEFAULT_STIFFNESS = 0.6
export const DEFAULT_DAMPING = 0.4
const MAX_OSCILLATION_DEGREES = 180
const MAX_PERIOD_SECONDS = 60
const LIMIT_RANGE = 180
const LIMB_FIELDS: Record<LimbKind, readonly string[]> = {
  leg: ['name', 'kind', 'joints', 'side', 'phase', 'bend', 'limits'],
  arm: ['name', 'kind', 'joints', 'side', 'carried'],
  appendage: ['name', 'kind', 'joints', 'side', 'parent', 'stiffness', 'damping', 'oscillate']
}
const JOINT_NOTE: Record<LimbKind, string> = {
  leg: 'from the hip to the toe',
  arm: 'from the shoulder outward',
  appendage: 'from the root outward'
}
const OSCILLATE_FIELDS = ['axis', 'degrees', 'phase', 'period'] as const

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
      chain: joints.slice(0, -1),
      hip: joints[0],
      knee: joints[1],
      ankle: joints[joints.length - 2],
      toe: joints[joints.length - 1],
      phase: limb.phase,
      bend: Array.isArray(limb.bend) ? limb.bend[0] : limb.bend,
      bends: bendsOf(limb),
      limits: limb.limits
    })
  })
  return legs
}

/** Rank of each value from the largest (0); equal values rank the later one first. */
export function rankFromFront (values: readonly number[]): number[] {
  return values.map((value, i) => {
    return values.filter((other, k) => other > value || (other === value && k > i)).length
  })
}

function bendsOf (limb: LegLimb): Bend[] {
  const { bend } = limb
  if (Array.isArray(bend)) return bend
  return Array.from({ length: limb.joints.length - 3 }, () => bend ?? 'forward')
}

export function armsOf ({ limbs }: Source): Arm[] {
  const arms: Arm[] = []
  limbs.forEach((limb, index) => {
    if (limb.kind !== 'arm') return
    arms.push({
      index, limb, name: limb.name, side: limb.side, joints: limb.joints, shoulder: limb.joints[0],
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
  const taken = new Set(value.filter(l => isRecord(l) && isNonEmptyString(l.name)).map(l => l.name as string))
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
    if (input.name === undefined) limb.name = defaultName(kind, counts[kind], taken)
    if (limb.kind === 'appendage') {
      limb.stiffness ??= DEFAULT_STIFFNESS
      limb.damping ??= DEFAULT_DAMPING
      if (limb.oscillate !== undefined) limb.oscillate.phase ??= 0
    }
    limbs.push(limb)
  })
  return limbs
}

/** `leg2` for the second unnamed leg, or the next free number when a limb already uses that name. */
function defaultName (kind: LimbKind, count: number, taken: Set<string>): string {
  let n = count
  while (taken.has(`${kind}${n}`)) n++
  taken.add(`${kind}${n}`)
  return `${kind}${n}`
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
    const note = kind === 'leg' ? ': a leg needs a hip, at least one bending joint, an ankle and a toe' : ''
    errors.push({
      path: `${here}.joints`,
      message: `expected an array of ${min} or more joint names ${JOINT_NOTE[kind]}${found}${note}`
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
  const isBend = (v: unknown): boolean => v === 'forward' || v === 'backward' || v === 'up'
  const expected = Array.isArray(joints) ? Math.max(1, joints.length - 3) : 1
  const path = `${here}.bend`
  if (Array.isArray(bend)) {
    if (bend.length !== expected || !bend.every(isBend)) {
      errors.push({
        path,
        message: `expected ${expected} values of 'forward', 'backward' or 'up', one for each bending joint ` +
          `(the joints between the hip and the ankle; found ${bend.length})`
      })
    } else if (bend.includes('up') && bend.some(v => v !== 'up')) {
      errors.push({
        path,
        message: "'up' cannot be mixed with 'forward' or 'backward' in one leg: use 'up' for every joint"
      })
    }
  } else if (!isBend(bend)) {
    errors.push({
      path,
      message: "expected 'forward', 'backward' or 'up' for every bending joint, or an array with one value per " +
        'joint between the hip and the ankle'
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
  if (limb.parent !== undefined && !isNonEmptyString(limb.parent)) {
    errors.push({ path: `${here}.parent`, message: 'expected the name of the joint the appendage hangs from' })
  }
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
    errors.push({ path, message: 'expected an object with axis, degrees, period and phase' })
    return
  }
  checkKnownKeys(oscillate, OSCILLATE_FIELDS, path, errors)
  if (!isDirection(oscillate.axis)) {
    errors.push({ path: `${path}.axis`, message: 'expected a direction [x, y, z] that is not the zero vector' })
  }
  const { degrees, phase, period } = oscillate
  if (!(isFiniteNumber(degrees) && degrees >= 0 && degrees <= MAX_OSCILLATION_DEGREES)) {
    errors.push({ path: `${path}.degrees`, message: `expected a number of degrees, 0 to ${MAX_OSCILLATION_DEGREES}` })
  }
  const swings = isFiniteNumber(degrees) && degrees > 0
  if (period === undefined ? swings : !(isFiniteNumber(period) && period > 0 && period <= MAX_PERIOD_SECONDS)) {
    const note = period === undefined ? ': an oscillator that swings (degrees above 0) needs one' : ''
    errors.push({
      path: `${path}.period`,
      message: `expected seconds per full swing, above 0 and at most ${MAX_PERIOD_SECONDS}${note}`
    })
  }
  if (phase !== undefined && !(isFiniteNumber(phase) && phase >= 0 && phase < 1)) {
    errors.push({ path: `${path}.phase`, message: 'expected a number from 0 up to 1: the offset in the cycle' })
  }
}
