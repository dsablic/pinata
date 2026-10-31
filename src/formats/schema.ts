import { childPath, isHexColour, isRecord } from './validate.ts'
import type { ValidationError } from './validate.ts'

export type Schema =
  | { kind: 'number', min?: number, max?: number, integer?: true, note?: string }
  | { kind: 'string', oneOf?: readonly string[], maxLength?: number, note?: string }
  | { kind: 'boolean', note?: string }
  | { kind: 'range', min: number, max: number, note?: string }
  | { kind: 'vec3', note?: string }
  | { kind: 'colour', note?: string }
  | { kind: 'array', of: Schema, minItems?: number, note?: string }
  | { kind: 'object', fields: Record<string, Schema>, optional?: readonly string[], note?: string }
  | { kind: 'map', of: Schema, minItems?: number, note?: string }
  | { kind: 'union', by: string, cases: Record<string, Fields>, note?: string }

export type Fields = { fields: Record<string, Schema>, optional?: readonly string[] }

function inRange (v: unknown, min = -Infinity, max = Infinity): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
}

function expected (schema: Schema): string {
  const note = schema.note === undefined ? '' : `: ${schema.note}`
  switch (schema.kind) {
    case 'number': {
      const { min, max } = schema
      const bounds = min !== undefined && max !== undefined ? ` from ${min} to ${max}`
        : min !== undefined ? ` of at least ${min}` : max !== undefined ? ` up to ${max}` : ''
      return `expected ${schema.integer === true ? 'a whole number' : 'a number'}${bounds}${note}`
    }
    case 'string': {
      const what = schema.oneOf === undefined ? 'a non-empty string' : `one of ${schema.oneOf.join(', ')}`
      return `expected ${what}${note}`
    }
    case 'boolean': return `expected true or false${note}`
    case 'range': return `expected [min, max] with ${schema.min} <= min <= max <= ${schema.max}${note}`
    case 'vec3': return `expected [x, y, z]${note}`
    case 'colour': return `expected a colour like '#a8642c'${note}`
    case 'array': {
      const least = schema.minItems === undefined ? '' : ` of at least ${schema.minItems}`
      return `expected an array${least}${note}`
    }
    case 'object': return `expected an object with ${Object.keys(schema.fields).join(', ')}${note}`
    case 'map': return `expected an object of named entries${note}`
    case 'union': {
      const kinds = Object.keys(schema.cases).join(', ')
      return `expected an object whose "${schema.by}" is one of ${kinds}${note}`
    }
  }
}

function checkFields (
  value: Record<string, unknown>,
  fields: Record<string, Schema>,
  optional: readonly string[],
  path: string,
  errors: ValidationError[]
): void {
  for (const key of Object.keys(value)) {
    if (key in fields) continue
    errors.push({ path: childPath(path, key), message: `unknown field; expected ${Object.keys(fields).join(', ')}` })
  }
  for (const [key, schema] of Object.entries(fields)) {
    if (value[key] === undefined && optional.includes(key)) continue
    check(value[key], schema, childPath(path, key), errors)
  }
}

export function check (value: unknown, schema: Schema, path: string, errors: ValidationError[]): void {
  const fail = (): void => { errors.push({ path, message: expected(schema) }) }
  switch (schema.kind) {
    case 'number':
      if (!inRange(value, schema.min, schema.max) || (schema.integer === true && !Number.isInteger(value))) fail()
      return
    case 'string':
      if (typeof value !== 'string' || value === '' || (schema.oneOf !== undefined && !schema.oneOf.includes(value)) ||
        (schema.maxLength !== undefined && [...value].length > schema.maxLength)) fail()
      return
    case 'boolean':
      if (typeof value !== 'boolean') fail()
      return
    case 'range':
      if (!(Array.isArray(value) && value.length === 2 && inRange(value[0], schema.min, schema.max) &&
        inRange(value[1], value[0], schema.max))) fail()
      return
    case 'vec3':
      if (!(Array.isArray(value) && value.length === 3 && value.every(v => inRange(v)))) fail()
      return
    case 'colour':
      if (!isHexColour(value)) fail()
      return
    case 'array':
      if (!Array.isArray(value) || value.length < (schema.minItems ?? 0)) {
        fail()
        return
      }
      value.forEach((item, i) => { check(item, schema.of, `${path}[${i}]`, errors) })
      return
    case 'object':
      if (!isRecord(value)) {
        fail()
        return
      }
      checkFields(value, schema.fields, schema.optional ?? [], path, errors)
      return
    case 'map':
      if (!isRecord(value) || Object.keys(value).length < (schema.minItems ?? 0)) {
        fail()
        return
      }
      for (const [key, item] of Object.entries(value)) {
        check(item, schema.of, childPath(path, key), errors)
      }
      return
    case 'union': {
      const tag = isRecord(value) ? value[schema.by] : undefined
      const fields = typeof tag === 'string' ? schema.cases[tag] : undefined
      if (!isRecord(value) || fields === undefined) {
        errors.push({ path: childPath(path, schema.by), message: expected(schema) })
        return
      }
      checkFields(value, { [schema.by]: { kind: 'string' }, ...fields.fields }, fields.optional ?? [], path, errors)
    }
  }
}
