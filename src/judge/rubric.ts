import { createHash } from 'node:crypto'
import { sheet } from '../diagnostics/images.ts'
import { checkKnownKeys, isFiniteNumber, isHexColour, isNonEmptyString, isRecord } from '../formats/validate.ts'
import type { Validated, ValidationError } from '../formats/validate.ts'
import { parseHex } from '../image.ts'
import type { Image } from '../image.ts'
import { pairImage, trimToOpaque } from './packet.ts'

export type Dimension = {
  id: string
  label: string
  anchors: readonly [string, string, string, string, string]
}
export type RubricItem = { id: string, a: string, b?: string, control?: boolean }
export type RubricSpec = {
  kind: 'rubric'
  name: string
  seed: string
  scale: number
  gap: number
  background: string
  items: RubricItem[]
}
export type Side = 'top' | 'bottom'
export type RubricEntry = { item: string, control: boolean, aSide?: Side }
export type RubricKey = { name: string, kind: 'rubric', dimensions: string[], items: Record<string, RubricEntry> }
export type RubricPacket = { images: Record<string, Image>, questions: string, key: RubricKey }
export type Ship = Side | 'cant_tell'
export type RubricAnswer = { ratings: Record<string, number | Record<Side, number>>, ship?: Ship }
export type RubricAnswers = Record<string, RubricAnswer>
export type DimensionScore = {
  dimension: string
  meanA: number
  meanB: number
  aAbove: number
  bAbove: number
  ties: number
  answers: number
  expected: number
}
export type RubricPairScore = {
  pair: string
  control: boolean
  dimensions: DimensionScore[]
  ship: { a: number, b: number, cantTell: number }
  meanDifference: number
  answered: number
  expected: number
}
export type SingleScore = { item: string, means: Record<string, number>, answers: number }
export type RubricScore = { pairs: RubricPairScore[], singles: SingleScore[], controlDifference: number }

export const DIMENSIONS: readonly Dimension[] = [
  { id: 'fluidity', label: 'Fluidity: spacing and easing between frames, no pops', anchors: [
    'poses jump about, frames pop and jitter', 'visible jumps between poses', 'mostly smooth, some uneven spacing',
    'smooth with small flaws', 'flowing and eased, nothing pops'] },
  { id: 'weight', label: 'Weight: contact, squash, the body settling', anchors: [
    'floats, no sense of mass', 'little contact or settling', 'some weight on the heavy moments',
    'clear weight with squash and settle', 'every landing, step and swing carries mass'] },
  { id: 'anticipation', label: 'Anticipation and follow-through: wind-up before, overshoot and settle after', anchors: [
    'moves start and stop with no preparation', 'a hint of preparation or recovery',
    'wind-up or recovery on the main moves',
    'clear wind-up and follow-through', 'every move is prepared, hits, overshoots and settles'] },
  { id: 'secondary', label: 'Secondary motion: cape, hair, cloth and loose parts lag and settle', anchors: [
    'loose parts are rigid or frozen to the body', 'loose parts move but in step with the body',
    'loose parts lag a little', 'loose parts lag and settle believably',
    'loose parts drag, overlap and settle richly'] },
  { id: 'environment', label: 'Environment: feet planted, ground contact, reactions to the ground', anchors: [
    'feet slide and hover', 'feet often slide or float', 'feet mostly planted, some slide',
    'feet planted with clear ground contact', 'feet locked to the ground, every contact reads'] },
  { id: 'readability', label: 'Readability: pose and direction clear at a glance', anchors: [
    'the action and direction are unclear', 'the action is hard to name', 'the action reads after a moment',
    'the action and direction read quickly', 'the action and direction read at a glance'] },
  { id: 'appeal', label: 'Appeal: would a player want this character', anchors: [
    'unappealing, crude', 'plain, forgettable', 'pleasant enough', 'charming, has character',
    'a character players would love'] }
]

const SPEC_FIELDS = ['kind', 'name', 'seed', 'scale', 'gap', 'background', 'items'] as const
const ITEM_FIELDS = ['id', 'a', 'b', 'control'] as const
const DEFAULTS = { scale: 4, gap: 6, background: '#c8c8c8' }
const SIDES: readonly Side[] = ['top', 'bottom']
const SHIPS: ReadonlySet<string> = new Set([...SIDES, 'cant_tell'])
const LOWEST = 1
const HIGHEST = 5

export function isRubricSpec (input: unknown): boolean {
  return isRecord(input) && input.kind === 'rubric'
}

