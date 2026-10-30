import { checkKnownKeys, isFiniteNumber, isNonEmptyString, isRecord, isVec3 } from '../formats/validate.ts'
import type { Validated, ValidationError } from '../formats/validate.ts'
import type { Vec3 } from '../math/vec.ts'

export type HangConfig = {
  /** The joint the rope is tied to, and an offset from it in rest space (the hook). */
  joint: string
  offset: Vec3
  rope: number
  swingDamping: number
  twistStiffness: number
  twistDamping: number
  /** Stiffness and damping of legs, which hang limp as spring chains. */
  limbStiffness: number
  limbDamping: number
}
export type Layer =
  | { do: 'sway', mask: string[], amplitude: number, period: number }
  | { do: 'spin', mask: string[], turns: number, duration: number }
export type Additive =
  | { do: 'bounce', amplitude: number, period: number }
  | { do: 'breathe', mask: string[], amplitude: number, period: number }
export type Event = { at: number, do: 'hit', impulse: Vec3, spin: number }
export type Behaviour = {
  base: 'hang'
  layers: Layer[]
  additive: Additive[]
  events: Event[]
  then?: string
  duration?: number
}
export type Transition = { on: string, to: string, blend: number, from?: string }
export type Behaviours = {
  hang: HangConfig
  behaviours: Record<string, Behaviour>
  states: { initial: string, transitions: Transition[] }
}

const TOP_FIELDS = ['hang', 'behaviours', 'states'] as const
const HANG_FIELDS = [
  'joint', 'offset', 'rope', 'swingDamping', 'twistStiffness', 'twistDamping', 'limbStiffness', 'limbDamping'
] as const
const BEHAVIOUR_FIELDS = ['base', 'layers', 'additive', 'events', 'then', 'duration'] as const
const HANG_RANGES: Record<Exclude<keyof HangConfig, 'joint' | 'offset'>, [number, number, string]> = {
  rope: [0.05, 10, 'metres of rope from the anchor to the hook'],
  swingDamping: [0, 10, 'swing damping per second'],
  twistStiffness: [0, 100, 'twist spring stiffness'],
  twistDamping: [0, 20, 'twist damping per second'],
  limbStiffness: [0, 1, 'how hard hanging legs spring back to their rest shape'],
  limbDamping: [0, 1, 'how fast hanging legs stop swinging']
}
const PRIMITIVES: Record<string, { kind: 'layer' | 'additive' | 'event', fields: Record<string, [number, number]> }> = {
  sway: { kind: 'layer', fields: { amplitude: [0, 20], period: [0.2, 30] } },
  spin: { kind: 'layer', fields: { turns: [-10, 10], duration: [0.1, 30] } },
  bounce: { kind: 'additive', fields: { amplitude: [0, 0.5], period: [0.1, 30] } },
  breathe: { kind: 'additive', fields: { amplitude: [0, 0.1], period: [0.5, 30] } },
  hit: { kind: 'event', fields: { at: [0, 60], spin: [-30, 30] } }
}
const MASKED: ReadonlySet<string> = new Set(['sway', 'spin', 'breathe'])
const MAX_IMPULSE = 20

function numberIn (v: unknown, [min, max]: [number, number]): v is number {
  return isFiniteNumber(v) && v >= min && v <= max
}

function validatePrimitive (
  input: unknown,
  kind: 'layer' | 'additive' | 'event',
  path: string,
  errors: ValidationError[]
): void {
  if (!isRecord(input)) {
    errors.push({ path, message: 'expected an object with "do" naming a primitive' })
    return
  }
  const name = input.do
  const primitive = typeof name === 'string' ? PRIMITIVES[name] : undefined
  const names = Object.entries(PRIMITIVES).filter(([, p]) => p.kind === kind).map(([n]) => n)
  if (primitive === undefined || primitive.kind !== kind) {
    errors.push({ path: `${path}.do`, message: `expected one of ${names.join(', ')} here` })
    return
  }
  const fields = ['do', ...Object.keys(primitive.fields), ...(MASKED.has(name as string) ? ['mask'] : []),
    ...(name === 'hit' ? ['impulse'] : [])]
  checkKnownKeys(input, fields, path, errors)
  for (const [field, range] of Object.entries(primitive.fields)) {
    if (!numberIn(input[field], range)) {
      errors.push({ path: `${path}.${field}`, message: `expected a number from ${range[0]} to ${range[1]}` })
    }
  }
  if (MASKED.has(name as string) && !(Array.isArray(input.mask) && input.mask.length > 0 &&
    input.mask.every(isNonEmptyString))) {
    errors.push({ path: `${path}.mask`, message: 'expected a non-empty array of joint names, limb names or "body"' })
  }
  if (name === 'hit' && !(isVec3(input.impulse) && input.impulse.every(v => Math.abs(v) <= MAX_IMPULSE))) {
    errors.push({ path: `${path}.impulse`, message: `expected [x, y, z] in m/s, each within ${MAX_IMPULSE}` })
  }
}

