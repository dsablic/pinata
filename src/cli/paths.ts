import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

function packageRoot (from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir
    if (dirname(dir) === dir) return from
  }
}

export const ROOT = packageRoot(resolve(import.meta.dirname))
