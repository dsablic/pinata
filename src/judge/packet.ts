import { createHash } from 'node:crypto'
import { createImage, getPixel, parseHex, setPixel, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import { sheet } from '../diagnostics/images.ts'
import { checkKnownKeys, isFiniteNumber, isHexColour, isNonEmptyString, isRecord } from '../formats/validate.ts'
import type { Validated, ValidationError } from '../formats/validate.ts'

export type PairSpec = { id: string, a: string, b: string, control?: boolean }
export type PanelSpec = {
  name: string
  seed: string
  question: string
  rating?: string
  scale: number
  gap: number
  background: string
  layout?: 'side' | 'stacked'
  pairs: PairSpec[]
}
export type KeyEntry = { pair: string, control: boolean, aSide: 'left' | 'right' }
export type PanelKey = { name: string, rating?: boolean, items: Record<string, KeyEntry> }
export type Packet = { images: Record<string, Image>, questions: string, key: PanelKey }

const SPEC_FIELDS = ['name', 'seed', 'question', 'rating', 'scale', 'gap', 'background', 'layout', 'pairs'] as const
const PAIR_FIELDS = ['id', 'a', 'b', 'control'] as const
const DEFAULTS = { scale: 8, gap: 2, background: '#c8c8c8' }

export function validatePanelSpec (input: unknown): Validated<PanelSpec> {
  if (!isRecord(input)) return { errors: [{ path: '', message: 'expected a JSON object' }] }
  const errors: ValidationError[] = []
  checkKnownKeys(input, SPEC_FIELDS, '', errors)
  for (const field of ['name', 'seed', 'question'] as const) {
    if (!isNonEmptyString(input[field])) errors.push({ path: field, message: 'expected a non-empty string' })
  }
  if (input.rating !== undefined && !isNonEmptyString(input.rating)) {
    errors.push({ path: 'rating', message: 'expected the rating question, or leave it out' })
  }
  for (const field of ['scale', 'gap'] as const) {
    const v = input[field]
    const min = field === 'scale' ? 1 : 0
    if (v !== undefined && !(isFiniteNumber(v) && Number.isInteger(v) && v >= min && v <= 32)) {
      errors.push({ path: field, message: `expected a whole number of pixels, ${min} to 32` })
    }
  }
  if (input.layout !== undefined && input.layout !== 'side' && input.layout !== 'stacked') {
    errors.push({ path: 'layout', message: "expected 'side' or 'stacked'" })
  }
  const { background } = input
  if (background !== undefined && !isHexColour(background)) {
    errors.push({ path: 'background', message: "expected a colour like '#c8c8c8'" })
  }
  const ids = new Set<string>()
  if (!Array.isArray(input.pairs) || input.pairs.length === 0) {
    errors.push({ path: 'pairs', message: 'expected a non-empty array of { id, a, b, control? }' })
  } else {
    input.pairs.forEach((pair: unknown, i) => {
      const here = `pairs[${i}]`
      if (!isRecord(pair)) {
        errors.push({ path: here, message: 'expected an object' })
        return
      }
      checkKnownKeys(pair, PAIR_FIELDS, here, errors)
      for (const field of ['id', 'a', 'b'] as const) {
        if (isNonEmptyString(pair[field])) continue
        errors.push({ path: `${here}.${field}`, message: 'expected a non-empty string' })
      }
      if (pair.control !== undefined && typeof pair.control !== 'boolean') {
        errors.push({ path: `${here}.control`, message: 'expected true or false' })
      }
      if (isNonEmptyString(pair.id)) {
        if (ids.has(pair.id)) errors.push({ path: `${here}.id`, message: `id '${pair.id}' is used twice` })
        ids.add(pair.id)
      }
    })
    if (!input.pairs.some((p: unknown) => isRecord(p) && p.control === true)) {
      const message = 'expected at least one control pair: a panel without one cannot show bias'
      errors.push({ path: 'pairs', message })
    }
    if (!input.pairs.some((p: unknown) => isRecord(p) && p.control !== true)) {
      errors.push({ path: 'pairs', message: 'expected at least one pair that is not a control' })
    }
  }
  if (errors.length > 0) return { errors }
  return { value: { ...DEFAULTS, ...structuredClone(input) } as PanelSpec, errors }
}

function trimToOpaque (image: Image): Image {
  let [left, top, right, bottom] = [image.width, image.height, -1, -1]
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (getPixel(image, x, y) === TRANSPARENT) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < 0) return image
  const out = createImage(right - left + 1, bottom - top + 1)
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) setPixel(out, x, y, getPixel(image, left + x, top + y))
  }
  return out
}

export function pairImage (
  left: Image,
  right: Image,
  spec: Pick<PanelSpec, 'scale' | 'gap' | 'background' | 'layout'>
): Image {
  const cells = [trimToOpaque(left), trimToOpaque(right)].map(image => {
    return { image, anchor: [Math.floor(image.width / 2), image.height] as [number, number] }
  })
  const rows = spec.layout === 'stacked' ? cells.map(cell => [cell]) : [cells]
  return sheet(rows, { scale: spec.scale, gap: spec.gap * spec.scale, background: parseHex(spec.background) })
}

function rank (seed: string, id: string): string {
  return createHash('sha256').update(`${seed}\n${id}`).digest('hex')
}

function questionsText (spec: PanelSpec, names: string[]): string {
  const answer = spec.rating === undefined
    ? '{ "choice": "left" | "right" | "cant_tell" }'
    : '{ "choice": "left" | "right" | "cant_tell", "rating": { "left": 1-5, "right": 1-5 } }'
  return [
    `# ${spec.name}`,
    '',
    spec.layout === 'stacked'
      ? `Each image shows two characters, one above the other: "left" means the top one and "right" the bottom one. ` +
        `For every image: ${spec.question}`
      : `Each image shows two characters side by side. For every image: ${spec.question}`,
    ...(spec.rating === undefined ? [] : ['', `Also: ${spec.rating}`]),
    '',
    'Judge each image on its own. Answer with one JSON object mapping each image name (without .png) to',
    `${answer}, and nothing else.`,
    '',
    `Images: ${names.map(n => n.replace('.png', '')).join(', ')}`,
    ''
  ].join('\n')
}

export function buildPacket (spec: PanelSpec, load: (path: string) => Image): Packet {
  const shown = spec.pairs.flatMap(pair => (['left', 'right'] as const).map(aSide => ({ pair, aSide })))
  const ordered = shown
    .map(item => ({ ...item, rank: rank(spec.seed, `${item.pair.id}/${item.aSide}`) }))
    .sort((x, y) => x.rank.localeCompare(y.rank))
  const width = String(ordered.length).length < 2 ? 2 : String(ordered.length).length
  const images: Record<string, Image> = {}
  const key: PanelKey = { name: spec.name, ...(spec.rating === undefined ? {} : { rating: true }), items: {} }
  ordered.forEach(({ pair, aSide }, i) => {
    const name = `item-${String(i + 1).padStart(width, '0')}.png`
    const [a, b] = [load(pair.a), load(pair.b)]
    images[name] = aSide === 'left' ? pairImage(a, b, spec) : pairImage(b, a, spec)
    key.items[name.replace('.png', '')] = { pair: pair.id, control: pair.control === true, aSide }
  })
  return { images, questions: questionsText(spec, Object.keys(images)), key }
}
