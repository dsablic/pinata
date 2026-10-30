import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type Gate = { name: string, value: number, op: '<=' | '>=', threshold: number, rationale: string }

export type GateResult = Gate & { pass: boolean }

export function evaluate (gates: Gate[]): GateResult[] {
  return gates.map(g => ({ ...g, pass: g.op === '<=' ? g.value <= g.threshold : g.value >= g.threshold }))
}

function formatNumber (v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(3)
}

export function summarize (title: string, results: GateResult[]): string {
  const lines = results.map(r => {
    return `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}: ${formatNumber(r.value)} ${r.op} ${r.threshold}`
  })
  const verdict = results.every(r => r.pass) ? 'PASS' : 'FAIL'
  return [title, ...lines, `automated gates: ${verdict}`].join('\n')
}

export function writeOutput (path: string, contents: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}
