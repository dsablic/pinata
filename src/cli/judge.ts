import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { writeOutput } from '../diagnostics/report.ts'
import { formatErrors, isRecord } from '../formats/validate.ts'
import {
  buildChoicePacket, choiceProblems, formatChoiceScore, isChoiceKey, isChoiceSpec, scoreChoices, validateChoiceSpec
} from '../judge/choice.ts'
import type { ChoiceAnswers, ChoiceKey, ChoicePacket, ChoiceSpec } from '../judge/choice.ts'
import { problemsWithAnswers } from '../judge/answers.ts'
import { askClaude } from '../judge/claude.ts'
import { keyInsidePacket, lintPanel, strayFiles } from '../judge/lint.ts'
import { buildPacket, validatePanelSpec } from '../judge/packet.ts'
import type { Packet, PanelKey, PanelSpec } from '../judge/packet.ts'
import { checkIsolation } from '../judge/isolation.ts'
import { runJudges } from '../judge/runner.ts'
import { withJudgeDir } from '../judge/sandbox.ts'
import type { Outcome } from '../judge/runner.ts'
import { formatScore, scorePanel } from '../judge/score.ts'
import type { JudgeAnswers } from '../judge/score.ts'
import type { Image } from '../image.ts'
import { decodePng } from '../png/decode.ts'
import { encodePng } from '../png/encode.ts'

const USAGE = 'usage: npm run judge -- build <panel.json> <packet dir> <key.json>\n' +
  '       (a panel with "items" and "labels" instead of "pairs" asks which label each image has)\n' +
  '       npm run judge -- score <key.json> <judge answers.json>...\n' +
  '       npm run judge -- run <panel.json> <dir>   (builds <dir>/packet and <dir>/key.json, asks three judges)\n' +
  '       npm run judge -- lint <panel.json>\n' +
  "       npm run judge -- isolation   (asks a haiku judge to read a file outside its folder; it must fail)"

