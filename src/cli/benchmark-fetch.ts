import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, parse, resolve } from 'node:path'
import { unpack, walk } from '../benchmark/archive.ts'
import type { Skipped } from '../benchmark/archive.ts'
import { fetchWithRetry, licenceMatches, REFERENCES } from '../benchmark/itch.ts'
import type { Reference } from '../benchmark/itch.ts'
import { insideRepository, parseFetchArgs } from '../benchmark/safety.ts'
import { decodePng } from '../png/decode.ts'

const LPC = {
  id: 'lpc',
  page: 'https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator',
  author: 'Liberated Pixel Cup contributors',
  licence: 'CC-BY-SA 3.0 / GPL 3.0 (per layer, see the generator credits)'
}
const USAGE = 'usage: npm run benchmark-fetch -- <folder outside the repository> ' +
  '[--lpc <folder of LPC layer sheets>]\n' +
  'exit codes: 0 every reference has files; 1 a reference failed or has none; 2 bad arguments or a folder inside ' +
  'the repository'
const RESOURCE_FILE = /(^|[\\/])(\._[^\\/]*|__MACOSX|\.DS_Store)([\\/]|$)/

type Entry = {
  id: string
  page: string
  author: string
  licence: string
  licenceOnPage?: string
  licenceOnPageMatches?: boolean
  obtained: 'script' | 'by hand' | 'existing'
  files: { path: string, bytes: number, sha256: string }[]
  skipped: Skipped[]
  failed?: string
}

function reason (err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function describeFiles (root: string, paths: string[]): Pick<Entry, 'files' | 'skipped'> {
  const result: Pick<Entry, 'files' | 'skipped'> = { files: [], skipped: [] }
  for (const path of paths) {
    const shown = path.slice(root.length + 1)
    if (RESOURCE_FILE.test(shown)) {
      result.skipped.push({ path: shown, reason: 'macOS resource file' })
      continue
    }
    const bytes = readFileSync(path)
    try {
      if (path.endsWith('.png')) decodePng(bytes)
    } catch (err) {
      result.skipped.push({ path: shown, reason: `does not decode as PNG: ${reason(err)}` })
      continue
    }
    result.files.push({ path: shown, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  return result
}

function archivesIn (dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter(name => /\.(zip|rar)$/.test(name)).map(name => join(dir, name)) : []
}

async function fetched (ref: Reference, archives: string, before?: Entry): Promise<Partial<Entry>> {
  const kept = {
    obtained: before?.obtained ?? 'by hand', licenceOnPage: before?.licenceOnPage,
    licenceOnPageMatches: before?.licenceOnPageMatches
  }
  if (archivesIn(archives).length > 0) return kept
  try {
    const download = await fetchWithRetry(ref, archives)
    return {
      obtained: 'script', licenceOnPage: download.licenceOnPage,
      licenceOnPageMatches: licenceMatches(ref, download.licenceOnPage)
    }
  } catch (err) {
    console.error(`${ref.id}: fetch failed (${reason(err)}); put the zip in ${archives} by hand and run again`)
    return kept
  }
}

function unpacked (dir: string, archives: string): { paths: string[], skipped: Skipped[], failures: string[] } {
  const result = { paths: [] as string[], skipped: [] as Skipped[], failures: [] as string[] }
  for (const archive of archivesIn(archives)) {
    try {
      const found = unpack(archive, join(dir, 'files', parse(archive).name))
      result.paths.push(...found.files)
      result.skipped.push(...found.skipped)
    } catch (err) {
      result.failures.push(`${basename(archive)}: ${reason(err)}`)
    }
  }
  return result
}

async function reference (root: string, ref: Reference, before?: Entry): Promise<Entry> {
  const dir = join(root, ref.id)
  const archives = join(dir, 'archive')
  const how = await fetched(ref, archives, before)
  const found = unpacked(dir, archives)
  const described = describeFiles(root, found.paths)
  const failed = found.failures.length > 0 ? { failed: found.failures.join('; ') } : {}
  const { id, page, author, licence } = ref
  return {
    id, page, author, licence, obtained: 'by hand', ...how, ...described, ...failed,
    skipped: [...found.skipped.map(s => ({ ...s, path: s.path.slice(root.length + 1) })), ...described.skipped]
  }
}

function previous (root: string): Entry[] {
  const path = join(root, 'manifest.json')
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Entry[]
  } catch {
    return []
  }
}

function lpc (root: string, from: string): Entry {
  const dir = join(root, LPC.id, 'files')
  mkdirSync(dir, { recursive: true })
  const found = walk(from)
  const layers = found.files.filter(path => dirname(path) === from && path.endsWith('.png'))
  for (const path of layers) copyFileSync(path, join(dir, basename(path)))
  const described = describeFiles(root, layers.map(path => join(dir, basename(path))))
  return { ...LPC, obtained: 'existing', ...described, skipped: [...found.skipped, ...described.skipped] }
}

function problem (entry: Entry): boolean {
  return entry.files.length === 0 || entry.failed !== undefined
}

async function main (argv: string[]): Promise<number> {
  const options = parseFetchArgs(argv)
  if (typeof options === 'string') {
    console.error(`${options}\n${USAGE}`)
    return 2
  }
  const root = resolve(options.root)
  if (insideRepository(root)) {
    console.error(`${root} is inside the repository; the references stay outside it`)
    return 2
  }
  mkdirSync(root, { recursive: true })
  const entries: Entry[] = []
  const before = previous(root)
  for (const ref of REFERENCES) {
    const entry = await reference(root, ref, before.find(known => known.id === ref.id))
    entries.push(entry)
    const notes = [entry.failed, entry.skipped.length > 0 ? `${entry.skipped.length} skipped` : undefined]
    console.log(`${ref.id}: ${entry.files.length} files (${entry.obtained})` +
      notes.filter(note => note !== undefined).map(note => `; ${note}`).join(''))
  }
  if (options.lpc !== undefined) entries.push(lpc(root, resolve(options.lpc)))
  writeFileSync(join(root, 'manifest.json'), `${JSON.stringify(entries, null, 2)}\n`)
  return entries.some(problem) ? 1 : 0
}

process.exitCode = await main(process.argv.slice(2))