export function isRubricKey (input: unknown): input is RubricKey {
  return isRecord(input) && input.kind === 'rubric' && isRecord(input.items) && Array.isArray(input.dimensions)
}

export function validateRubricSpec (input: unknown): Validated<RubricSpec> {
  if (!isRecord(input)) return { errors: [{ path: '', message: 'expected a JSON object' }] }
  const errors: ValidationError[] = []
  checkKnownKeys(input, SPEC_FIELDS, '', errors)
  if (input.kind !== 'rubric') errors.push({ path: 'kind', message: "expected 'rubric'" })
  for (const field of ['name', 'seed'] as const) {
    if (!isNonEmptyString(input[field])) errors.push({ path: field, message: 'expected a non-empty string' })
  }
  for (const field of ['scale', 'gap'] as const) {
    const v = input[field]
    if (v !== undefined && !(isFiniteNumber(v) && Number.isInteger(v) && v >= (field === 'scale' ? 1 : 0) && v <= 32)) {
      errors.push({ path: field, message: 'expected a whole number of pixels, up to 32' })
    }
  }
  if (input.background !== undefined && !isHexColour(input.background)) {
    errors.push({ path: 'background', message: "expected a colour like '#c8c8c8'" })
  }
  const ids = new Set<string>()
  const items: unknown = input.items
  if (!Array.isArray(items) || items.length === 0) {
    errors.push({ path: 'items', message: 'expected a non-empty array of { id, a, b?, control? }' })
  } else {
    items.forEach((item: unknown, i) => {
      const here = `items[${i}]`
      if (!isRecord(item)) {
        errors.push({ path: here, message: 'expected an object' })
        return
      }
      checkKnownKeys(item, ITEM_FIELDS, here, errors)
      for (const field of ['id', 'a'] as const) {
        if (isNonEmptyString(item[field])) continue
        errors.push({ path: `${here}.${field}`, message: 'expected a non-empty string' })
      }
      if (item.b !== undefined && !isNonEmptyString(item.b)) {
        const message = 'expected a non-empty string, or leave it out for a single animation'
        errors.push({ path: `${here}.b`, message })
      }
      if (item.control !== undefined && (typeof item.control !== 'boolean' || item.b === undefined)) {
        errors.push({ path: `${here}.control`, message: 'expected true or false, and only on an item with a and b' })
      }
      if (item.control === true && item.b !== undefined && item.b !== item.a) {
        errors.push({ path: `${here}.b`, message: 'a control shows one animation twice: b must equal a' })
      }
      if (isNonEmptyString(item.id)) {
        if (ids.has(item.id)) errors.push({ path: `${here}.id`, message: `id '${item.id}' is used twice` })
        ids.add(item.id)
      }
    })
  }
  if (errors.length > 0) return { errors }
  return { value: { ...DEFAULTS, ...structuredClone(input) } as RubricSpec, errors }
}

function rank (seed: string, id: string): string {
  return createHash('sha256').update(`${seed}\n${id}`).digest('hex')
}

function anchorLines (): string[] {
  return DIMENSIONS.flatMap(d => [
    '', `**${d.id}** - ${d.label}`, ...d.anchors.map((anchor, i) => `- ${i + 1}: ${anchor}`)
  ])
}

function ratingExample (paired: boolean): string {
  const ratings = DIMENSIONS.map(d => `"${d.id}": ${paired ? '{ "top": 1-5, "bottom": 1-5 }' : '1-5'}`).join(', ')
  return `{ "ratings": { ${ratings} }${paired ? ', "ship": "top" | "bottom" | "cant_tell"' : ''} }`
}

function questionsText (names: string[], paired: string[]): string {
  const single = names.filter(name => !paired.includes(name))
  const label = (list: string[]): string => list.map(n => n.replace('.png', '')).join(', ')
  return [
    '# Questions',
    '',
    'Each image shows animation frames of a game character, in time order: left to right, then top to bottom, ' +
      'at equal time steps (12 frames a second). A frame that appears several times in a row stays on screen for ' +
      'that many steps. Judge the motion the frames imply, not the colours.',
    ...(paired.length > 0
      ? ['', `Images ${label(paired)} show two animations, one above the other ("top" and "bottom"). Rate each ` +
        'on every dimension below, and say which of the two you would ship in a game ("top", "bottom" or "cant_tell").']
      : []),
    ...(single.length > 0 ? ['', `Images ${label(single)} show one animation. Rate it on every dimension below.`] : []),
    '',
    'Rate each dimension from 1 to 5 with whole numbers. The anchors say what each level means.',
    ...anchorLines(),
    '',
    'Judge each image on its own. Answer with one JSON object whose keys are the image names (without .png) and ' +
      'whose values are the answers, and nothing else:',
    ...(paired.length > 0 ? [`for two animations: "${paired[0].replace('.png', '')}": ${ratingExample(true)}`] : []),
    ...(single.length > 0 ? [`for one animation: "${single[0].replace('.png', '')}": ${ratingExample(false)}`] : []),
    '',
    `Images: ${names.map(n => n.replace('.png', '')).join(', ')}`,
    ''
  ].join('\n')
}

