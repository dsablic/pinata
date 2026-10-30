import { length, sub } from '../math/vec.ts'
import type { Mannequin } from './mannequin.ts'
import type { Cape } from './sim.ts'
import { legsOf, translateLegacy, validateLegPhase, validateLimbList } from './limbs.ts'
import type { Bend, Leg, Limb, Side } from './limbs.ts'
import { applyGaitDefaults, applyLegDefaults, isTemplateName, TEMPLATE_NAMES } from './templates.ts'
import type { TemplateName } from './templates.ts'
import { checkKnownKeys, isFiniteNumber, isNonEmptyString, isRecord } from './validate.ts'
import { hierarchyOrder, parentsOf } from '../motion/skeleton.ts'
import type { Validated, ValidationError } from './validate.ts'

export type { Arm, ArmLimb, AppendageLimb, Bend, Leg, LegLimb, Limb, Limits, Oscillator, Side } from './limbs.ts'
export { armsOf, legsOf, rankFromFront } from './limbs.ts'
export type { TemplateName } from './templates.ts'

export type Lateral = 'rest' | 'spacing'
export type Gait = {
  strideLength: number
  referenceSpeed: number
  stanceFraction: number
  stepHeight: number
  bobAmplitude: number
  armSwingDegrees: number
  footSpacing: number
  strideExponent?: number
  lateral?: Lateral
}
export type LegacyRef = { list: 'legs' | 'arms', index: number }
export type Rig = {
  template?: TemplateName
  limbs: Limb[]
  legacy?: LegacyRef[]
  pelvis: string
  upperBody: string[]
  /** Joints that move rigidly with another joint, by name: { joint: parent }. */
  attached?: Record<string, string>
  gait: Gait
}

const RIG_FIELDS = ['template', 'legs', 'arms', 'limbs', 'pelvis', 'upperBody', 'attached', 'gait'] as const
const LEG_JOINTS = ['hip', 'knee', 'ankle', 'toe'] as const
const ARM_JOINTS = ['shoulder', 'elbow', 'wrist', 'hand'] as const
const LEG_FIELDS = ['side', ...LEG_JOINTS, 'phase', 'bend'] as const
const ARM_FIELDS = ['side', ...ARM_JOINTS, 'carried'] as const
const NON_JOINT_FIELDS: ReadonlySet<string> = new Set(['side', 'carried', 'phase', 'bend'])
const PHASE_TOLERANCE = 1e-9
const TEMPLATE_GAIT: ReadonlySet<string> = new Set(['stanceFraction', 'armSwingDegrees'])
const GAIT_FIELDS = [
  'strideLength', 'referenceSpeed', 'stanceFraction', 'stepHeight', 'bobAmplitude', 'armSwingDegrees', 'footSpacing',
  'strideExponent', 'lateral'
] as const

const GAIT_RANGES: Record<Exclude<keyof Gait, 'lateral'>, { min: number, max: number, note: string }> = {
  strideLength: { min: 0, max: 10, note: 'metres per full cycle, above 0 and at most 10' },
  referenceSpeed: { min: 0, max: 20, note: 'm/s, above 0 and at most 20' },
  stanceFraction: { min: 0.5, max: 0.8, note: 'fraction of the cycle a foot is planted, 0.5 to 0.8' },
  stepHeight: { min: 0, max: 2, note: 'metres of swing-foot lift, 0 to 2' },
  bobAmplitude: { min: 0, max: 1, note: 'metres of pelvis bob, 0 to 1' },
  armSwingDegrees: { min: 0, max: 90, note: 'degrees, 0 to 90' },
  footSpacing: { min: 0, max: 2, note: 'metres between foot plants, 0 to 2' },
  strideExponent: { min: 0.2, max: 1, note: 'how fast stride grows with speed, 0.2 to 1, default 0.5' }
}
const OPTIONAL_GAIT: ReadonlySet<string> = new Set(['strideExponent', 'lateral'])
const EXCLUSIVE_MINIMUM: ReadonlySet<string> = new Set(['strideLength', 'referenceSpeed'])

export function stride (gait: Gait, speed: number): number {
  const ratio = (Math.max(0, speed) / gait.referenceSpeed) ** (gait.strideExponent ?? 0.5)
  return gait.strideLength * Math.min(1.5, Math.max(0.5, ratio))
}


