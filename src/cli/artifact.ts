import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { writeOutput } from '../diagnostics/report.ts'
import { formatErrors } from '../formats/validate.ts'
import { readArtifact } from '../runtime/artifact.ts'
import type { Artifact } from '../runtime/artifact.ts'

const USAGE = 'usage: npm run artifact -- <character dir> <out.json>'

function read (dir: string, file: string): unknown {
  return JSON.parse(readFileSync(join(dir, file), 'utf8'))
}

function main (): number {
  const [dir, out] = process.argv.slice(2)
  if (dir === undefined || out === undefined) {
    console.error(USAGE)
    return 2
  }
  const manifest = read(dir, 'character.json') as { name?: string, description?: string, [file: string]: unknown }
  const file = (key: string, fallback: string): string => typeof manifest[key] === 'string' ? manifest[key] : fallback
  const artifact: Artifact = {
    format: 'pinata-live',
    version: 1,
    name: manifest.name ?? 'character',
    ...(manifest.description === undefined ? {} : { description: manifest.description }),
    mannequin: read(dir, file('mannequin', 'mannequin.json')),
    style: read(dir, file('style', 'style.json')),
    rig: read(dir, file('rig', 'rig.json')),
    behaviours: read(dir, 'behaviours.json')
  }
  const checked = readArtifact(artifact)
  if (checked.errors.length > 0) {
    console.error(formatErrors(resolve(dir), checked.errors))
    return 2
  }
  const text = JSON.stringify(artifact)
  writeOutput(out, text)
  console.log(`wrote ${out}: ${(text.length / 1024).toFixed(1)} KiB`)
  return 0
}

process.exitCode = main()
