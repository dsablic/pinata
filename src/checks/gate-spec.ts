import type { Gate } from '../export/report.ts'

export const AUTHORING_GATES = ['pivot', 'threeQuarterViews', 'backViewFace', 'sideProfile'] as const
export type DeclaredGate = Gate | typeof AUTHORING_GATES[number]
export type Observes = 'drawn pixels' | 'joints' | 'painter state' | 'files'
export type Verdict = { pass: boolean, measured: boolean }
export type GateCase = { name: string, run: () => Verdict, measured?: boolean }
export type GateSpec = {
  gate: DeclaredGate
  observes: Observes
  frame: string
  threshold: string
  bad: GateCase[]
  good: GateCase[]
}

const registry = new Map<DeclaredGate, GateSpec>()

export function declareGate (spec: GateSpec): void {
  if (registry.has(spec.gate)) throw new Error(`gate ${spec.gate} is declared twice`)
  registry.set(spec.gate, spec)
}

export function declaredGates (): GateSpec[] {
  return [...registry.values()]
}

export function caseFailures ({ gate, bad, good }: GateSpec): string[] {
  const missing = bad.length === 0 || good.length === 0 ? [`${gate}: needs a failing and a passing case`] : []
  const wrongBad = bad.filter(item => {
    const { pass, measured } = item.run()
    return pass || measured !== (item.measured ?? true)
  }).map(item => `${gate}: bad case "${item.name}" did not fail as expected`)
  const wrongGood = good.filter(item => {
    const { pass, measured } = item.run()
    return !pass || !measured
  }).map(item => `${gate}: good case "${item.name}" did not pass`)
  return [...missing, ...wrongBad, ...wrongGood]
}