/** Gait cycle offset of every leg: the leg's `phase`, else 0 for a left and 0.5 for a right leg. */
export function legPhases (rig: Rig): number[] {
  return legsOf(rig).map(leg => leg.phase ?? (leg.side === 'left' ? 0 : 0.5))
}

export function legBend (leg: Leg): Bend {
  return leg.bend ?? 'forward'
}

export function withLimbs (rig: Rig, limbs: Limb[]): Rig {
  return { ...rig, limbs }
}

export function validateRig (input: unknown): Validated<Rig> {
  if (!isRecord(input)) return { errors: [{ path: '', message: 'expected a JSON object' }] }
  const errors: ValidationError[] = []
  checkKnownKeys(input, RIG_FIELDS, '', errors)
  const template = validateTemplate(input.template, errors)
  const named = input.template !== undefined
  const { limbs, legacy } = validateBody(input, named, errors)
  if (!isNonEmptyString(input.pelvis)) errors.push({ path: 'pelvis', message: 'expected a joint name' })
  if (!Array.isArray(input.upperBody) || !input.upperBody.every(isNonEmptyString)) {
    errors.push({ path: 'upperBody', message: 'expected an array of joint names that move rigidly with the pelvis' })
  }
  validateGait(input.gait, named, errors)
  validateAttached(input.attached, errors)
  if (errors.length > 0) return { errors }
  const gait = structuredClone(input.gait) as Gait
  if (template !== undefined) applyGaitDefaults(template, gait)
  const upperBody = structuredClone(input.upperBody as string[])
  const rig: Rig = { limbs, pelvis: input.pelvis as string, upperBody, gait }
  if (input.attached !== undefined) rig.attached = structuredClone(input.attached as Record<string, string>)
  if (legacy !== undefined) rig.legacy = legacy
  if (template !== undefined) rig.template = template
  return { value: rig, errors }
}

/**
 * Fills each leg's phase and bend from the rig's template, ordering the legs of a side by the rest hip z of the
 * mannequin so the order of the file does not matter. A rig without a template is returned unchanged.
 */
export function resolveRig (rig: Rig, mannequin: Pick<Mannequin, 'joints'>): Rig {
  if (rig.template === undefined) return rig
  const limbs = structuredClone(rig.limbs)
  applyLegDefaults(rig.template, limbs, leg => mannequin.joints[leg.joints[0]]?.[2] ?? 0)
  return withLimbs(rig, limbs)
}

function validateAttached (value: unknown, errors: ValidationError[]): void {
  if (value === undefined) return
  if (!isRecord(value) || !Object.values(value).every(isNonEmptyString)) {
    errors.push({
      path: 'attached',
      message: 'expected an object mapping joint names to the joint each moves rigidly with, like { "visor": "head" }'
    })
  }
}

function validateTemplate (value: unknown, errors: ValidationError[]): TemplateName | undefined {
  if (value === undefined) return undefined
  if (isTemplateName(value)) return value
  errors.push({ path: 'template', message: `unknown template; expected one of ${TEMPLATE_NAMES.join(', ')}` })
  return undefined
}

type Body = { limbs: Limb[], legacy?: LegacyRef[] }

function validateBody (input: Record<string, unknown>, hasTemplate: boolean, errors: ValidationError[]): Body {
  if (input.limbs !== undefined) {
    if (input.legs !== undefined || input.arms !== undefined) {
      errors.push({
        path: 'limbs',
        message: "'limbs' cannot be combined with 'legs' or 'arms'; describe every limb in 'limbs' " +
          "(kind 'leg' or 'arm'), or keep 'legs' and 'arms' and drop 'limbs'"
      })
      return { limbs: [] }
    }
    return { limbs: validateLimbList(input.limbs, !hasTemplate, errors) }
  }
  const before = errors.length
  validateLegacy(input.legs, 'legs', LEG_FIELDS, hasTemplate, errors)
  validateLegacy(input.arms, 'arms', ARM_FIELDS, hasTemplate, errors)
  if (errors.length > before) return { limbs: [] }
  const legs = input.legs as never[]
  const arms = input.arms as never[]
  const legacy = [
    ...legs.map((_, index): LegacyRef => ({ list: 'legs', index })),
    ...arms.map((_, index): LegacyRef => ({ list: 'arms', index }))
  ]
  return { limbs: translateLegacy(legs, arms).map(limb => structuredClone(limb)), legacy }
}

