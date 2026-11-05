import { execFileSync } from 'node:child_process'
import { lstatSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export type Skipped = { path: string, reason: string }
export type Unpacked = { files: string[], skipped: Skipped[] }
export type Contents = { bytes: number, names: string[] }

export const MOST_UNPACKED_BYTES = 500 * 1024 * 1024
export const MOST_ENTRIES = 20_000

const ZIP_TOTAL = /^\s*(\d+)\s+(\d+) files?\s*$/
const ZIP_ENTRY = /^\s*\d+\s+\d{2,4}[-/]\d{2}[-/]\d{2,4}\s+\d{2}:\d{2}\s+(.+)$/
const TAR_ENTRY = /^\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\w{3}\s+\d+\s+[\d:]+\s+(.+)$/
const ZIP_FRAME = /^(Archive:|\s*Length\b|\s*-+[\s-]*$)/

export function zipContents (text: string): Contents {
  const lines = text.split('\n').filter(line => line.trim() !== '' && !ZIP_FRAME.test(line))
  const total = lines.map(line => ZIP_TOTAL.exec(line)).find(found => found !== null)
  const names = lines.map(line => ZIP_ENTRY.exec(line)?.[1]).filter(name => name !== undefined)
  if (total === undefined) throw new Error('the archive listing has no total')
  return { bytes: Number(total[1]), names }
}

export function tarContents (text: string): Contents {
  const lines = text.split('\n').filter(line => line.trim() !== '')
  const parsed = lines.map(line => TAR_ENTRY.exec(line))
  const unread = lines.filter((_, i) => parsed[i] === null)
  if (unread.length > 0) throw new Error(`the archive listing cannot be read: ${unread[0]}`)
  const found = parsed.filter(entry => entry !== null)
  return { bytes: found.reduce((sum, entry) => sum + Number(entry[1]), 0), names: found.map(entry => entry[2]) }
}

export function unsafeEntry (name: string): boolean {
  return name.startsWith('/') || name.split(/[\\/]/).includes('..')
}

export function checkContents (contents: Contents): void {
  if (contents.bytes > MOST_UNPACKED_BYTES) throw new Error(`${contents.bytes} bytes unpacked is over the limit`)
  if (contents.names.length > MOST_ENTRIES) throw new Error(`${contents.names.length} entries is over the limit`)
  const unsafe = contents.names.find(unsafeEntry)
  if (unsafe !== undefined) throw new Error(`the archive holds an entry outside its folder: ${unsafe}`)
}

function listed (archive: string): Contents {
  const isZip = archive.endsWith('.zip')
  const options = { encoding: 'utf8' as const, maxBuffer: 64 * 1024 * 1024 }
  const text = isZip ? execFileSync('unzip', ['-l', archive], options) : execFileSync('tar', ['-tvf', archive], options)
  return isZip ? zipContents(text) : tarContents(text)
}

export function walk (dir: string): Unpacked {
  const found: Unpacked = { files: [], skipped: [] }
  const visit = (here: string): void => {
    for (const name of readdirSync(here)) {
      const path = join(here, name)
      const info = lstatSync(path)
      if (info.isSymbolicLink()) found.skipped.push({ path, reason: 'symbolic link' })
      else if (info.isDirectory()) visit(path)
      else if (info.isFile()) found.files.push(path)
      else found.skipped.push({ path, reason: 'not a regular file' })
    }
  }
  visit(dir)
  found.files.sort()
  return found
}

export function unpack (archive: string, into: string): Unpacked {
  checkContents(listed(archive))
  mkdirSync(into, { recursive: true })
  if (archive.endsWith('.zip')) execFileSync('unzip', ['-qq', '-o', archive, '-d', into], { stdio: 'ignore' })
  else execFileSync('tar', ['-xf', archive, '-C', into], { stdio: 'ignore' })
  return walk(into)
}
