import { join, resolve } from 'node:path'
import { writeOutput } from '../diagnostics/report.ts'
import { record } from '../export/record.ts'
import { checksOf, failedGates, reportOf } from '../export/report.ts'
import { exportFiles } from '../export/sheet.ts'
import { messageOf } from './io.ts'
import type { Invoke, Io } from './io.ts'
import { subjectFor } from './subject.ts'

export const exportUsage = (invoke: Invoke): string => `usage: ${invoke('export')} <character dir> <out dir>`

export function runExport (argv: string[], io: Io, invoke: Invoke): number {
  const [dir, out] = argv
  if (dir === undefined || out === undefined || argv.length !== 2) {
    io.err(exportUsage(invoke))
    return 2
  }
  try {
    const recording = record(subjectFor(dir))
    for (const [file, contents] of Object.entries(exportFiles(recording))) {
      writeOutput(join(resolve(out), file), contents)
      io.out(`wrote ${join(resolve(out), file)}`)
    }
    const checks = checksOf(recording)
    io.out(reportOf(recording.name, checks))
    return failedGates(checks).length === 0 ? 0 : 1
  } catch (err) {
    io.err(`could not export '${dir}': ${messageOf(err)}`)
    return 2
  }
}