function validateLegacy (
  value: unknown,
  path: string,
  fields: readonly string[],
  hasTemplate: boolean,
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
    if (path === 'legs') validateLegacyLeg(limb, here, value.length, hasTemplate, errors)
    for (const field of fields.filter(f => !NON_JOINT_FIELDS.has(f))) {
      if (!isNonEmptyString(limb[field])) errors.push({ path: `${here}.${field}`, message: 'expected a joint name' })
    }
    if (fields.includes('carried') && limb.carried !== undefined) {
      const ok = Array.isArray(limb.carried) && limb.carried.every(isNonEmptyString)
      if (!ok) errors.push({ path: `${here}.carried`, message: 'expected an array of joint names' })
    }
  })
}

function validateLegacyLeg (
  leg: Record<string, unknown>,
  here: string,
  count: number,
  hasTemplate: boolean,
  errors: ValidationError[]
): void {
  validateLegPhase(leg.phase, here, { phaseRequired: !hasTemplate, legCount: count }, errors)
  const { bend } = leg
  if (bend !== undefined && bend !== 'forward' && bend !== 'backward') {
    errors.push({ path: `${here}.bend`, message: "expected 'forward' or 'backward': the side the knee points" })
  }
}

function validateGait (gait: unknown, hasTemplate: boolean, errors: ValidationError[]): void {
  if (!isRecord(gait)) {
    errors.push({ path: 'gait', message: `expected an object with ${GAIT_FIELDS.join(', ')}` })
    return
  }
  checkKnownKeys(gait, GAIT_FIELDS, 'gait', errors)
  if (gait.lateral !== undefined && gait.lateral !== 'rest' && gait.lateral !== 'spacing') {
    errors.push({
      path: 'gait.lateral',
      message: "expected 'rest' or 'spacing': 'rest' plants each foot at its rest ankle's position, " +
        "'spacing' at footSpacing / 2 from the centre line"
    })
  }
  for (const field of GAIT_FIELDS.filter(f => f !== 'lateral')) {
    const { min, max, note } = GAIT_RANGES[field]
    const v = gait[field]
    if (v === undefined && (OPTIONAL_GAIT.has(field) || (hasTemplate && TEMPLATE_GAIT.has(field)))) continue
    const ok = isFiniteNumber(v) && (EXCLUSIVE_MINIMUM.has(field) ? v > min : v >= min) && v <= max
    if (!ok) errors.push({ path: `gait.${field}`, message: `expected a number: ${note}` })
  }
}

const LEGACY_FIELDS = { legs: LEG_JOINTS, arms: ARM_JOINTS }

/** The path of a limb in the file the rig was written in: `legs[1]` for a legs and arms rig, else `limbs[1]`. */
export function limbPath (rig: Rig, index: number): string {
  const ref = rig.legacy?.[index]
  return ref === undefined ? `limbs[${index}]` : `${ref.list}[${ref.index}]`
}

function jointPath (rig: Rig, index: number, joint: number): string {
  const ref = rig.legacy?.[index]
  if (ref === undefined) return `limbs[${index}].joints[${joint}]`
  return `${limbPath(rig, index)}.${LEGACY_FIELDS[ref.list][joint]}`
}

function carriedPath (rig: Rig, index: number, joint: number): string {
  return `${limbPath(rig, index)}.carried[${joint}]`
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
  rig.limbs.forEach((limb, i) => {
    limb.joints.forEach((joint, j) => { use(joint, jointPath(rig, i, j)) })
    if (limb.kind === 'arm') limb.carried?.forEach((joint, k) => { use(joint, carriedPath(rig, i, k)) })
  })
  use(rig.pelvis, 'pelvis')
  rig.upperBody.forEach((joint, i) => { use(joint, `upperBody[${i}]`) })
  for (const joint of Object.keys(rig.attached ?? {})) use(joint, `attached.${joint}`)
  checkParents(rig, known, errors)
  checkBones(rig, mannequin, errors)
  errors.push(...checkLegs(rig))
  const missing = known.filter(joint => !used.has(joint))
  if (missing.length > 0) {
    errors.push({
      path: 'upperBody',
      message: `joints not moved by any group would stay at rest: ${missing.map(j => `'${j}'`).join(', ')}; ` +
        `add them to upperBody, ${rig.legacy === undefined ? 'limbs' : 'legs, arms'} or pelvis`
    })
  }
  return errors
}