function singleImage (image: Image, spec: Pick<RubricSpec, 'scale' | 'gap' | 'background'>): Image {
  const trimmed = trimToOpaque(image)
  const cell = { image: trimmed, anchor: [Math.floor(trimmed.width / 2), trimmed.height] as [number, number] }
  return sheet([[cell]], { scale: spec.scale, gap: spec.gap * spec.scale, background: parseHex(spec.background) })
}

export function buildRubricPacket (spec: RubricSpec, load: (path: string) => Image): RubricPacket {
  const shown = spec.items.flatMap((item): { item: RubricItem, aSide: Side | undefined }[] => {
    return item.b === undefined ? [{ item, aSide: undefined }] : SIDES.map(aSide => ({ item, aSide }))
  })
  const ordered = shown
    .map(entry => ({ ...entry, rank: rank(spec.seed, `${entry.item.id}/${entry.aSide ?? 'alone'}`) }))
    .sort((x, y) => x.rank.localeCompare(y.rank))
  const width = Math.max(2, String(ordered.length).length)
  const images: Record<string, Image> = {}
  const key: RubricKey = { name: spec.name, kind: 'rubric', dimensions: DIMENSIONS.map(d => d.id), items: {} }
  const paired: string[] = []
  const look = { ...spec, layout: 'stacked' as const }
  ordered.forEach(({ item, aSide }, i) => {
    const name = `item-${String(i + 1).padStart(width, '0')}.png`
    const first = load(item.a)
    if (item.b === undefined || aSide === undefined) images[name] = singleImage(first, spec)
    else {
      const second = load(item.b)
      images[name] = aSide === 'top' ? pairImage(first, second, look) : pairImage(second, first, look)
      paired.push(name)
    }
    key.items[name.replace('.png', '')] = {
      item: item.id, control: item.control === true, ...(aSide === undefined ? {} : { aSide })
    }
  })
  return { images, questions: questionsText(Object.keys(images), paired), key }
}

function isRating (v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= LOWEST && (v as number) <= HIGHEST
}

export function entryProblems (name: string, answer: unknown, key: RubricKey): string[] {
  const paired = key.items[name].aSide !== undefined
  if (!isRecord(answer) || !isRecord(answer.ratings)) return [`${name}: expected { "ratings": { ... } }`]
  const problems: string[] = []
  for (const dimension of key.dimensions) {
    const rating = answer.ratings[dimension]
    const good = paired
      ? isRecord(rating) && SIDES.every(side => isRating(rating[side]))
      : isRating(rating)
    if (!good) {
      const shape = paired ? '{ "top": 1-5, "bottom": 1-5 }' : 'a whole number 1-5'
      problems.push(`${name}: ${dimension} should be ${shape}`)
    }
  }
  for (const dimension of Object.keys(answer.ratings)) {
    if (!key.dimensions.includes(dimension)) problems.push(`${name}: ${dimension} is not a dimension`)
  }
  if (paired && !(typeof answer.ship === 'string' && SHIPS.has(answer.ship))) {
    problems.push(`${name}: ship should be "top", "bottom" or "cant_tell"`)
  }
  if (!paired && answer.ship !== undefined) problems.push(`${name}: a single animation takes no ship answer`)
  return problems
}

export function rubricProblems (answers: unknown, key: RubricKey): string[] {
  if (!isRecord(answers)) return ['expected a JSON object mapping item names to answers']
  const problems = Object.keys(key.items).flatMap(name => {
    return answers[name] === undefined ? [`${name}: missing`] : entryProblems(name, answers[name], key)
  })
  for (const name of Object.keys(answers)) if (key.items[name] === undefined) problems.push(`${name}: not in the panel`)
  return problems
}