function validateList (
  value: unknown,
  kind: 'layer' | 'additive' | 'event',
  path: string,
  errors: ValidationError[]
): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    errors.push({ path, message: 'expected an array' })
    return
  }
  value.forEach((item: unknown, i) => { validatePrimitive(item, kind, `${path}[${i}]`, errors) })
}

function validateHang (input: unknown, errors: ValidationError[]): void {
  if (!isRecord(input)) {
    errors.push({ path: 'hang', message: `expected an object with ${HANG_FIELDS.join(', ')}` })
    return
  }
  checkKnownKeys(input, HANG_FIELDS, 'hang', errors)
  if (!isNonEmptyString(input.joint)) {
    errors.push({ path: 'hang.joint', message: 'expected the joint the rope is tied to' })
  }
  if (!isVec3(input.offset)) errors.push({ path: 'hang.offset', message: 'expected [x, y, z] metres from the joint' })
  for (const [field, [min, max, note]] of Object.entries(HANG_RANGES)) {
    if (!numberIn(input[field], [min, max])) {
      errors.push({ path: `hang.${field}`, message: `expected a number from ${min} to ${max}: ${note}` })
    }
  }
}

function validateBehaviour (name: string, input: unknown, names: string[], errors: ValidationError[]): void {
  const path = `behaviours.${name}`
  if (!isRecord(input)) {
    errors.push({ path, message: 'expected an object with base, layers, additive and events' })
    return
  }
  checkKnownKeys(input, BEHAVIOUR_FIELDS, path, errors)
  if (input.base !== 'hang') errors.push({ path: `${path}.base`, message: "expected 'hang' (the only base so far)" })
  validateList(input.layers, 'layer', `${path}.layers`, errors)
  validateList(input.additive, 'additive', `${path}.additive`, errors)
  validateList(input.events, 'event', `${path}.events`, errors)
  if (input.then !== undefined && !(typeof input.then === 'string' && names.includes(input.then))) {
    errors.push({ path: `${path}.then`, message: `expected the name of a behaviour: ${names.join(', ')}` })
  }
  if ((input.then === undefined) !== (input.duration === undefined)) {
    errors.push({ path: `${path}.duration`, message: 'expected then and duration together: play then after duration' })
  } else if (input.duration !== undefined && !numberIn(input.duration, [0.1, 600])) {
    errors.push({ path: `${path}.duration`, message: 'expected seconds, 0.1 to 600' })
  }
}

function validateStates (input: unknown, names: string[], errors: ValidationError[]): void {
  if (!isRecord(input)) {
    errors.push({ path: 'states', message: 'expected an object with initial and transitions' })
    return
  }
  checkKnownKeys(input, ['initial', 'transitions'], 'states', errors)
  const known = (v: unknown): boolean => typeof v === 'string' && names.includes(v)
  if (!known(input.initial)) {
    errors.push({ path: 'states.initial', message: `expected a behaviour name: ${names.join(', ')}` })
  }
  if (!Array.isArray(input.transitions)) {
    errors.push({ path: 'states.transitions', message: 'expected an array of { on, to, blend, from? }' })
    return
  }
  input.transitions.forEach((t: unknown, i) => {
    const path = `states.transitions[${i}]`
    if (!isRecord(t)) {
      errors.push({ path, message: 'expected an object' })
      return
    }
    checkKnownKeys(t, ['on', 'to', 'blend', 'from'], path, errors)
    if (!isNonEmptyString(t.on)) errors.push({ path: `${path}.on`, message: 'expected an event name' })
    if (!known(t.to)) errors.push({ path: `${path}.to`, message: `expected a behaviour name: ${names.join(', ')}` })
    if (t.from !== undefined && !known(t.from)) {
      errors.push({ path: `${path}.from`, message: `expected a behaviour name: ${names.join(', ')}` })
    }
    if (!numberIn(t.blend, [0, 10])) errors.push({ path: `${path}.blend`, message: 'expected seconds, 0 to 10' })
  })
}

/** Validates a behaviours file; masks are checked against a rig separately (see maskJoints). */
export function validateBehaviours (input: unknown): Validated<Behaviours> {
  if (!isRecord(input)) return { errors: [{ path: '', message: 'expected a JSON object' }] }
  const errors: ValidationError[] = []
  checkKnownKeys(input, TOP_FIELDS, '', errors)
  validateHang(input.hang, errors)
  const names = isRecord(input.behaviours) ? Object.keys(input.behaviours) : []
  if (!isRecord(input.behaviours) || names.length === 0) {
    errors.push({ path: 'behaviours', message: 'expected an object of named behaviours' })
  } else {
    for (const name of names) validateBehaviour(name, input.behaviours[name], names, errors)
  }
  validateStates(input.states, names, errors)
  if (errors.length > 0) return { errors }
  const value = structuredClone(input) as Behaviours
  for (const behaviour of Object.values(value.behaviours)) {
    behaviour.layers ??= []
    behaviour.additive ??= []
    behaviour.events ??= []
  }
  return { value, errors }
}
