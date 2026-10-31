import type { Vec3 } from '../math/vec.ts'
import {
  checkKnownKeys, copyKnownKeys, isDirection, isFiniteNumber, isHexColour, isNonEmptyString, isPositive, isRecord
} from './validate.ts'
import type { Validated, ValidationError } from './validate.ts'

export type OutlineMode = 'uniform' | 'selective'

export type Style = {
  name: string
  light: Vec3
  bands: number[]
  outline: string
  outlineMode?: OutlineMode
  innerLineDepth: number
  decalMinFacing: number
  materials: Record<string, string[]>
  decalColors: Record<string, string>
}

const KNOWN_FIELDS = [
  'name', 'light', 'bands', 'outline', 'outlineMode', 'innerLineDepth', 'decalMinFacing', 'materials', 'decalColors'
] as const

export function validateStyle (input: unknown): Validated<Style> {
  if (!isRecord(input)) return { errors: [{ path: '', message: 'expected a JSON object' }] }
  const errors: ValidationError[] = []
  checkKnownKeys(input, KNOWN_FIELDS, '', errors)
  if (!isNonEmptyString(input.name)) errors.push({ path: 'name', message: 'expected a non-empty string' })
  if (!isDirection(input.light)) {
    errors.push({ path: 'light', message: 'expected a non-zero [x, y, z] in camera space pointing toward the light' })
  }
  const bands = Array.isArray(input.bands) && input.bands.every(isFiniteNumber) ? input.bands : undefined
  if (bands === undefined || bands.some((t, i) => t < -1 || t > 1 || (i > 0 && t <= bands[i - 1]))) {
    errors.push({ path: 'bands', message: 'expected strictly ascending numbers between -1 and 1' })
  }
  if (!isHexColour(input.outline)) errors.push({ path: 'outline', message: 'expected a colour like #1b1421' })
  if (input.outlineMode !== undefined && input.outlineMode !== 'uniform' && input.outlineMode !== 'selective') {
    errors.push({ path: 'outlineMode', message: "expected 'uniform' or 'selective'; omit it for 'uniform'" })
  }
  if (!isPositive(input.innerLineDepth)) {
    errors.push({ path: 'innerLineDepth', message: 'expected a positive depth jump in model units' })
  }
  if (!isFiniteNumber(input.decalMinFacing) || input.decalMinFacing < 0 || input.decalMinFacing > 1) {
    errors.push({ path: 'decalMinFacing', message: 'expected a number between 0 and 1' })
  }
  validateMaterials(input.materials, bands, errors)
  validateDecalColors(input.decalColors, errors)
  if (errors.length > 0) return { errors }
  return { value: copyKnownKeys<Style>(input, KNOWN_FIELDS), errors }
}

function validateMaterials (materials: unknown, bands: number[] | undefined, errors: ValidationError[]): void {
  if (!isRecord(materials) || Object.keys(materials).length === 0) {
    errors.push({ path: 'materials', message: 'expected an object mapping material name to a colour ramp' })
    return
  }
  for (const [name, ramp] of Object.entries(materials)) {
    const path = `materials.${name}`
    if (!Array.isArray(ramp) || !ramp.every(isHexColour)) {
      errors.push({ path, message: 'expected an array of colours like #1b1421, darkest first' })
    } else if (bands !== undefined && ramp.length !== bands.length + 1) {
      errors.push({
        path,
        message: `ramp has ${ramp.length} colours but bands define ${bands.length + 1} shades; add or remove colours`
      })
    }
  }
}

function validateDecalColors (decalColors: unknown, errors: ValidationError[]): void {
  if (!isRecord(decalColors)) {
    errors.push({ path: 'decalColors', message: 'expected an object mapping a pattern character to a colour' })
    return
  }
  for (const [ch, colour] of Object.entries(decalColors)) {
    if (ch.length !== 1 || ch === '.') {
      errors.push({ path: `decalColors.${ch}`, message: "keys must be single characters other than '.'" })
    } else if (!isHexColour(colour)) {
      errors.push({ path: `decalColors.${ch}`, message: 'expected a colour like #1b1421' })
    }
  }
}
