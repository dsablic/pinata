export type Finding = { file: string, line: number, rule: string, text: string }

export const MAX_COLUMNS = 120
const REGEX_AFTER = new Set('(,=:[!&|?{;+-*%<>~^}'.split('').filter(c => c !== '}'))
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do'])
const JOURNAL_PHRASES = ['now', 'no longer', 'was changed', 'at first', 'first version', 'used to']
const DATE = /\b\d{4}-\d{2}-\d{2}\b/
const FENCE = /^\s*(```|~~~)/
const LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)|^\s*\[[^\]]+\]:\s*(\S+)/g

type Scan = { text: string, at: number, line: number, lines: number[], templates: number[], depth: number }

function previousToken (text: string, at: number): { char: string, word: string } {
  let i = at - 1
  while (i >= 0 && /\s/.test(text[i])) i--
  if (i < 0) return { char: '', word: '' }
  let start = i
  while (start >= 0 && /[A-Za-z0-9_$]/.test(text[start])) start--
  return { char: text[i], word: text.slice(start + 1, i + 1) }
}

function startsRegex (text: string, at: number): boolean {
  const { char, word } = previousToken(text, at)
  if (char === '') return true
  if (word !== '') return REGEX_KEYWORDS.has(word)
  return REGEX_AFTER.has(char)
}

function skipQuoted (s: Scan, quote: string): void {
  s.at++
  while (s.at < s.text.length && s.text[s.at] !== quote && s.text[s.at] !== '\n') {
    s.at += s.text[s.at] === '\\' ? 2 : 1
  }
  s.at++
}

function skipRegex (s: Scan): void {
  let inClass = false
  s.at++
  while (s.at < s.text.length && s.text[s.at] !== '\n') {
    const c = s.text[s.at]
    if (c === '\\') s.at++
    else if (c === '[') inClass = true
    else if (c === ']') inClass = false
    else if (c === '/' && !inClass) break
    s.at++
  }
  s.at++
}

function skipTemplate (s: Scan): void {
  s.at++
  continueTemplate(s)
}

function continueTemplate (s: Scan): void {
  while (s.at < s.text.length) {
    const c = s.text[s.at]
    if (c === '\\') s.at += 2
    else if (c === '`') {
      s.at++
      return
    } else if (c === '$' && s.text[s.at + 1] === '{') {
      s.at += 2
      s.templates.push(s.depth)
      s.depth = 0
      return
    } else {
      if (c === '\n') s.line++
      s.at++
    }
  }
}

function skipLineComment (s: Scan): void {
  s.lines.push(s.line)
  while (s.at < s.text.length && s.text[s.at] !== '\n') s.at++
}

function skipBlockComment (s: Scan): void {
  s.lines.push(s.line)
  s.at += 2
  while (s.at < s.text.length && !(s.text[s.at] === '*' && s.text[s.at + 1] === '/')) {
    if (s.text[s.at] === '\n') {
      s.line++
      s.lines.push(s.line)
    }
    s.at++
  }
  s.at += 2
}

function closeBrace (s: Scan): void {
  if (s.depth === 0 && s.templates.length > 0) {
    s.depth = s.templates.pop() as number
    s.at++
    continueTemplate(s)
    return
  }
  s.depth--
  s.at++
}

function step (s: Scan): void {
  const c = s.text[s.at]
  const next = s.text[s.at + 1]
  if (c === '\n') {
    s.line++
    s.at++
  } else if (c === '\'' || c === '"') skipQuoted(s, c)
  else if (c === '`') skipTemplate(s)
  else if (c === '/' && next === '/') skipLineComment(s)
  else if (c === '/' && next === '*') skipBlockComment(s)
  else if (c === '/' && startsRegex(s.text, s.at)) skipRegex(s)
  else if (c === '{') {
    s.depth++
    s.at++
  } else if (c === '}') closeBrace(s)
  else s.at++
}

export function commentLines (text: string): number[] {
  const s: Scan = { text, at: 0, line: 1, lines: [], templates: [], depth: 0 }
  while (s.at < text.length) step(s)
  return [...new Set(s.lines)]
}

const columnsOf = (line: string): number => [...line].length

function longLines (file: string, lines: string[]): Finding[] {
  return lines.flatMap((text, i) => {
    if (columnsOf(text) <= MAX_COLUMNS) return []
    return [{ file, line: i + 1, rule: 'line-length', text: `${columnsOf(text)} columns` }]
  })
}

export function codeFindings (file: string, text: string): Finding[] {
  const lines = text.split('\n')
  const comments = commentLines(text).map(line => ({ file, line, rule: 'comment', text: lines[line - 1].trim() }))
  return [...comments, ...longLines(file, lines)].sort((a, b) => a.line - b.line)
}

function stripCode (line: string): string {
  return line.replace(/`[^`]*`/g, '')
}

function stripLinks (line: string): string {
  return line.replace(/\]\([^)]*\)/g, ']')
}

function journalPhrase (line: string): string | undefined {
  return JOURNAL_PHRASES.find(p => new RegExp(`\\b${p}\\b`, 'i').test(line))
}

function linkTargets (line: string): string[] {
  return [...stripCode(line).matchAll(LINK)].map(m => m[1] ?? m[2])
}

function localPath (target: string): string | undefined {
  if (/^([a-z][a-z0-9+.-]*:|#|<)/i.test(target)) return undefined
  const path = target.split('#')[0]
  return path === '' ? undefined : decodeURIComponent(path)
}

export type DocContext = {
  exists: (path: string) => boolean
  dirOf: (file: string) => string
  join: (...parts: string[]) => string
}

export function docFindings (file: string, text: string, ctx: DocContext, journal: boolean): Finding[] {
  const findings: Finding[] = []
  let fenced = false
  text.split('\n').forEach((line, i) => {
    const add = (rule: string, detail: string): number => findings.push({ file, line: i + 1, rule, text: detail })
    if (FENCE.test(line)) {
      fenced = !fenced
      return
    }
    if (fenced) return
    if (!line.startsWith('|') && columnsOf(line) > MAX_COLUMNS) add('line-length', `${columnsOf(line)} columns`)
    for (const target of linkTargets(line)) {
      const path = localPath(target)
      if (path !== undefined && !ctx.exists(ctx.join(ctx.dirOf(file), path))) add('dead-link', target)
    }
    if (!journal) return
    const prose = stripLinks(stripCode(line))
    const date = prose.match(DATE)
    if (date !== null) add('date', date[0])
    const phrase = journalPhrase(prose)
    if (phrase !== undefined) add('journal-phrase', `"${phrase}": ${line.trim()}`)
  })
  return findings
}

export function formatFinding (f: Finding): string {
  return `${f.file}:${f.line}: ${f.rule}: ${f.text}`
}
