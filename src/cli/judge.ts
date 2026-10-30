import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { writeOutput } from '../diagnostics/report.ts'
import { formatErrors, isRecord } from '../formats/validate.ts'
import { buildPacket, validatePanelSpec } from '../judge/packet.ts'
import type { PanelKey } from '../judge/packet.ts'
import { answerProblems, formatScore, scorePanel } from '../judge/score.ts'
import type { JudgeAnswers } from '../judge/score.ts'
import { decodePng } from '../png/decode.ts'
import { encodePng } from '../png/encode.ts'

const USAGE = 'usage: npm run judge -- build <panel.json> <packet dir> <key.json>\n' +
  '       npm run judge -- score <key.json> <judge answers.json>...'

function readJson (path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

const CASE_INSENSITIVE = process.platform === 'darwin' || process.platform === 'win32'
const PACKET_FILE = /^(item-\d+\.png|questions\.md)$/

/** Whether the file at `path` would land inside `dir`, after following symlinks (both folders must exist). */
function isInside (path: string, dir: string): boolean {
  const fold = (p: string): string => CASE_INSENSITIVE ? p.toLowerCase() : p
  const rel = relative(fold(realpathSync(dir)), fold(join(realpathSync(dirname(path)), basename(path))))
  return rel === '' || !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
}

function build (specPath: string, packetDir: string, keyPath: string): number {
  const [spec, packet, key] = [specPath, packetDir, keyPath].map(p => resolve(p))
  mkdirSync(packet, { recursive: true })
  mkdirSync(dirname(key), { recursive: true })
  if (isInside(key, packet)) {
    console.error(`the key '${key}' must not be inside the packet folder '${packet}': judges would see it`)
    return 2
  }
  const validated = validatePanelSpec(readJson(spec))
  if (validated.value === undefined) {
    console.error(formatErrors(specPath, validated.errors))
    return 2
  }
  const built = buildPacket(validated.value, path => decodePng(readFileSync(resolve(dirname(spec), path))))
  for (const name of readdirSync(packet)) if (PACKET_FILE.test(name)) rmSync(join(packet, name))
  for (const [name, image] of Object.entries(built.images)) writeOutput(join(packet, name), encodePng(image))
  writeOutput(join(packet, 'questions.md'), built.questions)
  writeOutput(key, `${JSON.stringify(built.key, null, 2)}\n`)
  console.log(`${Object.keys(built.images).length} items in ${packet}; key in ${key}`)
  return 0
}

function score (keyPath: string, answerPaths: string[]): number {
  if (answerPaths.length === 0) {
    console.error(USAGE)
    return 2
  }
  const read = readJson(keyPath)
  if (!isRecord(read) || typeof read.name !== 'string' || !isRecord(read.items)) {
    console.error(`${keyPath}: not a panel key written by 'npm run judge -- build'`)
    return 2
  }
  const key = read as PanelKey
  const judges: JudgeAnswers[] = []
  let broken = false
  for (const path of answerPaths) {
    const answers = readJson(path)
    const problems = answerProblems(answers, key)
    if (problems.length > 0) {
      console.error(`${path}:\n  ${problems.join('\n  ')}`)
      broken = true
    }
    judges.push(answers as JudgeAnswers)
  }
  if (broken) return 2
  console.log(formatScore(key, scorePanel(key, judges)))
  return 0
}

function main (): number {
  const [command, ...args] = process.argv.slice(2)
  try {
    if (command === 'build' && args.length === 3) return build(args[0], args[1], args[2])
    if (command === 'score') return score(args[0], args.slice(1))
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    return 2
  }
  console.error(USAGE)
  return 2
}

process.exitCode = main()
