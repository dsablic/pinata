import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { starterPackage } from '../formats/starter.ts'
import { isTemplateName, listTemplates, TEMPLATE_NAMES } from '../formats/templates.ts'
import type { TemplateName } from '../formats/templates.ts'
import { messageOf } from './io.ts'
import type { Invoke, Io } from './io.ts'

export const newUsage = (invoke: Invoke): string =>
  `usage: ${invoke('new')} --template <${TEMPLATE_NAMES.join('|')}> <dir>`

type Args = { template: TemplateName, dir: string }

function parseArgs (argv: string[], usage: string): Args | string {
  const positional: string[] = []
  let template: string | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--template') {
      if (template !== undefined) return `--template given twice\n${usage}`
      template = argv[++i]
      if (template === undefined) return `--template needs a name\n${usage}`
    } else if (argv[i].startsWith('-')) return `unknown option '${argv[i]}'\n${usage}`
    else positional.push(argv[i])
  }
  if (template === undefined || positional.length !== 1) return usage
  if (!isTemplateName(template)) {
    const names = listTemplates().map(t => `  ${t.name}: ${t.description}`).join('\n')
    return `unknown template '${template}'; choose one of:\n${names}`
  }
  return { template, dir: resolve(positional[0]) }
}

function isEmptyOrMissing (dir: string): boolean {
  try {
    return statSync(dir).isDirectory() && readdirSync(dir).length === 0
  } catch {
    return true
  }
}

export function runNew (argv: string[], io: Io, invoke: Invoke): number {
  const args = parseArgs(argv, newUsage(invoke))
  if (typeof args === 'string') {
    io.err(args)
    return 2
  }
  if (!isEmptyOrMissing(args.dir)) {
    io.err(`'${args.dir}' already exists and is not an empty directory; choose a new directory`)
    return 2
  }
  try {
    mkdirSync(args.dir, { recursive: true })
    for (const [name, value] of Object.entries(starterPackage(args.template))) {
      writeFileSync(join(args.dir, name), `${JSON.stringify(value, null, 2)}\n`)
    }
  } catch (err) {
    io.err(`could not write the starter to '${args.dir}': ${messageOf(err)}`)
    return 2
  }
  io.out(`wrote the ${args.template} starter to ${args.dir}; check it with: ${invoke('check')} ${args.dir}`)
  return 0
}
