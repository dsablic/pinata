import { consoleIo, npmInvoke } from '../tool/io.ts'
import { runNew } from '../tool/new.ts'

process.exitCode = runNew(process.argv.slice(2), consoleIo, npmInvoke)
