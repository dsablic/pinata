import { createHash } from 'node:crypto'
import { sheet } from '../diagnostics/images.ts'
import { checkKnownKeys, isFiniteNumber, isHexColour, isNonEmptyString, isRecord } from '../formats/validate.ts'
import type { Validated, ValidationError } from '../formats/validate.ts'
import { parseHex } from '../image.ts'
import type { Image } from '../image.ts'

export type ChoiceItem = { id: string, image: string, label: string }
export type ChoiceSpec = {
  kind: 'choice'
  name: string
  seed: string
  question: string
  labels: string[]
  scale: number
  background: string
  items: ChoiceItem[]
}
export type ChoiceKey = {
  name: string
  kind: 'choice'
  labels: string[]
  items: Record<string, { id: string, label: string }>
}
export type ChoicePacket = { images: Record<string, Image>, questions: string, key: ChoiceKey }
export type ChoiceAnswers = Record<string, { choice: string }>
export type LabelScore = { label: string, asked: number, right: number, named: Record<string, number> }
export type ChoiceScore = { labels: LabelScore[], asked: number, right: number, share: number, missing: string[] }

export const CANT_TELL = 'cant_tell'
const SPEC_FIELDS = ['kind', 'name', 'seed', 'question', 'labels', 'scale', 'background', 'items'] as const
const ITEM_FIELDS = ['id', 'image', 'label'] as const
const DEFAULTS = { scale: 8, background: '#c8c8c8' }

export function isChoiceSpec (input: unknown): boolean {
  return isRecord(input) && input.kind === 'choice'
}

export function isChoiceKey (input: unknown): input is ChoiceKey {
  return isRecord(input) && input.kind === 'choice' && isRecord(input.items) && Array.isArray(input.labels)
}

export function validateChoiceSpec (input: unknown): Validated<ChoiceSpec> {
  if (!isRecord(input)) return { errors: [{ path: '', message: 'expected a JSON object' }] }
  const errors: ValidationError[] = []
  checkKnownKeys(input, SPEC_FIELDS, '', errors)
  if (input.kind !== 'choice') errors.push({ path: 'kind', message: "expected 'choice'" })
  for (const field of ['name', 'seed', 'question'] as const) {
    if (!isNonEmptyString(input[field])) errors.push({ path: field, message: 'expected a non-empty string' })
  }
  const { scale, background, labels } = input
  if (scale !== undefined && !(isFiniteNumber(scale) && Number.isInteger(scale) && scale >= 1 && scale <= 32)) {
    errors.push({ path: 'scale', message: 'expected a whole number of pixels, 1 to 32' })
  }
  if (background !== undefined && !isHexColour(background)) {
    errors.push({ path: 'background', message: "expected a colour like '#c8c8c8'" })
  }
  const known = new Set<string>()
  if (!Array.isArray(labels) || labels.length < 2 || !labels.every(isNonEmptyString) || labels.includes(CANT_TELL)) {
    errors.push({ path: 'labels', message: `expected at least two distinct non-empty strings, not '${CANT_TELL}'` })
  } else {
    labels.forEach(label => known.add(label))
    if (known.size !== labels.length) errors.push({ path: 'labels', message: 'a label is used twice' })
  }
  const ids = new Set<string>()
  if (!Array.isArray(input.items) || input.items.length === 0) {
    errors.push({ path: 'items', message: 'expected a non-empty array of { id, image, label }' })
  } else {
    input.items.forEach((item: unknown, i) => {
      const here = `items[${i}]`
      if (!isRecord(item)) {
        errors.push({ path: here, message: 'expected an object' })
        return
      }
      checkKnownKeys(item, ITEM_FIELDS, here, errors)
      for (const field of ITEM_FIELDS) {
        if (isNonEmptyString(item[field])) continue
        errors.push({ path: `${here}.${field}`, message: 'expected a non-empty string' })
      }
      if (isNonEmptyString(item.label) && known.size > 0 && !known.has(item.label)) {
        errors.push({ path: `${here}.label`, message: `'${item.label}' is not one of the labels` })
      }
      if (isNonEmptyString(item.id)) {
        if (ids.has(item.id)) errors.push({ path: `${here}.id`, message: `id '${item.id}' is used twice` })
        ids.add(item.id)
      }
    })
  }
  if (errors.length > 0) return { errors }
  return { value: { ...DEFAULTS, ...structuredClone(input) } as ChoiceSpec, errors }
}

