import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatErrors } from '../src/formats/validate.ts'
import type { Validated } from '../src/formats/validate.ts'
import { writeOutput } from '../src/diagnostics/report.ts'

type Fail = (message: string) => never

export type JsonReaders = {
  loadJson: (file: string) => unknown
  requireValid: <T> (file: string, result: Validated<T>) => T
}

export type GatedRun = JsonReaders & {
  here: string
  outDir: string
  hashesMode: boolean
  verify: boolean
  fail: Fail
}

const CHILD_MAX_BUFFER = 64 * 1024 * 1024

export function jsonReaders (fail: Fail, base?: string): JsonReaders {
  return {
    loadJson: (file) => {
      try {
        return JSON.parse(readFileSync(base === undefined ? file : join(base, file), 'utf8'))
      } catch (err) {
        if (err instanceof SyntaxError) fail(`${file}: invalid JSON: ${err.message}`)
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') fail(`${file}: file not found`)
        throw err
      }
    },
    requireValid: (file, result) => {
      if (result.value === undefined || result.errors.length > 0) fail(formatErrors(file, result.errors))
      return result.value
    }
  }
}

export function startGatedRun (moduleUrl: string, report: string): GatedRun {
  const here = dirname(fileURLToPath(moduleUrl))
  const outDir = join(here, '..', '..', 'reports', report)
  const hashesMode = process.argv.includes('--hashes')
  const verify = process.argv.includes('--verify')
  if (!hashesMode) rmSync(outDir, { recursive: true, force: true })
  function fail (message: string): never {
    console.error(message)
    if (!hashesMode) writeOutput(join(outDir, 'summary.txt'), `automated gates: ERROR\n${message}\n`)
    process.exit(2)
  }
  process.on('uncaughtException', err => {
    try {
      fail(err instanceof Error ? (err.stack ?? err.message) : String(err))
    } catch {
      process.exit(2)
    }
  })
  return { here, outDir, hashesMode, verify, fail, ...jsonReaders(fail, here) }
}

export function childHashes (moduleUrl: string, timeoutMs: number): Map<string, string> {
  const output = execFileSync(process.execPath, [fileURLToPath(moduleUrl), '--hashes'], {
    encoding: 'utf8', timeout: timeoutMs, maxBuffer: CHILD_MAX_BUFFER
  })
  return new Map(output.split('\n').filter(l => l !== '').map(l => l.split(' ') as [string, string]))
}

export function nonFiniteAsText (_key: string, value: unknown): unknown {
  return typeof value === 'number' && !Number.isFinite(value) ? String(value) : value
}