function checkParents (rig: Rig, known: string[], errors: ValidationError[]): void {
  const unknown = (joint: string): string => `unknown joint '${joint}'; known joints: ${known.join(', ')}`
  for (const [joint, parent] of Object.entries(rig.attached ?? {})) {
    if (!known.includes(parent)) errors.push({ path: `attached.${joint}`, message: unknown(parent) })
    else if (parent === joint) errors.push({ path: `attached.${joint}`, message: 'a joint cannot move with itself' })
  }
  rig.limbs.forEach((limb, i) => {
    if (limb.kind !== 'appendage' || limb.parent === undefined) return
    const path = `${limbPath(rig, i)}.parent`
    if (!known.includes(limb.parent)) errors.push({ path, message: unknown(limb.parent) })
    else if (limb.joints.includes(limb.parent)) {
      const message = `'${limb.parent}' is one of this appendage's own joints; name the joint it hangs from`
      errors.push({ path, message })
    }
  })
  if (errors.length > 0) return
  try {
    hierarchyOrder(parentsOf(rig))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    errors.push({ path: 'attached', message: `${message}; every chain of attached joints must end at the pelvis` })
  }
}

function checkLegs (rig: Rig): ValidationError[] {
  const legs = legsOf(rig)
  const path = rig.legacy === undefined ? 'limbs' : 'legs'
  if (legs.length === 0) {
    const need = rig.legacy === undefined ? "limb of kind 'leg'" : "entry in 'legs'"
    return [{ path, message: `a rig needs at least one ${need}: the gait plants its feet` }]
  }
  const count = (side: Side): number => legs.filter(leg => leg.side === side).length
  const left = count('left')
  const right = count('right')
  const errors: ValidationError[] = []
  if (legs.length > 1 && left !== right) {
    const want = legs.length === 2 ? 'one left and one right leg' : 'as many left as right legs'
    errors.push({ path, message: `expected ${want}; found ${left} left and ${right} right` })
  }
  errors.push(...checkStance(rig))
  return errors
}

/** The smallest stanceFraction with which some foot is always planted: 1 minus the widest gap between leg phases. */
export function minimumStance (rig: Rig): number {
  const phases = legPhases(rig).sort((a, b) => a - b)
  const widest = Math.max(...phases.map((p, i) => (phases[(i + 1) % phases.length] - p + 1) % 1 || 1))
  return 1 - widest
}

function checkStance (rig: Rig): ValidationError[] {
  const needed = minimumStance(rig)
  if (rig.gait.stanceFraction >= needed - PHASE_TOLERANCE) return []
  return [{
    path: 'gait.stanceFraction',
    message: `with these leg phases a foot is always in the air, so the character could never stand still; ` +
      `raise stanceFraction to at least ${Math.ceil(needed * 1000 - 1e-6) / 1000} (now ${rig.gait.stanceFraction})`
  }]
}

const MIN_BONE_LENGTH = 1e-6

function checkBones (rig: Rig, mannequin: Mannequin, errors: ValidationError[]): void {
  rig.limbs.forEach((limb, i) => {
    for (let j = 1; j < limb.joints.length; j++) {
      const [from, to] = [limb.joints[j - 1], limb.joints[j]]
      const a = mannequin.joints[from]
      const b = mannequin.joints[to]
      if (a === undefined || b === undefined || length(sub(a, b)) >= MIN_BONE_LENGTH) continue
      const label = rig.legacy === undefined ? `'${limb.name}'` : limbPath(rig, i)
      errors.push({
        path: limbPath(rig, i),
        message: `joints '${from}' and '${to}' of ${label} are at the same position, which gives a ` +
          'zero-length bone; move them apart in the mannequin'
      })
    }
  })
}

function groupOf (rig: Rig, joint: string, seen: ReadonlySet<string> = new Set()): string {
  if (rig.pelvis === joint || rig.upperBody.includes(joint)) return 'rigid'
  const parent = rig.attached?.[joint]
  if (parent !== undefined) {
    const rigid = !seen.has(parent) && groupOf(rig, parent, new Set([...seen, joint])) === 'rigid'
    return rigid ? 'rigid' : 'attached to a joint that moves on its own'
  }
  const limb = rig.limbs.find(l => l.joints.includes(joint) || (l.kind === 'arm' && l.carried?.includes(joint)))
  if (limb === undefined) return 'unlisted'
  return { leg: 'a leg joint', arm: 'an arm joint', appendage: 'an appendage joint' }[limb.kind]
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