export function usableAnswers (answers: unknown, key: RubricKey): RubricAnswers {
  if (!isRecord(answers)) return {}
  const usable = Object.keys(key.items).filter(name => {
    return answers[name] !== undefined && entryProblems(name, answers[name], key).length === 0
  })
  return Object.fromEntries(usable.map(name => [name, answers[name] as RubricAnswers[string]]))
}

function mean (values: number[]): number {
  return values.length === 0 ? NaN : values.reduce((sum, v) => sum + v, 0) / values.length
}

function pairScore (key: RubricKey, pair: string, judges: RubricAnswers[]): RubricPairScore {
  const names = Object.keys(key.items).filter(name => key.items[name].item === pair)
  const control = key.items[names[0]].control
  const ship = { a: 0, b: 0, cantTell: 0 }
  const gaps: number[] = []
  const dimensions = key.dimensions.map((dimension): DimensionScore => {
    const [as, bs] = [[] as number[], [] as number[]]
    let [aAbove, bAbove] = [0, 0]
    for (const name of names) {
      const aSide = key.items[name].aSide as Side
      const bSide = aSide === 'top' ? 'bottom' : 'top'
      for (const answers of judges) {
        const rating = answers[name]?.ratings[dimension] as Record<Side, number> | undefined
        if (rating === undefined) continue
        as.push(rating[aSide])
        bs.push(rating[bSide])
        gaps.push(Math.abs(rating.top - rating.bottom))
        if (rating[aSide] > rating[bSide]) aAbove++
        if (rating[bSide] > rating[aSide]) bAbove++
      }
    }
    return { dimension, meanA: mean(as), meanB: mean(bs), aAbove, bAbove, ties: as.length - aAbove - bAbove,
      answers: as.length, expected: names.length * judges.length }
  })
  for (const name of names) {
    for (const answers of judges) {
      const choice = answers[name]?.ship
      if (choice === undefined) continue
      if (choice === 'cant_tell') ship.cantTell++
      else if (choice === key.items[name].aSide) ship.a++
      else ship.b++
    }
  }
  return { pair, control, dimensions, ship, meanDifference: mean(gaps), answered: gaps.length / key.dimensions.length,
    expected: names.length * judges.length }
}

function singleScore (key: RubricKey, item: string, judges: RubricAnswers[]): SingleScore {
  const name = Object.keys(key.items).find(n => key.items[n].item === item) as string
  const rated = judges.map(answers => answers[name]).filter(answer => answer !== undefined)
  const means = Object.fromEntries(key.dimensions.map(d => [d, mean(rated.map(a => a.ratings[d] as number))]))
  return { item, means, answers: rated.length }
}

export function scoreRubric (key: RubricKey, judges: RubricAnswers[]): RubricScore {
  const items = [...new Set(Object.values(key.items).map(entry => entry.item))]
  const paired = (item: string): boolean => Object.values(key.items).some(e => e.item === item && e.aSide !== undefined)
  const pairs = items.filter(paired).map(item => pairScore(key, item, judges))
  const singles = items.filter(item => !paired(item)).map(item => singleScore(key, item, judges))
  return { pairs, singles, controlDifference: mean(pairs.filter(p => p.control).map(p => p.meanDifference)) }
}

export function formatRubricScore (key: RubricKey, score: RubricScore): string {
  const two = (v: number): string => Number.isNaN(v) ? 'n/a' : v.toFixed(2)
  const dimensionLine = (d: DimensionScore): string => {
    return `  ${d.dimension}: a ${two(d.meanA)}, b ${two(d.meanB)}; a above b in ${d.aAbove}/${d.answers}, ` +
      `b above a in ${d.bAbove}/${d.answers}, tied in ${d.ties}`
  }
  return [
    `panel: ${key.name}`,
    ...score.pairs.flatMap(p => [
      `${p.control ? 'control' : 'pair'} ${p.pair}: ship a ${p.ship.a}, b ${p.ship.b}, cant_tell ${p.ship.cantTell}; ` +
        `top-bottom difference per answer ${two(p.meanDifference)}`,
      ...p.dimensions.map(dimensionLine)
    ]),
    ...score.singles.flatMap(s => [
      `single ${s.item} (${s.answers} answers)`,
      ...Object.entries(s.means).map(([dimension, value]) => `  ${dimension}: ${two(value)}`)
    ]),
    `controls: top-bottom difference per answer ${two(score.controlDifference)} (a reference against itself)`
  ].join('\n')
}
