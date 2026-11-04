#!/usr/bin/env node
import { COMMANDS, commandNamed, helpText } from '../tool/commands.ts'
import { consoleIo, pinataInvoke } from '../tool/io.ts'
import { claimStdout, serve } from '../tool/mcp.ts'

async function main (argv: string[]): Promise<number> {
  const [name, ...rest] = argv
  if (name === undefined || name === 'help' || name === '--help' || name === '-h') {
    console.log(helpText())
    return 0
  }
  if (name === 'mcp') {
    await serve(process.stdin, claimStdout(), console.error)
    return 0
  }
  const command = commandNamed(name)
  if (command === undefined) {
    console.error(`unknown command '${name}'; commands: ${COMMANDS.map(c => c.name).join(', ')}, mcp, help\n`)
    console.error(helpText())
    return 2
  }
  return command.run(rest, consoleIo, pinataInvoke)
}

process.exitCode = await main(process.argv.slice(2))