function readJson (path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

const PACKET_FILE = /^(item-\d+\.png|questions\.md)$/
const JUDGE_FILE = /^judge-.*\.json$/

type Loaded = { spec: ChoiceSpec | PanelSpec, kind: 'choice' | 'pairwise', load: (path: string) => Image }

function readSpec (specPath: string): Loaded | undefined {
  const input = readJson(specPath)
  const choice = isChoiceSpec(input)
  const validated = choice ? validateChoiceSpec(input) : validatePanelSpec(input)
  if (validated.value === undefined) {
    console.error(formatErrors(specPath, validated.errors))
    return undefined
  }
  const load = (path: string): Image => decodePng(readFileSync(resolve(dirname(specPath), path)))
  return { spec: validated.value, kind: choice ? 'choice' : 'pairwise', load }
}

function compose (loaded: Loaded): Packet | ChoicePacket {
  return loaded.kind === 'choice'
    ? buildChoicePacket(loaded.spec as ChoiceSpec, loaded.load)
    : buildPacket(loaded.spec as PanelSpec, loaded.load)
}

function lint (loaded: Loaded, built: Packet | ChoicePacket): boolean {
  const problems = lintPanel(loaded.spec, built.images)
  for (const problem of problems) console.error(`lint: ${problem}`)
  return problems.length === 0
}

function writePacket (built: Packet | ChoicePacket, packet: string, key: string): number {
  for (const name of readdirSync(packet)) if (PACKET_FILE.test(name)) rmSync(join(packet, name))
  for (const [name, image] of Object.entries(built.images)) writeOutput(join(packet, name), encodePng(image))
  writeOutput(join(packet, 'questions.md'), built.questions)
  writeOutput(key, `${JSON.stringify(built.key, null, 2)}\n`)
  return Object.keys(built.images).length
}

function build (specPath: string, packetDir: string, keyPath: string): number {
  const [spec, packet, key] = [specPath, packetDir, keyPath].map(p => resolve(p))
  mkdirSync(packet, { recursive: true })
  mkdirSync(dirname(key), { recursive: true })
  if (keyInsidePacket(key, packet)) {
    console.error(`the key '${key}' must not be inside the packet folder '${packet}': judges would see it`)
    return 2
  }
  const loaded = readSpec(spec)
  if (loaded === undefined) return 2
  console.log(`${writePacket(compose(loaded), packet, key)} items in ${packet}; key in ${key}`)
  return 0
}

function lintCommand (specPath: string): number {
  const loaded = readSpec(resolve(specPath))
  if (loaded === undefined || !lint(loaded, compose(loaded))) return 2
  console.log('lint: ok')
  return 0
}

function scoreText (read: Record<string, unknown>, judges: unknown[]): string {
  if (isChoiceKey(read)) return formatChoiceScore(read, scoreChoices(read, judges as ChoiceAnswers[]))
  const key = read as PanelKey
  return formatScore(key, scorePanel(key, judges as JudgeAnswers[]))
}

function readKey (keyPath: string): Record<string, unknown> | undefined {
  const read = readJson(keyPath)
  if (isRecord(read) && typeof read.name === 'string' && isRecord(read.items)) return read
  console.error(`${keyPath}: not a panel key written by 'npm run judge -- build'`)
  return undefined
}

function score (keyPath: string, answerPaths: string[]): number {
  if (answerPaths.length === 0) {
    console.error(USAGE)
    return 2
  }
  const read = readKey(keyPath)
  if (read === undefined) return 2
  const judges: unknown[] = []
  let broken = false
  for (const path of answerPaths) {
    const answers = readJson(path)
    const problems = problemsWithAnswers(answers, read as PanelKey | ChoiceKey)
    if (problems.length > 0) {
      console.error(`${path}:\n  ${problems.join('\n  ')}`)
      broken = true
    }
    judges.push(answers)
  }
  if (broken) return 2
  console.log(scoreText(read, judges))
  return 0
}

function describe (outcome: Outcome): string {
  const spent = outcome.run ?? outcome.spent
  const failed = outcome.run === undefined ? `FAILED: ${outcome.failure}` : ''
  if (spent === undefined) return `judge ${outcome.model}: ${failed}`
  const { durationMs, costUsd, attempts } = spent
  const cost = costUsd === undefined ? 'cost unknown' : `$${costUsd.toFixed(3)}`
  const used = `${(durationMs / 1000).toFixed(0)} s, ${cost}, ${attempts} attempt${attempts === 1 ? '' : 's'}`
  return `judge ${outcome.model}: ${failed === '' ? used : `${failed} (${used})`}`
}

function resetRunDir (dir: string, packet: string): void {
  rmSync(packet, { recursive: true, force: true })
  mkdirSync(packet, { recursive: true })
  for (const name of readdirSync(dir)) if (JUDGE_FILE.test(name)) rmSync(join(dir, name))
}

async function askInFreshFolder (packet: string, names: string[], read: Record<string, unknown>): Promise<Outcome[]> {
  return withJudgeDir(packet, names, async judgeDir => {
    const stray = strayFiles(judgeDir, names)
    if (stray.length > 0) throw new Error(`the judges' folder differs from the packet's files: ${stray.join(', ')}`)
    return runJudges(askClaude, judgeDir, read as PanelKey | ChoiceKey)
  })
}

async function run (specPath: string, dirPath: string): Promise<number> {
  const [spec, dir] = [resolve(specPath), resolve(dirPath)]
  const [packet, key] = [join(dir, 'packet'), join(dir, 'key.json')]
  mkdirSync(dir, { recursive: true })
  resetRunDir(dir, packet)
  const loaded = readSpec(spec)
  if (loaded === undefined) return 2
  const built = compose(loaded)
  if (!lint(loaded, built)) return 2
  console.log(`${writePacket(built, packet, key)} items in ${packet}; key in ${key}`)
  const read = readKey(key) as Record<string, unknown>
  const names = [...Object.keys(built.images), 'questions.md']
  const outcomes = await askInFreshFolder(packet, names, read)
  for (const outcome of outcomes) {
    console.log(describe(outcome))
    if (outcome.run === undefined) continue
    const answers = JSON.stringify(outcome.run.answers, null, 2)
    writeOutput(join(dir, `judge-${outcome.model}.json`), `${answers}\n`)
  }
  if (outcomes.some(o => o.run === undefined)) return 1
  console.log(scoreText(read, outcomes.map(o => (o.run as { answers: unknown }).answers)))
  return 0
}

async function main (): Promise<number> {
  const [command, ...args] = process.argv.slice(2)
  try {
    if (command === 'build' && args.length === 3) return build(args[0], args[1], args[2])
    if (command === 'score') return score(args[0], args.slice(1))
    if (command === 'lint' && args.length === 1) return lintCommand(args[0])
    if (command === 'run' && args.length === 2) return await run(args[0], args[1])
    if (command === 'isolation' && args.length === 0) return await checkIsolation(askClaude)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    return 2
  }
  console.error(USAGE)
  return 2
}

process.exitCode = await main()
