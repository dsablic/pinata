import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { starterPackage } from '../formats/starter.ts'
import { isTemplateName, listTemplates, TEMPLATE_NAMES } from '../formats/templates.ts'
import type { TemplateName } from '../formats/templates.ts'

const USAGE = `usage: npm run new -- --template <${TEMPLATE_NAMES.join('|')}> <dir>`

type Args = { template: TemplateName, dir: string }

function parseArgs (argv: string[]): Args | string {
  const positional: string[] = []
  let template: string | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--template') {
      template = argv[++i]
      if (template === undefined) return `--template needs a name\n${USAGE}`
    } else if (argv[i].startsWith('--')) return `unknown option '${argv[i]}'\n${USAGE}`
    else positional.push(argv[i])
  }
  if (template === undefined || positional.length !== 1) return USAGE
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

function main (): number {
  const args = parseArgs(process.argv.slice(2))
  if (typeof args === 'string') {
    console.error(args)
    return 2
  }
  if (!isEmptyOrMissing(args.dir)) {
    console.error(`'${args.dir}' already exists and is not an empty directory; choose a new directory`)
    return 2
  }
  mkdirSync(args.dir, { recursive: true })
  for (const [name, value] of Object.entries(starterPackage(args.template))) {
    writeFileSync(join(args.dir, name), `${JSON.stringify(value, null, 2)}\n`)
  }
  console.log(`wrote the ${args.template} starter to ${args.dir}; check it with: npm run check -- ${args.dir}`)
  return 0
}

process.exitCode = main()
