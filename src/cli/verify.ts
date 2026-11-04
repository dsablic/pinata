import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { changeOf, describeFiles, describeLines, hashLines, isUnchanged } from '../checks/baseline.ts'
import type { Change } from '../checks/baseline.ts'
import {
  matching, parseArgs, selected, shouldRetry, summaryOf, tailOf
} from '../checks/verify.ts'
import type { Outcome } from '../checks/verify.ts'
import { ROOT } from './paths.ts'

const BASELINES = join(ROOT, 'reports', 'baselines')
const PANEL_DIR = join(ROOT, 'reports', 'rendering-panel')
const MAX_BUFFER = 256 * 1024 * 1024

type Ran = { ok: boolean, lines: string[], text: string }
type Described = { headline: string, detail: string[] }
type Baseline = { capture: (ran: Ran) => string[], describe: (change: Change) => Described }
type Pick = (lines: string[]) => string[]
type Step = {
  name: string
  run: () => Ran
  pick: Pick
  baseline?: Baseline
}

function endingOf (result: ReturnType<typeof spawnSync>): string {
  if (result.error !== undefined) return `ended with error: ${result.error.message}`
  return result.signal === null ? `ended with exit status ${result.status ?? 'none'}` : `ended by ${result.signal}`
}

function npm (...args: string[]): Ran {
  const result = spawnSync('npm', ['run', ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: MAX_BUFFER })
  const ok = result.status === 0 && result.error === undefined
  const ending = ok ? '' : `\n${endingOf(result)}`
  const text = `${result.stdout}${result.stderr}${ending}`
  return { ok, lines: text.split('\n'), text }
}

function stopOrphanedChrome (): void {
  spawnSync('pkill', ['-f', 'headless=new.*remote-debugging-port'])
}

function browser (): Ran {
  const built = npm('site')
  if (!built.ok) return built
  const attempt = (): Ran => {
    stopOrphanedChrome()
    return npm('test:browser')
  }
  const first = attempt()
  return first.ok || !shouldRetry(first.text) ? first : attempt()
}

function renderingPanel (): Ran {
  rmSync(PANEL_DIR, { recursive: true, force: true })
  return npm('rendering-panel')
}

function panelHashes (): string[] {
  const files = readdirSync(PANEL_DIR).sort()
  return hashLines(Object.fromEntries(files.map(file => [file, readFileSync(join(PANEL_DIR, file))])))
}

const failureLines = /FAIL|fail|error/i

const STEPS: Step[] = [
  { name: 'typecheck', run: () => npm('typecheck'), pick: lines => matching(lines, /error TS/).concat(tailOf(lines)) },
  { name: 'test', run: () => npm('test'), pick: lines => matching(lines, /^\s*✖/) },
  { name: 'lint', run: () => npm('lint'), pick: lines => matching(lines, /^\S+:\d+: /) },
  { name: 'examples', run: () => npm('examples'), pick: lines => matching(lines, /^FAIL/) },
  { name: 'browser', run: browser, pick: lines => matching(lines, failureLines).concat(tailOf(lines)) },
  {
    name: 'rendering-panel',
    run: renderingPanel,
    pick: tailOf,
    baseline: { capture: panelHashes, describe: change => ({ headline: describeFiles(change), detail: [] }) }
  },
  {
    name: 'gates',
    run: () => npm('gates'),
    pick: tailOf,
    baseline: {
      capture: ran => ran.lines.filter(line => line.startsWith('GATE ')),
      describe: change => ({ headline: `${change.removed.length} lines differ`, detail: describeLines(change) })
    }
  }
]

const baselineFile = (name: string): string => join(BASELINES, `${name}.txt`)
const readBaseline = (name: string): string[] | undefined => {
  return existsSync(baselineFile(name)) ? readFileSync(baselineFile(name), 'utf8').split('\n').slice(0, -1) : undefined
}

function storeBaseline (name: string, lines: string[]): void {
  mkdirSync(BASELINES, { recursive: true })
  writeFileSync(baselineFile(name), `${lines.join('\n')}\n`)
}

function compared (name: string, baseline: Baseline, ran: Ran, accepting: boolean): Outcome {
  const lines = baseline.capture(ran)
  const before = readBaseline(name)
  const change = changeOf(before ?? [], lines)
  const { headline, detail } = baseline.describe(change)
  if (accepting) {
    storeBaseline(name, lines)
    if (before === undefined) return { status: 'pass', headline: `new baseline, ${lines.length} lines`, detail: [] }
    if (isUnchanged(change)) return { status: 'pass', headline: 'baseline unchanged', detail: [] }
    return { status: 'pass', headline: `baseline updated, ${headline}`, detail }
  }
  if (isUnchanged(change)) return { status: 'pass', headline: 'same as baseline', detail: [] }
  return { status: 'changed', headline: `changed, ${headline}`, detail }
}

function outcomeOf (step: Step, accepting: boolean): Outcome {
  if (!accepting && step.baseline !== undefined && readBaseline(step.name) === undefined) {
    return { status: 'fail', headline: `no baseline (run --accept ${step.name})`, detail: [] }
  }
  const ran = step.run()
  if (!ran.ok) return { status: 'fail', headline: 'fail', detail: step.pick(ran.lines) }
  if (step.baseline === undefined) return { status: 'pass', headline: 'pass', detail: [] }
  return compared(step.name, step.baseline, ran, accepting)
}

function report (name: string, outcome: Outcome, seconds: number): void {
  console.log(`${outcome.status.padEnd(7)} ${name.padEnd(16)} ${outcome.headline} (${seconds.toFixed(0)} s)`)
  for (const line of outcome.detail) console.log(`          ${line}`)
}

function main (): number {
  const names = STEPS.map(step => step.name)
  const accepting = STEPS.filter(step => step.baseline !== undefined).map(step => step.name)
  const parsed = parseArgs(process.argv.slice(2), names, accepting)
  if (parsed.problems.length > 0) {
    for (const problem of parsed.problems) console.error(problem)
    console.error('usage: npm run verify -- [--only a,b] [--skip a,b] [--accept <step>|all]')
    return 2
  }
  const started = performance.now()
  const outcomes: [string, Outcome][] = []
  for (const step of STEPS.filter(s => selected(names, parsed).includes(s.name))) {
    const at = performance.now()
    const outcome = outcomeOf(step, parsed.accept.length > 0)
    outcomes.push([step.name, outcome])
    report(step.name, outcome, (performance.now() - at) / 1000)
  }
  for (const line of summaryOf(outcomes, (performance.now() - started) / 1000)) console.log(line)
  return outcomes.every(([, o]) => o.status === 'pass') ? 0 : 1
}

process.exitCode = main()
