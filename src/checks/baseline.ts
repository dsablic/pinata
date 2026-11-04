import { createHash } from 'node:crypto'

export type Change = { added: string[], removed: string[] }

export const MAX_SHOWN = 6

export function hashLines (files: Record<string, Uint8Array>): string[] {
  return Object.keys(files).sort().map(name => `${createHash('sha256').update(files[name]).digest('hex')}  ${name}`)
}

export function changeOf (before: string[], after: string[]): Change {
  const had = new Set(before)
  const has = new Set(after)
  return { added: after.filter(line => !had.has(line)), removed: before.filter(line => !has.has(line)) }
}

export const isUnchanged = (change: Change): boolean => change.added.length === 0 && change.removed.length === 0

const nameOf = (hashed: string): string => hashed.slice(hashed.indexOf('  ') + 2)

function limited (items: string[]): string {
  const shown = items.slice(0, MAX_SHOWN).join(', ')
  return items.length > MAX_SHOWN ? `${shown} and ${items.length - MAX_SHOWN} more` : shown
}

export function describeFiles (change: Change): string {
  const names = (lines: string[]): string[] => lines.map(nameOf)
  const gone = new Set(names(change.removed))
  const here = new Set(names(change.added))
  const edited = [...here].filter(name => gone.has(name))
  const added = [...here].filter(name => !gone.has(name))
  const removed = [...gone].filter(name => !here.has(name))
  return [
    edited.length > 0 ? `changed ${limited(edited)}` : '',
    added.length > 0 ? `added ${limited(added)}` : '',
    removed.length > 0 ? `removed ${limited(removed)}` : ''
  ].filter(part => part !== '').join('; ')
}

export function describeLines (change: Change): string[] {
  const shown = (prefix: string, lines: string[]): string[] => [
    ...lines.slice(0, MAX_SHOWN).map(line => `${prefix} ${line}`),
    ...(lines.length > MAX_SHOWN ? [`${prefix} ... ${lines.length - MAX_SHOWN} more`] : [])
  ]
  return [...shown('-', change.removed), ...shown('+', change.added)]
}