function rank (seed: string, id: string): string {
  return createHash('sha256').update(`${seed}\n${id}`).digest('hex')
}

function questionsText (spec: ChoiceSpec, names: string[]): string {
  const options = [...spec.labels, CANT_TELL].map(label => `"${label}"`).join(' | ')
  return [
    '# Questions',
    '',
    `Each image shows one character. For every image: ${spec.question}`,
    '',
    `Choose one of: ${[...spec.labels, CANT_TELL].join(', ')}.`,
    '',
    'Judge each image on its own. Answer with one JSON object mapping each image name (without .png) to',
    `{ "choice": ${options} }, and nothing else.`,
    '',
    `Images: ${names.map(n => n.replace('.png', '')).join(', ')}`,
    ''
  ].join('\n')
}

export function buildChoicePacket (spec: ChoiceSpec, load: (path: string) => Image): ChoicePacket {
  const ordered = [...spec.items].sort((x, y) => rank(spec.seed, x.id).localeCompare(rank(spec.seed, y.id)))
  const width = Math.max(2, String(ordered.length).length)
  const images: Record<string, Image> = {}
  const key: ChoiceKey = { name: spec.name, kind: 'choice', labels: spec.labels, items: {} }
  ordered.forEach((item, i) => {
    const name = `item-${String(i + 1).padStart(width, '0')}`
    const cell = { image: load(item.image), anchor: [0, 0] as [number, number] }
    const look = { scale: spec.scale, gap: spec.scale, background: parseHex(spec.background) }
    images[`${name}.png`] = sheet([[cell]], look)
    key.items[name] = { id: item.id, label: item.label }
  })
  return { images, questions: questionsText(spec, Object.keys(images)), key }
}

export function choiceProblems (answers: unknown, key: ChoiceKey): string[] {
  if (!isRecord(answers)) return ['expected a JSON object mapping item names to answers']
  const allowed = new Set([...key.labels, CANT_TELL])
  const problems: string[] = []
  for (const item of Object.keys(key.items)) {
    const answer = answers[item]
    if (answer === undefined) problems.push(`${item}: missing`)
    else if (!isRecord(answer) || typeof answer.choice !== 'string' || !allowed.has(answer.choice)) {
      problems.push(`${item}: expected { "choice": one of ${[...allowed].join(', ')} }`)
    }
  }
  for (const item of Object.keys(answers)) if (key.items[item] === undefined) problems.push(`${item}: not in the panel`)
  return problems
}

export function scoreChoices (key: ChoiceKey, judges: ChoiceAnswers[]): ChoiceScore {
  const labels = key.labels.map((label): LabelScore => ({ label, asked: 0, right: 0, named: {} }))
  const missing: string[] = []
  for (const [item, entry] of Object.entries(key.items)) {
    const own = labels.find(l => l.label === entry.label) as LabelScore
    judges.forEach((answers, j) => {
      const choice = answers[item]?.choice
      own.asked++
      if (choice === undefined) missing.push(`judge ${j + 1}: ${item}`)
      else if (choice === entry.label) own.right++
      else own.named[choice] = (own.named[choice] ?? 0) + 1
    })
  }
  const asked = labels.reduce((sum, l) => sum + l.asked, 0)
  const right = labels.reduce((sum, l) => sum + l.right, 0)
  return { labels, asked, right, share: asked === 0 ? NaN : right / asked, missing }
}

export function formatChoiceScore (key: ChoiceKey, score: ChoiceScore): string {
  const percent = (v: number): string => Number.isNaN(v) ? 'n/a' : `${(v * 100).toFixed(0)}%`
  return [
    `panel: ${key.name}`,
    ...score.labels.map(l => {
      const wrong = Object.entries(l.named).map(([name, n]) => `${name} ${n}`).join(', ')
      return `${l.label}: ${l.right}/${l.asked} right${wrong === '' ? '' : `; named instead: ${wrong}`}`
    }),
    `correct in ${score.right}/${score.asked} answers (${percent(score.share)}), ` +
      'cant_tell and missing answers counted as wrong',
    ...(score.missing.length > 0 ? [`missing answers: ${score.missing.join(', ')}`] : [])
  ].join('\n')
}
