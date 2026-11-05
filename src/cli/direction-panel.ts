import { join, resolve } from 'node:path'
import { readWorld } from '../diagnostics/page-scenarios.ts'
import { directionBase, directionItems } from '../export/direction-panel.ts'
import { record, SKINNED_HUMANOIDS, subjectOf } from '../export/record.ts'
import { subjectFor } from '../tool/subject.ts'
import { writeChoicePanel } from './choice-panel.ts'
import type { PanelItem } from './choice-panel.ts'
import { ROOT } from './paths.ts'
import { worldBundle } from './world-bundle.ts'

const USAGE = 'usage: npm run direction-panel [-- [--seed <seed>] [--out <dir>] [<name>=<character dir>...]]\n' +
  '       without characters the four examples are the panel'

type Options = { seed: string, out: string, characters: [string, string][] }

function splitCharacter (argument: string): [string, string] {
  const at = argument.indexOf('=')
  return [argument.slice(0, at), argument.slice(at + 1)]
}

function parse (argv: string[]): Options | undefined {
  const options: Options = { seed: 'facing-2', out: join(ROOT, 'reports', 'export-panel'), characters: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seed' && argv[i + 1] !== undefined) options.seed = argv[++i]
    else if (argv[i] === '--out' && argv[i + 1] !== undefined) options.out = resolve(argv[++i])
    else if (/^[^=-][^=]*=./.test(argv[i])) options.characters.push(splitCharacter(argv[i]))
    else return undefined
  }
  return options
}

function exampleItems (): PanelItem[] {
  const world = readWorld(worldBundle(join(ROOT, 'examples'), { only: SKINNED_HUMANOIDS }))
  return SKINNED_HUMANOIDS.flatMap(name => {
    return directionItems(record(subjectOf(world, name), ['idle', 'walk']), `${name}-`)
  })
}

function characterItems (characters: [string, string][]): PanelItem[] {
  return characters.flatMap(([name, dir]) => {
    return directionItems(record(subjectFor(dir), ['idle', 'walk']), `${name}-`)
  })
}

const options = parse(process.argv.slice(2))
if (options === undefined) {
  console.error(USAGE)
  process.exit(2)
}
const items = options.characters.length === 0 ? exampleItems() : characterItems(options.characters)
console.log(writeChoicePanel(options.out, directionBase('Facing of exported frames', options.seed), items))
