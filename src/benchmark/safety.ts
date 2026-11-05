import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export type FetchOptions = { root: string, lpc?: string }

const REPOSITORY = resolve(import.meta.dirname, '..', '..')

export function safeName (name: string, folder: string): string {
  const cleaned = name.replace(/[^\w. -]/g, '_').trim()
  const target = resolve(folder, cleaned)
  if (cleaned === '' || /^\.+$/.test(cleaned) || relative(resolve(folder), target) !== cleaned) {
    throw new Error(`${JSON.stringify(name)} is not a safe file name`)
  }
  return target
}

function realPath (path: string): string {
  let existing = resolve(path)
  const rest: string[] = []
  while (!existsSync(existing)) {
    rest.unshift(basename(existing))
    existing = dirname(existing)
  }
  return join(realpathSync(existing), ...rest)
}

export function insideRepository (path: string, repository = REPOSITORY): boolean {
  const rel = relative(realpathSync(repository), realPath(path))
  return rel === '' || !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
}

export function parseFetchArgs (argv: string[]): FetchOptions | string {
  const positional: string[] = []
  let lpc: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--lpc') {
      const value = argv[++i]
      if (lpc !== undefined) return '--lpc is given twice'
      if (value === undefined || value.startsWith('--')) return '--lpc needs a folder'
      lpc = value
    } else if (arg.startsWith('--')) return `unknown option ${arg}`
    else positional.push(arg)
  }
  if (positional.length !== 1) return 'expected exactly one folder for the references'
  return { root: positional[0], ...(lpc === undefined ? {} : { lpc }) }
}
