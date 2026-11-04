import { basename, join, resolve } from 'node:path'
import { writeOutput } from '../diagnostics/report.ts'
import { readWorld } from '../diagnostics/page-scenarios.ts'
import { checksOf, reportOf } from '../export/report.ts'
import { record, subjectOf } from '../export/record.ts'
import { exportFiles } from '../export/sheet.ts'
import { worldBundle } from './world-bundle.ts'

const USAGE = 'usage: npm run export -- <character dir> <out dir>'

function main (): number {
  const [dir, out] = process.argv.slice(2)
  if (dir === undefined || out === undefined) {
    console.error(USAGE)
    return 2
  }
  const character = resolve(dir)
  const name = basename(character)
  const world = readWorld(worldBundle(resolve(character, '..'), { only: [name] }))
  const recording = record(subjectOf(world, name))
  for (const [file, contents] of Object.entries(exportFiles(recording))) {
    writeOutput(join(resolve(out), file), contents)
    console.log(`wrote ${join(resolve(out), file)}`)
  }
  console.log(reportOf(recording))
  return checksOf(recording).every(check => !check.measured || check.pass) ? 0 : 1
}

process.exitCode = main()
