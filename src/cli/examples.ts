import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCheck } from '../tool/check.ts'
import { runExport } from '../tool/export.ts'
import { bufferIo, npmInvoke } from '../tool/io.ts'
import type { Io } from '../tool/io.ts'
import { ROOT } from './paths.ts'

const EXAMPLES = join(ROOT, 'examples')
const TAIL_LINES = 3

type Run = (argv: string[], io: Io) => number
type Step = { command: string, run: Run, argv: (dir: string, scratch: string) => string[] }

const STEPS: Step[] = [
  {
    command: 'check',
    run: (argv, io) => runCheck(argv, io, npmInvoke),
    argv: (dir, scratch) => [dir, '--out', scratch]
  },
  { command: 'export', run: (argv, io) => runExport(argv, io, npmInvoke), argv: (dir, scratch) => [dir, scratch] }
]

const isSkinned = (dir: string): boolean => existsSync(join(dir, 'skin.json')) && existsSync(join(dir, 'retarget.json'))

function runStep (step: Step, name: string, dir: string, scratch: string): boolean {
  const { io, lines } = bufferIo()
  const out = join(scratch, `${name}-${step.command}`)
  const code = step.run(step.argv(dir, out), io)
  const detail = lines.filter(line => line.trim() !== '').slice(-TAIL_LINES).join(' | ')
  const failure = code === 0 ? '' : ` (exit ${code}): ${detail}`
  console.log(`${code === 0 ? 'pass' : 'FAIL'} ${name} ${step.command}${failure}`)
  return code === 0
}

const scratch = mkdtempSync(join(tmpdir(), 'pinata-examples-'))
const names = readdirSync(EXAMPLES, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort()
const results = names.flatMap(name => {
  const dir = join(EXAMPLES, name)
  const steps = STEPS.filter(step => step.command === 'check' || isSkinned(dir))
  return steps.map(step => runStep(step, name, dir, scratch))
})
rmSync(scratch, { recursive: true, force: true })
const failed = results.filter(ok => !ok).length
console.log(`examples: ${results.length - failed} of ${results.length} passed`)
process.exitCode = failed === 0 ? 0 : 1
