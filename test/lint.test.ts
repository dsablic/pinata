import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codeFindings, commentLines, docFindings } from '../src/checks/lint.ts'
import type { DocContext } from '../src/checks/lint.ts'

const present = new Set(['docs/real.md'])
const context: DocContext = {
  exists: path => present.has(path),
  dirOf: file => file.slice(0, file.lastIndexOf('/')),
  join: (...parts) => parts.join('/').replace(/[^/]+\/\.\.\//g, '')
}
const rules = (text: string, journal = true): string[] => {
  return docFindings('docs/page.md', text, context, journal).map(f => `${f.line}:${f.rule}`)
}

test('comments are found, and slashes in strings, templates, regexes and URLs are not', () => {
  const code = [
    'const a = 1 // trailing',
    'const url = \'http://example.com/a\'',
    'const t = `http://x/${a}/y // not` + `${`${a}`}//z`',
    'const r = /[/]\\/\\/ab/.test(x)',
    'const d = a / b / c',
    '/* block',
    'continues */ const e = "//"',
    '// whole line'
  ].join('\n')
  assert.deepEqual(commentLines(code), [1, 6, 7, 8])
})

test('a line over 120 columns is reported with its line number', () => {
  const findings = codeFindings('a.ts', `const a = 1\nconst b = '${'x'.repeat(120)}'\n`)
  assert.deepEqual(findings.map(f => [f.line, f.rule]), [[2, 'line-length']])
})

test('documents: long lines are exempt in tables and code blocks, links must resolve', () => {
  const long = 'word '.repeat(30)
  const links = '[ok](real.md#part) [web](https://a.b) [bad](gone.md)'
  const text = [long, `| ${long} |`, '```', long, '```', links].join('\n')
  assert.deepEqual(rules(text), ['1:line-length', '6:dead-link'])
})

test('documents: dates and journal phrases count in prose, not in code spans or link targets', () => {
  const text = [
    'Decided on 2026-11-05.', 'It is now faster.', 'The `now` function and [plan](2026-11-05-x.md) are fine.',
    'We know the snow.', 'It no longer works.'
  ].join('\n')
  assert.deepEqual(rules(text, true).filter(r => !r.endsWith('dead-link')),
    ['1:date', '2:journal-phrase', '5:journal-phrase'])
  assert.deepEqual(rules('Decided on 2026-11-05, now.', false), [])
})
