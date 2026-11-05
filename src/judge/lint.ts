import { readdirSync, realpathSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path'
import type { ChoiceSpec } from './choice.ts'
import type { PanelSpec } from './packet.ts'
import type { RubricSpec } from './rubric.ts'

export type Size = { width: number, height: number }

const STOP_WORDS: ReadonlySet<string> = new Set(['the', 'and', 'for', 'with', 'from', 'vs', 'versus', 'panel'])
const MIN_WORD = 3
const STEM_LENGTH = 4
const WIDE_RATIO = 3
const CASE_INSENSITIVE = process.platform === 'darwin' || process.platform === 'win32'

export function wordsOf (text: string): Set<string> {
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= MIN_WORD && !STOP_WORDS.has(w))
  return new Set(words)
}

export function keyInsidePacket (key: string, packet: string): boolean {
  const fold = (p: string): string => CASE_INSENSITIVE ? p.toLowerCase() : p
  const rel = relative(fold(realpathSync(packet)), fold(join(realpathSync(dirname(key)), basename(key))))
  return rel === '' || !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
}

function isRubric (spec: PanelSpec | ChoiceSpec | RubricSpec): spec is RubricSpec {
  return 'kind' in spec && spec.kind === 'rubric'
}

function visibleNames (spec: PanelSpec | ChoiceSpec | RubricSpec): string[] {
  const stem = (path: string): string => basename(path, extname(path))
  if ('pairs' in spec) return spec.pairs.flatMap(p => [p.id, stem(p.a), stem(p.b)])
  if (isRubric(spec)) return spec.items.flatMap(i => [i.id, stem(i.a), ...(i.b === undefined ? [] : [stem(i.b)])])
  return [...spec.items.flatMap(i => [i.id, stem(i.image)]), ...spec.labels]
}

function sameStem (x: string, y: string): boolean {
  if (x === y) return true
  return x.length >= STEM_LENGTH && y.length >= STEM_LENGTH && x.slice(0, STEM_LENGTH) === y.slice(0, STEM_LENGTH)
}

function leakedWords (spec: PanelSpec | ChoiceSpec | RubricSpec): string[] {
  const named = [...wordsOf(spec.name)]
  const visible = visibleNames(spec).flatMap(name => [...wordsOf(name)])
  return [...new Set(visible.filter(word => named.some(n => sameStem(n, word))))]
}

function wideImages (images: Record<string, Size>): string[] {
  return Object.entries(images)
    .filter(([, { width, height }]) => width > WIDE_RATIO * height)
    .map(([name]) => name.replace(/\.png$/, ''))
}

export function strayFiles (dir: string, expected: readonly string[]): string[] {
  const found = readdirSync(dir)
  return [...found.filter(n => !expected.includes(n)), ...expected.filter(n => !found.includes(n))]
}

export function lintPanel (spec: PanelSpec | ChoiceSpec | RubricSpec, images: Record<string, Size>): string[] {
  const problems: string[] = []
  const leaked = leakedWords(spec)
  if (leaked.length > 0) {
    problems.push(`the panel name '${spec.name}' shares ${leaked.map(w => `'${w}'`).join(', ')} with an item id, ` +
      'an image file name or a label: rename the panel with words that appear in none of them')
  }
  if ('pairs' in spec && !spec.pairs.some(p => p.control === true)) {
    problems.push('a pairwise panel needs at least one control pair')
  }
  if (isRubric(spec) && !spec.items.some(i => i.control === true)) {
    problems.push('a rubric panel needs at least one control item: a reference against itself')
  }
  const wide = wideImages(images)
  if (wide.length > 0) {
    const fix = 'pairs' in spec && spec.layout !== 'stacked' ? 'use "layout": "stacked"' : 'use narrower images'
    problems.push(`the packet images ${wide.join(', ')} are wider than ${WIDE_RATIO}x their height: ${fix}`)
  }
  return problems
}
