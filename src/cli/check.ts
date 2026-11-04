import { consoleIo, npmInvoke } from '../tool/io.ts'
import { runCheck } from '../tool/check.ts'

process.exitCode = runCheck(process.argv.slice(2), consoleIo, npmInvoke)
