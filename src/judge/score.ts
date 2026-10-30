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
  /** Judges who picked the same image in both orders, out of judges who answered both. */
  consistent: number
  judges: number
  ratingA?: number
  ratingB?: number
}
export type PanelScore = {
  pairs: PairScore[]
  /** Share of picks (not cant_tell) for `a` over all real pairs. */
  aShare: number
  /** Share of picks for the left image over all pairs: 0.5 means no position bias. */
  leftShare: number
  /** Share of control answers that were cant_tell, or picks that split evenly across the two orders. */
  controlNeutral: number
  missing: string[]
}

const CHOICES: ReadonlySet<string> = new Set(['left', 'right', 'cant_tell'])

/** Checks one judge's answers against the key; returns problems as text. */
export function answerProblems (answers: unknown, key: PanelKey): string[] {
  if (!isRecord(answers)) return ['expected a JSON object mapping item names to answers']
  const problems: string[] = []
  for (const item of Object.keys(key.items)) {
    const answer = answers[item]
    if (answer === undefined) problems.push(`${item}: missing`)
    else if (!isRecord(answer) || typeof answer.choice !== 'string' || !CHOICES.has(answer.choice)) {
      problems.push(`${item}: expected { "choice": "left" | "right" | "cant_tell" }`)
    }
  }
  for (const item of Object.keys(answers)) if (key.items[item] === undefined) problems.push(`${item}: not in the panel`)
  return problems
}

function share (part: number, whole: number): number {
  return whole === 0 ? NaN : part / whole
}

/** Scores a panel from each judge's answers, resolving left and right back to a and b with the key. */
export function scorePanel (key: PanelKey, judges: JudgeAnswers[]): PanelScore {
  const byPair = new Map<string, PairScore & { ratings: { a: number[], b: number[] } }>()
  const missing: string[] = []
  let left = 0
  let picks = 0
  for (const [item, entry] of Object.entries(key.items)) {
    const score = byPair.get(entry.pair) ?? {
      pair: entry.pair, control: entry.control, a: 0, b: 0, cantTell: 0, consistent: 0, judges: 0,
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
      if (resolved.every(r => r === resolved[0])) score.consistent++
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
  const neutral = controls.reduce((sum, p) => sum + p.cantTell + 2 * Math.min(p.a, p.b), 0)
  const answered = controls.reduce((sum, p) => sum + p.cantTell + p.a + p.b, 0)
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
      return `${kind} ${p.pair}: a ${p.a}, b ${p.b}, cant_tell ${p.cantTell}; same pick in both orders ` +
        `${p.consistent}/${p.judges}${rating(p)}`
    }),
    `a picked in ${percent(score.aShare)} of picks on real pairs`,
    `left picked in ${percent(score.leftShare)} of all picks (50% = no position bias)`,
    `controls answered neutrally (cant_tell, or an even split across orders) in ${percent(score.controlNeutral)}`,
    ...(score.missing.length > 0 ? [`missing answers: ${score.missing.join(', ')}`] : [])
  ].join('\n')
}
