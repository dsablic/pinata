import type { Vec3 } from '../math/vec.ts'

export type ValidationError = { path: string, message: string }

export type Validated<T> = { value?: T, errors: ValidationError[] }

export function isRecord (v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isNonEmptyString (v: unknown): v is string {
  return typeof v === 'string' && v !== ''
}

export function isFiniteNumber (v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function isPositive (v: unknown): v is number {
  return isFiniteNumber(v) && v > 0
}

export function isVec3 (v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber)
}

export function checkKnownKeys (
  record: Record<string, unknown>,
  known: readonly string[],
  path: string,
  errors: ValidationError[]
): void {
  for (const key of Object.keys(record)) {
    if (known.includes(key)) continue
    errors.push({
      path: path === '' ? key : `${path}.${key}`,
      message: `unknown field '${key}'; known fields: ${known.join(', ')}`
    })
  }
}

export function copyKnownKeys<T> (record: Record<string, unknown>, known: readonly string[]): T {
  const entries = known.filter(key => record[key] !== undefined).map(key => [key, structuredClone(record[key])])
  return Object.fromEntries(entries) as T
}

export function formatErrors (file: string, errors: ValidationError[]): string {
  return errors.map(e => `${file}: ${e.path === '' ? '(root)' : e.path}: ${e.message}`).join('\n')
}
