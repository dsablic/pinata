import { consoleIo, npmInvoke } from '../tool/io.ts'
import { runExport } from '../tool/export.ts'

process.exitCode = runExport(process.argv.slice(2), consoleIo, npmInvoke)
