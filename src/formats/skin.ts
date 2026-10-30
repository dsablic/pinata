import type { Mannequin } from './mannequin.ts'
import { checkKnownKeys, isNonEmptyString, isRecord } from './validate.ts'
import type { Validated, ValidationError } from './validate.ts'

export type SkinPart = {
  rows?: string[]
  pivotA?: [number, number]
  pivotB?: [number, number]
  hidden?: boolean
}

/**
 * The views an eight-direction skin draws, facing screen-right where they are not symmetric: front, the front
 * three-quarter view, the side, the back three-quarter view, and the back. Left-facing directions mirror them.
 */
export const VIEWS = ['front', 'frontSide', 'side', 'backSide', 'back'] as const
export type ViewName = typeof VIEWS[number]

/** A skin: v1 draws one view (`view: 'side-right'`, `parts`); v2 draws every view in `views`. */
export type Skin = {
  name: string
  view?: 'side-right'
  palette: Record<string, string>
  parts: Record<string, SkinPart>
  views?: Record<ViewName, { parts: Record<string, SkinPart> }>
}

export const TRANSPARENT_CHAR = '.'
export const MAX_COLOURS = 16
export const MAX_SPRITE_SIZE = 64

const SKIN_FIELDS = ['name', 'view', 'palette', 'parts', 'views'] as const
const PART_FIELDS = ['rows', 'pivotA', 'pivotB', 'hidden'] as const
const HEX = /^#[0-9a-fA-F]{6}$/

export function validateSkin (input: unknown): Validated<Skin> {
  if (!isRecord(input)) return { errors: [{ path: '', message: 'expected a JSON object' }] }
  const errors: ValidationError[] = []
  checkKnownKeys(input, SKIN_FIELDS, '', errors)
  if (!isNonEmptyString(input.name)) errors.push({ path: 'name', message: 'expected a non-empty string' })
  const palette = validatePalette(input.palette, errors)
  if (input.views !== undefined) {
    // v2: every view drawn, no single-view fields
    if (input.view !== undefined || input.parts !== undefined) {
      errors.push({ path: 'views', message: "an eight-direction skin has 'views' only; drop 'view' and 'parts'" })
    }
    if (!isRecord(input.views)) {
      errors.push({ path: 'views', message: `expected an object with ${VIEWS.join(', ')}` })
    } else {
      checkKnownKeys(input.views, VIEWS, 'views', errors)
      for (const view of VIEWS) {
        const drawn = input.views[view]
        if (!isRecord(drawn) || !isRecord(drawn.parts)) {
          errors.push({ path: `views.${view}`, message: 'expected { parts: { partName: sprite } }' })
          continue
        }
        checkKnownKeys(drawn, ['parts'], `views.${view}`, errors)
        for (const [name, part] of Object.entries(drawn.parts)) {
          validatePart(part, `views.${view}.parts.${name}`, palette, errors)
        }
      }
    }
    if (errors.length > 0) return { errors }
    const skin = structuredClone(input) as unknown as Skin
    return { value: { ...skin, parts: skin.views!.side.parts }, errors }
  }
  if (input.view !== 'side-right') {
    errors.push({ path: 'view', message: "expected 'side-right', or 'views' for an eight-direction skin" })
  }
  if (!isRecord(input.parts)) {
    errors.push({ path: 'parts', message: 'expected an object mapping part name to a sprite' })
  } else {
    for (const [name, part] of Object.entries(input.parts)) validatePart(part, `parts.${name}`, palette, errors)
  }
  if (errors.length > 0) return { errors }
  return { value: structuredClone(input) as unknown as Skin, errors }
}

function validatePalette (palette: unknown, errors: ValidationError[]): Set<string> {
  const known = new Set<string>()
  if (!isRecord(palette)) {
    errors.push({ path: 'palette', message: "expected an object mapping one character to '#rrggbb'" })
    return known
  }
  const entries = Object.entries(palette)
  if (entries.length === 0) errors.push({ path: 'palette', message: 'expected at least one colour' })
  if (entries.length > MAX_COLOURS) {
    errors.push({ path: 'palette', message: `has ${entries.length} colours; use at most ${MAX_COLOURS}` })
  }
  for (const [key, value] of entries) {
    if ([...key].length !== 1) {
      errors.push({ path: `palette.${key}`, message: 'palette keys must be a single character' })
    } else if (key === TRANSPARENT_CHAR) {
      errors.push({ path: `palette.${key}`, message: "'.' is reserved for transparent pixels; pick another character" })
    } else if (typeof value !== 'string' || !HEX.test(value)) {
      errors.push({ path: `palette.${key}`, message: "expected a colour like '#a1b2c3'" })
    } else {
      known.add(key)
    }
  }
  return known
}

