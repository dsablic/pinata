import { isRecord } from '../formats/validate.ts'
import type { PanelKey } from './packet.ts'

export type Choice = 'left' | 'right' | 'cant_tell'
export type Answer = { choice: Choice, rating?: { left: number, right: number } }
export type JudgeAnswers = Record<string, Answer>
export type PairScore = {
  pair: string
  control: boolean
  a: number
  b: number
  cantTell: number
  consistent: number
  neutral: number
  judges: number
  ratingA?: number
  ratingB?: number
}
export type PanelScore = {
  pairs: PairScore[]
  aShare: number
  leftShare: number
  controlNeutral: number
  missing: string[]
}

const CHOICES: ReadonlySet<string> = new Set(['left', 'right', 'cant_tell'])

function isRating (v: unknown): boolean {
  return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5
}

export function answerProblems (answers: unknown, key: PanelKey): string[] {
  if (!isRecord(answers)) return ['expected a JSON object mapping item names to answers']
  const problems: string[] = []
  for (const item of Object.keys(key.items)) {
    const answer = answers[item]
    if (answer === undefined) {
      problems.push(`${item}: missing`)
      continue
    }
    if (!isRecord(answer) || typeof answer.choice !== 'string' || !CHOICES.has(answer.choice)) {
      problems.push(`${item}: expected { "choice": "left" | "right" | "cant_tell" }`)
      continue
    }
    const { rating } = answer
    if (rating === undefined && key.rating === true) problems.push(`${item}: missing rating`)
    if (rating !== undefined && !(isRecord(rating) && isRating(rating.left) && isRating(rating.right))) {
      problems.push(`${item}: expected "rating": { "left": 1-5, "right": 1-5 } with whole numbers`)
    }
  }
  for (const item of Object.keys(answers)) if (key.items[item] === undefined) problems.push(`${item}: not in the panel`)
  return problems
}

function share (part: number, whole: number): number {
  return whole === 0 ? NaN : part / whole
}

export function scorePanel (key: PanelKey, judges: JudgeAnswers[]): PanelScore {
  const byPair = new Map<string, PairScore & { ratings: { a: number[], b: number[] } }>()
  const missing: string[] = []
  let left = 0
  let picks = 0
  for (const [item, entry] of Object.entries(key.items)) {
    const score = byPair.get(entry.pair) ?? {
      pair: entry.pair, control: entry.control, a: 0, b: 0, cantTell: 0, consistent: 0, neutral: 0, judges: 0,
      ratings: { a: [], b: [] }
    }
    byPair.set(entry.pair, score)
    judges.forEach((answers, j) => {
      const answer = answers[item]
      if (answer === undefined) {
        missing.push(`judge ${j + 1}: ${item}`)
        return
      }
      if (answer.choice === 'cant_tell') score.cantTell++
      else {
        picks++
        if (answer.choice === 'left') left++
        if (answer.choice === entry.aSide) score.a++
        else score.b++
      }
      if (answer.rating !== undefined) {
        score.ratings.a.push(answer.rating[entry.aSide])
        score.ratings.b.push(answer.rating[entry.aSide === 'left' ? 'right' : 'left'])
      }
    })
  }
  for (const score of byPair.values()) {
    const items = Object.entries(key.items).filter(([, e]) => e.pair === score.pair)
    judges.forEach(answers => {
      const resolved = items.map(([item, e]) => {
        const choice = answers[item]?.choice
        if (choice === undefined) return undefined
        if (choice === 'cant_tell') return 'cant_tell'
        return choice === e.aSide ? 'a' : 'b'
      })
      if (resolved.some(r => r === undefined)) return
      score.judges++
      const same = resolved.every(r => r === resolved[0])
      if (same && resolved[0] !== 'cant_tell') score.consistent++
      if (same ? resolved[0] === 'cant_tell' : !resolved.includes('cant_tell')) score.neutral++
    })
  }
  const mean = (values: number[]): number | undefined => {
    return values.length === 0 ? undefined : values.reduce((s, v) => s + v, 0) / values.length
  }
  const pairs: PairScore[] = [...byPair.values()].map(({ ratings, ...score }) => {
    const ratingA = mean(ratings.a)
    const ratingB = mean(ratings.b)
    return { ...score, ...(ratingA === undefined ? {} : { ratingA }), ...(ratingB === undefined ? {} : { ratingB }) }
  })
  const real = pairs.filter(p => !p.control)
  const controls = pairs.filter(p => p.control)
  const neutral = controls.reduce((sum, p) => sum + p.neutral, 0)
  const answered = controls.reduce((sum, p) => sum + p.judges, 0)
  return {
    pairs,
    aShare: share(real.reduce((s, p) => s + p.a, 0), real.reduce((s, p) => s + p.a + p.b, 0)),
    leftShare: share(left, picks),
    controlNeutral: share(neutral, answered),
    missing
  }
}

export function formatScore (key: PanelKey, score: PanelScore): string {
  const percent = (v: number): string => Number.isNaN(v) ? 'n/a' : `${(v * 100).toFixed(0)}%`
  const rating = (p: PairScore): string => {
    return p.ratingA === undefined ? '' : `, rating a ${p.ratingA.toFixed(1)} b ${(p.ratingB ?? NaN).toFixed(1)}`
  }
  return [
    `panel: ${key.name}`,
    ...score.pairs.map(p => {
      const kind = p.control ? 'control' : 'pair'
      return `${kind} ${p.pair}: a ${p.a}, b ${p.b}, cant_tell ${p.cantTell}; same image picked in ` +
        `both orders by ${p.consistent}/${p.judges} judges, not separated by ${p.neutral}/${p.judges}${rating(p)}`
    }),
    `a picked in ${percent(score.aShare)} of picks on real pairs`,
    `left picked in ${percent(score.leftShare)} of all picks (50% = no position bias)`,
    `controls left unseparated (cant_tell in both orders, or the same side picked in both) by ` +
      `${percent(score.controlNeutral)} of judges`,
    ...(score.missing.length > 0 ? [`missing answers: ${score.missing.join(', ')}`] : [])
  ].join('\n')
}
