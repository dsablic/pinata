import { join, resolve } from 'node:path'
import { writeOutput } from '../diagnostics/report.ts'
import { record } from '../export/record.ts'
import { checksOf, failedGates, reportOf } from '../export/report.ts'
import { exportFiles } from '../export/files.ts'
import { messageOf } from './io.ts'
import type { Invoke, Io } from './io.ts'
import { subjectFor } from './subject.ts'

export const exportUsage = (invoke: Invoke): string => {
  return `usage: ${invoke('export')} <character dir> <out dir> [--full]`
}

export function runExport (argv: string[], io: Io, invoke: Invoke): number {
  const full = argv.includes('--full')
  const [dir, out] = argv.filter(arg => arg !== '--full')
  if (dir === undefined || out === undefined || argv.length !== (full ? 3 : 2)) {
    io.err(exportUsage(invoke))
    return 2
  }
  try {
    const recording = record(subjectFor(dir))
    const files = Object.entries(exportFiles(recording))
    for (const [file, contents] of files) writeOutput(join(resolve(out), file), contents)
    if (full) for (const [file] of files) io.out(`wrote ${join(resolve(out), file)}`)
    else io.out(`wrote ${files.length} files into ${resolve(out)}`)
    const checks = checksOf(recording)
    io.out(reportOf(recording.name, checks, full))
    return failedGates(checks).length === 0 ? 0 : 1
  } catch (err) {
    io.err(`could not export '${dir}': ${messageOf(err)}`)
    return 2
  }
}