function validatePart (part: unknown, path: string, palette: Set<string>, errors: ValidationError[]): void {
  if (!isRecord(part)) {
    errors.push({ path, message: 'expected an object' })
    return
  }
  checkKnownKeys(part, PART_FIELDS, path, errors)
  if (part.hidden !== undefined && typeof part.hidden !== 'boolean') {
    errors.push({ path: `${path}.hidden`, message: 'expected true or false' })
  }
  if (part.hidden === true) return
  const size = validateRows(part.rows, `${path}.rows`, palette, errors)
  for (const key of ['pivotA', 'pivotB'] as const) {
    if (key === 'pivotB' && part.pivotB === undefined) continue
    validatePivot(part[key], `${path}.${key}`, size, errors)
  }
}

type Size = { width: number, height: number } | undefined

function validateRows (rows: unknown, path: string, palette: Set<string>, errors: ValidationError[]): Size {
  if (!Array.isArray(rows) || rows.length === 0 || !rows.every(isNonEmptyString)) {
    errors.push({ path, message: 'expected a non-empty array of non-empty strings, one per pixel row' })
    return undefined
  }
  const lines = rows.map(row => [...row])
  const width = lines[0].length
  if (lines.some(line => line.length !== width)) {
    errors.push({ path, message: `all rows must have the same length; row lengths are ${lines.map(l => l.length)}` })
    return undefined
  }
  if (width > MAX_SPRITE_SIZE || lines.length > MAX_SPRITE_SIZE) {
    errors.push({
      path,
      message: `sprite is ${width}x${lines.length}; the maximum is ${MAX_SPRITE_SIZE}x${MAX_SPRITE_SIZE}`
    })
    return undefined
  }
  let opaque = 0
  lines.forEach((line, y) => {
    line.forEach((char, x) => {
      if (char === TRANSPARENT_CHAR) return
      if (palette.has(char)) {
        opaque++
        return
      }
      errors.push({
        path: `${path}[${y}]`,
        message: `character '${char}' at column ${x} is not in the palette; known: ${[...palette].join('') || '(none)'}`
      })
    })
  })
  if (opaque === 0 && errors.every(e => !e.path.startsWith(path))) {
    errors.push({ path, message: 'the sprite has no opaque pixels' })
  }
  return { width, height: lines.length }
}

function validatePivot (pivot: unknown, path: string, size: Size, errors: ValidationError[]): void {
  const ok = Array.isArray(pivot) && pivot.length === 2 && pivot.every(Number.isInteger)
  if (!ok) {
    errors.push({ path, message: 'expected [x, y] as integer pixel coordinates in the sprite' })
    return
  }
  if (size === undefined) return
  const [x, y] = pivot as [number, number]
  if (x < 0 || y < 0 || x >= size.width || y >= size.height) {
    errors.push({
      path,
      message: `[${x}, ${y}] is outside the ${size.width}x${size.height} sprite; ` +
        `x is 0..${size.width - 1}, y is 0..${size.height - 1}`
    })
  }
}

export function checkSkin (skin: Skin, mannequin: Mannequin): ValidationError[] {
  if (skin.views === undefined) return checkParts(skin.parts, mannequin, 'parts')
  return VIEWS.flatMap(view => checkParts(skin.views![view].parts, mannequin, `views.${view}.parts`))
}

function checkParts (parts: Record<string, SkinPart>, mannequin: Mannequin, at: string): ValidationError[] {
  const errors: ValidationError[] = []
  const names = new Set(mannequin.parts.map(p => p.name))
  for (const part of mannequin.parts) {
    const sprite = Object.hasOwn(parts, part.name) ? parts[part.name] : undefined
    if (sprite === undefined) {
      errors.push({
        path: `${at}.${part.name}`,
        message: `no sprite for part '${part.name}'; draw it, or add { "hidden": true } if it is not visible`
      })
    } else if (sprite.hidden !== true && part.a !== part.b) {
      checkTwoJoint(sprite, `${at}.${part.name}`, errors)
    }
  }
  for (const name of Object.keys(parts)) {
    if (names.has(name)) continue
    errors.push({ path: `${at}.${name}`, message: `unknown part '${name}'; mannequin parts: ${[...names].join(', ')}` })
  }
  return errors
}

function checkTwoJoint (sprite: SkinPart, path: string, errors: ValidationError[]): void {
  const { pivotA, pivotB } = sprite
  if (pivotA === undefined) return
  if (pivotB === undefined) {
    errors.push({ path: `${path}.pivotB`, message: 'this part spans two joints; add pivotB, the pixel at joint b' })
  } else if (pivotB[1] !== pivotA[1] || pivotB[0] <= pivotA[0]) {
    errors.push({
      path: `${path}.pivotB`,
      message: `pivotB [${pivotB}] must be on the same row as pivotA [${pivotA}] and to its right ` +
        '(the bone points along +x in the sprite)'
    })
  }
}
