import { evaluate, formatNumber } from '../diagnostics/report.ts'
import type { Gate, GateResult } from '../diagnostics/report.ts'

export type Check = { gate: Gate, hint: () => string }

export type CheckResult = GateResult & { hint?: string }

const NOT_FINITE = 'the metric is not finite, so it measured nothing'

export function runChecks (checks: Check[]): CheckResult[] {
  return checks.map(({ gate, hint }) => {
    const [result] = evaluate([gate])
    if (result.pass) return result
    const reason = Number.isFinite(gate.value) ? '' : `${NOT_FINITE}: `
    return { ...result, hint: reason + hint() }
  })
}

export function formatSummary (header: string, results: CheckResult[]): string {
  const lines = results.flatMap(r => {
    const line = `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}: ${formatNumber(r.value)} ${r.op} ${r.threshold}`
    return r.hint === undefined ? [line] : [line, `      hint: ${r.hint}`]
  })
  const verdict = results.every(r => r.pass) ? 'PASS' : 'FAIL'
  return [header, ...lines, `automated gates: ${verdict}`].join('\n')
}
