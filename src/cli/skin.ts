import { consoleIo } from '../tool/io.ts'
import { runSkin } from '../tool/skin.ts'

process.exitCode = runSkin(process.argv.slice(2), consoleIo, () => 'node src/cli/skin.ts')
