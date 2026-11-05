import type { RubricScore } from '../judge/rubric.ts'
import { DIMENSIONS } from '../judge/rubric.ts'

export type GateRow = {
  dimension: string
  pairs: number
  above: number
  expected: number
  answers: number
  share: number
  pass: boolean
}
export type Validation = {
  rows: GateRow[]
  untested: string[]
  controlDifference: number
  controlAnswered: number
  controlExpected: number
  controlPass: boolean
}

export const ABOVE_SHARE = 0.8
export const CONTROL_DIFFERENCE = 0.5
export const SEPARATOR = '--'

export function targetOf (pair: string): string {
  return pair.split(SEPARATOR)[0]
}

export function validate (score: RubricScore): Validation {
  const real = score.pairs.filter(pair => !pair.control)
  const controls = score.pairs.filter(pair => pair.control)
  const targeted = [...new Set(real.map(pair => targetOf(pair.pair)))]
  const rows = targeted.map((dimension): GateRow => {
    const own = real.filter(pair => targetOf(pair.pair) === dimension)
    const counts = own.map(pair => pair.dimensions.find(d => d.dimension === dimension)!)
    const above = counts.reduce((sum, d) => sum + d.aAbove, 0)
    const answers = counts.reduce((sum, d) => sum + d.answers, 0)
    const expected = counts.reduce((sum, d) => sum + d.expected, 0)
    const share = expected === 0 ? NaN : above / expected
    return { dimension, pairs: own.length, above, expected, answers, share, pass: share >= ABOVE_SHARE }
  })
  const untested = DIMENSIONS.map(d => d.id).filter(id => !targeted.includes(id))
  const controlAnswered = controls.reduce((sum, pair) => sum + pair.answered, 0)
  const controlExpected = controls.reduce((sum, pair) => sum + pair.expected, 0)
  const complete = controlExpected > 0 && controlAnswered === controlExpected
  return { rows, untested, controlDifference: score.controlDifference, controlAnswered, controlExpected,
    controlPass: complete && score.controlDifference <= CONTROL_DIFFERENCE }
}

export function failed (result: Validation): boolean {
  return result.rows.some(row => !row.pass) || !result.controlPass
}

export function formatValidation (result: Validation): string {
  const percent = (v: number): string => Number.isNaN(v) ? 'n/a' : `${(v * 100).toFixed(0)}%`
  const two = (v: number): string => Number.isNaN(v) ? 'n/a' : v.toFixed(2)
  return [
    ...result.rows.map(row => `${row.dimension}: reference above its degraded copy in ${row.above}/${row.expected} ` +
      `answers (${percent(row.share)}; ${row.answers} given) over ${row.pairs} pairs: ` +
      (row.pass ? 'kept' : 'dropped')),
    `no degraded copy for: ${result.untested.join(', ')}`,
    `controls: top-bottom difference per answer ${two(result.controlDifference)} over ` +
      `${result.controlAnswered}/${result.controlExpected} answers: ${result.controlPass ? 'stable' : 'unstable'}`
  ].join('\n')
}
