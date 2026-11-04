import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { codeFindings, docFindings, formatFinding } from '../checks/lint.ts'
import type { DocContext, Finding } from '../checks/lint.ts'
import { ROOT } from './paths.ts'

const CODE_DIRS = ['src', 'test', 'pocs', 'site']
const SKIPPED = new Set(['node_modules', 'dist', 'reports', '_site', 'report', 'guide'])
const NO_JOURNAL = ['docs/plans/done/']

function walk (dir: string, wanted: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return SKIPPED.has(entry.name) || entry.name.startsWith('.') ? [] : walk(path, wanted)
    return wanted(entry.name) ? [path] : []
  })
}

const context: DocContext = { exists: existsSync, dirOf: dirname, join }
const rel = (path: string): string => relative(ROOT, path)
const read = (path: string): string => readFileSync(path, 'utf8')

function journalChecked (file: string): boolean {
  return file.startsWith('docs/') && !NO_JOURNAL.some(prefix => file.startsWith(prefix))
}

function lintAll (): Finding[] {
  const code = CODE_DIRS.flatMap(dir => walk(join(ROOT, dir), name => name.endsWith('.ts')))
    .flatMap(path => codeFindings(rel(path), read(path)))
  const docs = walk(ROOT, name => name.endsWith('.md'))
    .flatMap(path => docFindings(rel(path), read(path), { ...context, exists: p => existsSync(join(ROOT, p)) },
      journalChecked(rel(path))))
  return [...code, ...docs]
}

const findings = lintAll()
for (const finding of findings) console.log(formatFinding(finding))
console.log(findings.length === 0 ? 'lint: clean' : `lint: ${findings.length} findings`)
process.exitCode = findings.length === 0 ? 0 : 1
