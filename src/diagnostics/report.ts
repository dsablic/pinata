import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type Gate = {
  name: string
  value: number
  op: '<=' | '>='
  threshold: number
  rationale: string
  skipped?: true
}

export type GateResult = Gate & { pass: boolean }

export function optionalGate (g: Gate, enabled: boolean): Gate {
  return enabled ? g : { ...g, skipped: true }
}

export function evaluate (gates: Gate[]): GateResult[] {
  return gates.map(g => {
    if (g.skipped === true) return { ...g, pass: true }
    return { ...g, pass: g.op === '<=' ? g.value <= g.threshold : g.value >= g.threshold }
  })
}

export function formatNumber (v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(3)
}

export function summarize (title: string, results: GateResult[]): string {
  const lines = results.map(r => {
    if (r.skipped === true) return `SKIP  ${r.name}: not run, pass --verify`
    return `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}: ${formatNumber(r.value)} ${r.op} ${r.threshold}`
  })
  const skipped = results.filter(r => r.skipped === true).length
  const passed = results.every(r => r.pass) ? 'PASS' : 'FAIL'
  const verdict = skipped > 0 && passed === 'PASS' ? `PASS (${skipped} skipped)` : passed
  return [title, ...lines, `automated gates: ${verdict}`].join('\n')
}

export function writeOutput (path: string, contents: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}
