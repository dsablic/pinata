import { cross, length, normalize, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import {
  checkKnownKeys, copyKnownKeys, isFiniteNumber, isNonEmptyString, isPositive, isRecord, isVec3
} from './validate.ts'
import type { Validated, ValidationError } from './validate.ts'

export type CapsulePart = {
  name: string
  shape: 'capsule'
  a: string
  b: string
  radiusA: number
  radiusB: number
  material: string
  allowThin?: boolean
}

export type BoxPart = {
  name: string
  shape: 'box'
  a: string
  b: string
  width: number
  thickness: number
  rounding: number
  widthAxis: Vec3
  material: string
  allowThin?: boolean
}

export type Part = CapsulePart | BoxPart

export type Decal = { name: string, anchor: string, normal: Vec3, pattern: string[] }

export type Mannequin = {
  name: string
  height: number
  joints: Record<string, Vec3>
  parts: Part[]
  decals: Decal[]
}

const MANNEQUIN_FIELDS = ['name', 'height', 'joints', 'parts', 'decals'] as const
const PART_FIELDS = ['name', 'shape', 'a', 'b', 'material', 'allowThin'] as const
const CAPSULE_FIELDS = [...PART_FIELDS, 'radiusA', 'radiusB'] as const
const BOX_FIELDS = [...PART_FIELDS, 'width', 'thickness', 'rounding', 'widthAxis'] as const
const DECAL_FIELDS = ['name', 'anchor', 'normal', 'pattern'] as const

type Context = { joints: Record<string, unknown>, names: Set<string>, errors: ValidationError[] }

export function validateMannequin (input: unknown): Validated<Mannequin> {
  if (!isRecord(input)) return { errors: [{ path: '', message: 'expected a JSON object' }] }
  const errors: ValidationError[] = []
  checkKnownKeys(input, MANNEQUIN_FIELDS, '', errors)
  if (!isNonEmptyString(input.name)) errors.push({ path: 'name', message: 'expected a non-empty string' })
  if (!isPositive(input.height)) {
    errors.push({
      path: 'height',
      message: 'expected a positive number: the standing height in model units, used to scale to pixels'
    })
  }
  const joints = isRecord(input.joints) ? input.joints : {}
  if (!isRecord(input.joints)) {
    errors.push({ path: 'joints', message: 'expected an object mapping joint name to [x, y, z]' })
  }
  for (const [name, value] of Object.entries(joints)) {
    if (!isVec3(value)) errors.push({ path: `joints.${name}`, message: 'expected [x, y, z] of finite numbers' })
  }
  if (!Array.isArray(input.parts) || input.parts.length === 0) {
    errors.push({ path: 'parts', message: 'expected a non-empty array of parts' })
  }
  const ctx: Context = { joints, names: new Set(), errors }
  const parts: unknown[] = Array.isArray(input.parts) ? input.parts : []
  parts.forEach((part, i) => { validatePart(part, `parts[${i}]`, ctx) })
  if (input.decals !== undefined && !Array.isArray(input.decals)) {
    errors.push({ path: 'decals', message: 'expected an array of decals' })
  }
  const decals: unknown[] = Array.isArray(input.decals) ? input.decals : []
  decals.forEach((decal, i) => { validateDecal(decal, `decals[${i}]`, ctx) })
  if (errors.length > 0) return { errors }
  const value = copyKnownKeys<Mannequin>(input, MANNEQUIN_FIELDS)
  value.decals = value.decals ?? []
  return { value, errors }
}

function jointRef (value: unknown, path: string, ctx: Context): Vec3 | undefined {
  const joint = typeof value === 'string' && Object.hasOwn(ctx.joints, value) ? ctx.joints[value] : undefined
  if (isVec3(joint)) return joint
  if (joint === undefined) {
    const known = Object.keys(ctx.joints).join(', ')
    ctx.errors.push({ path, message: `unknown joint '${String(value)}'; known joints: ${known}` })
  }
  return undefined
}

function validatePart (part: unknown, path: string, ctx: Context): void {
  if (!isRecord(part)) {
    ctx.errors.push({ path, message: 'expected an object' })
    return
  }
  if (!isNonEmptyString(part.name)) {
    ctx.errors.push({ path: `${path}.name`, message: 'expected a non-empty string' })
  } else if (ctx.names.has(part.name)) {
    ctx.errors.push({ path: `${path}.name`, message: `duplicate part name '${part.name}'` })
  } else {
    ctx.names.add(part.name)
  }
  if (!isNonEmptyString(part.material)) {
    ctx.errors.push({ path: `${path}.material`, message: 'expected a material name' })
  }
  if (part.allowThin !== undefined && typeof part.allowThin !== 'boolean') {
    ctx.errors.push({ path: `${path}.allowThin`, message: 'expected true or false' })
  }
  const a = jointRef(part.a, `${path}.a`, ctx)
  const b = jointRef(part.b, `${path}.b`, ctx)
  if (part.shape === 'capsule') {
    checkKnownKeys(part, CAPSULE_FIELDS, path, ctx.errors)
    validateCapsule(part, path, ctx, [a, b])
  } else if (part.shape === 'box') {
    checkKnownKeys(part, BOX_FIELDS, path, ctx.errors)
    validateBox(part, path, ctx, [a, b])
  } else {
    ctx.errors.push({
      path: `${path}.shape`,
      message: `unknown shape '${String(part.shape)}'; expected 'capsule' or 'box'`
    })
  }
}

type Ends = [Vec3 | undefined, Vec3 | undefined]

function validateCapsule (part: Record<string, unknown>, path: string, ctx: Context, [a, b]: Ends): void {
  const { radiusA, radiusB } = part
  if (!isPositive(radiusA)) ctx.errors.push({ path: `${path}.radiusA`, message: 'expected a positive number' })
  if (!isPositive(radiusB)) ctx.errors.push({ path: `${path}.radiusB`, message: 'expected a positive number' })
  if (a === undefined || b === undefined || !isPositive(radiusA) || !isPositive(radiusB)) return
  const span = length(sub(b, a))
  const difference = Math.abs(radiusA - radiusB)
  if (span > 0 && difference >= span) {
    ctx.errors.push({
      path,
      message: `radius difference ${difference} must be smaller than the joint distance ${span}; ` +
        'otherwise one end sphere swallows the other'
    })
  }
}

function validateBox (part: Record<string, unknown>, path: string, ctx: Context, [a, b]: Ends): void {
  const { width, thickness, rounding, widthAxis } = part
  if (!isPositive(width)) ctx.errors.push({ path: `${path}.width`, message: 'expected a positive number' })
  if (!isPositive(thickness)) ctx.errors.push({ path: `${path}.thickness`, message: 'expected a positive number' })
  if (!isFiniteNumber(rounding) || rounding < 0) {
    ctx.errors.push({ path: `${path}.rounding`, message: 'expected a number >= 0' })
  } else if (isPositive(width) && isPositive(thickness) && rounding > Math.min(width, thickness) / 2) {
    ctx.errors.push({
      path: `${path}.rounding`,
      message: `must be at most ${Math.min(width, thickness) / 2} (half the smaller of width and thickness)`
    })
  }
  if (!isVec3(widthAxis) || length(widthAxis) === 0) {
    ctx.errors.push({ path: `${path}.widthAxis`, message: 'expected a non-zero [x, y, z] pointing across the part' })
    return
  }
  if (a === undefined || b === undefined) return
  const segment = sub(b, a)
  if (length(segment) === 0) {
    ctx.errors.push({ path: `${path}.b`, message: 'a box needs distinct joints a and b' })
    return
  }
  if (length(cross(normalize(segment), normalize(widthAxis))) < 0.1) {
    ctx.errors.push({
      path: `${path}.widthAxis`,
      message: 'nearly parallel to the a->b direction; pick an axis across the part'
    })
  }
}

function validateDecal (decal: unknown, path: string, ctx: Context): void {
  if (!isRecord(decal)) {
    ctx.errors.push({ path, message: 'expected an object' })
    return
  }
  checkKnownKeys(decal, DECAL_FIELDS, path, ctx.errors)
  if (!isNonEmptyString(decal.name)) ctx.errors.push({ path: `${path}.name`, message: 'expected a non-empty string' })
  jointRef(decal.anchor, `${path}.anchor`, ctx)
  if (!isVec3(decal.normal) || length(decal.normal) === 0) {
    ctx.errors.push({ path: `${path}.normal`, message: 'expected a non-zero [x, y, z] facing out of the surface' })
  }
  const { pattern } = decal
  if (!Array.isArray(pattern) || pattern.length === 0 || !pattern.every(isNonEmptyString)) {
    ctx.errors.push({ path: `${path}.pattern`, message: 'expected a non-empty array of strings, one per pixel row' })
  } else if (new Set(pattern.map(row => row.length)).size !== 1) {
    ctx.errors.push({ path: `${path}.pattern`, message: 'all rows must have the same length' })
  }
}
