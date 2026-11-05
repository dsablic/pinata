import { join, resolve } from 'node:path'
import { TEMPLATE_NAMES } from '../formats/templates.ts'
import { checkUsage, runCheck } from './check.ts'
import { exportUsage, runExport } from './export.ts'
import type { Invoke, Io } from './io.ts'
import { newUsage, runNew } from './new.ts'
import { renderUsage, runRender } from './render.ts'
import { reviewUsage, runReview } from './review.ts'
import { runSkin, skinUsage } from './skin.ts'

export type Args = Record<string, unknown>
type Property = { type: 'string' | 'number' | 'boolean', description?: string, enum?: string[] }
type Schema = {
  type: 'object'
  properties: Record<string, Property>
  required: string[]
  additionalProperties: false
}
export type Command = {
  name: string
  summary: string
  description: string
  schema: Schema
  argv: (args: Args) => string[] | string
  output: (args: Args) => string | undefined
  usage: (invoke: Invoke) => string
  run: (argv: string[], io: Io, invoke: Invoke) => number | Promise<number>
}

const PATHS = 'relative paths resolve against the server\'s working directory'
const DIR: Property = {
  type: 'string', description: `the character directory (holds character.json and the other files); ${PATHS}`
}
const OUT: Property = { type: 'string', description: `the directory to write into (created if missing); ${PATHS}` }

function text (args: Args, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function required (args: Args, keys: string[]): string | undefined {
  const missing = keys.filter(key => text(args, key) === undefined)
  return missing.length === 0 ? undefined : `missing argument${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`
}

function flag (args: Args, key: string, flagName: string): string[] | string {
  const value = args[key]
  if (value === undefined) return []
  return typeof value === 'number' && Number.isFinite(value) ? [flagName, String(value)] : `${key} must be a number`
}

function fitArgv (args: Args, dir: string): string[] | string {
  const flags = [flag(args, 'scale', '--scale'), flag(args, 'pixelsPerMetre', '--pixels-per-metre')]
  const bad = flags.find(value => typeof value === 'string')
  if (bad !== undefined) return bad as string
  const skin = text(args, 'skin')
  return ['fit', dir, ...(skin === undefined ? [] : [skin]), ...flags.flat()]
}

function skinArgv (args: Args): string[] | string {
  const missing = required(args, ['action', 'dir'])
  if (missing !== undefined) return missing
  const [action, dir] = [text(args, 'action') as string, text(args, 'dir') as string]
  if (action === 'fit') return fitArgv(args, dir)
  const noOut = required(args, ['out'])
  if (noOut !== undefined) return noOut
  const out = text(args, 'out') as string
  if (action === 'guide') return ['guide', dir, out]
  if (action === 'preview') {
    const skin = text(args, 'skin') ?? join(dir, 'skin.json')
    return ['preview', dir, skin, out, ...(args.clean === true ? ['--clean'] : [])]
  }
  return `unknown action '${action}'; use guide, preview or fit`
}

function pair (args: Args, keys: string[]): string[] | string {
  return required(args, keys) ?? keys.map(key => text(args, key) as string)
}

export const COMMANDS: Command[] = [
  {
    name: 'new',
    summary: 'write a starter character from a template',
    description: 'Write a starter character package (biped, quadruped, hexapod or octopod) into a new directory.',
    schema: {
      type: 'object',
      properties: {
        template: { type: 'string', enum: [...TEMPLATE_NAMES] },
        dir: { ...DIR, description: 'a new or empty directory' }
      },
      required: ['template', 'dir'],
      additionalProperties: false
    },
    argv: args => required(args, ['template', 'dir']) ??
      ['--template', text(args, 'template') as string, text(args, 'dir') as string],
    output: args => text(args, 'dir'),
    usage: newUsage,
    run: runNew
  },
  {
    name: 'check',
    summary: 'run the gates on a character and write a report with hints',
    description: 'Run the static, locomotion and cloth gates on a character package. Failed gates carry hints ' +
      'naming the file to fix. Writes summary.txt, metrics.json and stills (sheet, walk, footprints, cloth).',
    schema: {
      type: 'object',
      properties: { dir: DIR, out: { ...OUT, description: `the report directory (default: <dir>/report); ${PATHS}` } },
      required: ['dir'],
      additionalProperties: false
    },
    argv: args => required(args, ['dir']) ??
      [text(args, 'dir') as string, ...(text(args, 'out') === undefined ? [] : ['--out', text(args, 'out') as string])],
    output: args => resolve(text(args, 'out') ?? join(text(args, 'dir') ?? '.', 'report')),
    usage: checkUsage,
    run: runCheck
  },
  {
    name: 'skin',
    summary: 'draw guides, preview and fit-check skins',
    description: 'Skin tools. action guide: per-view drawing guide (needs out). action preview: render the skin in ' +
      'eight directions, a turntable and walks, and idle-directions.png, the eight idle frames labelled (needs ' +
      'out; skin defaults to <dir>/skin.json). action fit: list part ' +
      'views whose drawn length is off (prints only).',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['guide', 'preview', 'fit'] },
        dir: DIR,
        out: OUT,
        skin: { type: 'string', description: 'a skin file (default: <dir>/skin.json)' },
        clean: { type: 'boolean', description: 'preview with clean rotation' },
        scale: { type: 'number', description: 'fit: the page scale' },
        pixelsPerMetre: { type: 'number', description: 'fit: pixels per metre on the page' }
      },
      required: ['action', 'dir'],
      additionalProperties: false
    },
    argv: skinArgv,
    output: args => text(args, 'action') === 'fit' ? undefined : text(args, 'out'),
    usage: skinUsage,
    run: runSkin
  },
  {
    name: 'render',
    summary: 'render the skinned idle in eight directions and walk, crouch and attack strips',
    description: 'Draw a skinned character with motion capture: its idle in eight directions and strips of its ' +
      'walk, crouch and attack. Writes idle-directions.png, walk-strip.png, crouch-strip.png and attack-strip.png.',
    schema: {
      type: 'object', properties: { dir: DIR, out: OUT }, required: ['dir', 'out'], additionalProperties: false
    },
    argv: args => pair(args, ['dir', 'out']),
    output: args => text(args, 'out'),
    usage: renderUsage,
    run: runRender
  },
  {
    name: 'export',
    summary: 'record every animation in eight directions and write a sprite sheet per animation',
    description: 'Record idle, walk, run, turn, jump, crouch and attack in eight directions, write for each ' +
      'animation a sprite sheet PNG, an Aseprite-format JSON and an .aseprite file, and print the export gates. ' +
      'Engine notes do not fail the command.',
    schema: {
      type: 'object',
      properties: { dir: DIR, out: OUT, full: { type: 'boolean', description: 'list every track, not counts' } },
      required: ['dir', 'out'],
      additionalProperties: false
    },
    argv: args => {
      const paths = pair(args, ['dir', 'out'])
      return typeof paths === 'string' || args.full !== true ? paths : [...paths, '--full']
    },
    output: args => text(args, 'out'),
    usage: exportUsage,
    run: runExport
  },
  {
    name: 'review',
    summary: 'ask blind AI judges which way each idle frame faces (costs money)',
    description: 'Run the blind direction panel on the character: three judges (the claude CLI on opus, sonnet and ' +
      'haiku) name the direction of each of the eight idle frames, and optionally of the widest-stride walk frame ' +
      'in each direction. Prints the share right, each misread direction with what it was named, and the cue to ' +
      'draw. It costs money (the cost of every judge is printed, also when one fails) and takes minutes: run ' +
      'check and skin preview first. Exit status 0 every gate met, 1 a gate missed, 2 refused, 3 a judge failed so ' +
      'no score is given. Needs the claude CLI. Writes the panel and key to <dir>/report/review.',
    schema: {
      type: 'object',
      properties: {
        dir: DIR,
        walk: { type: 'boolean', description: 'also judge the walk frames (about doubles the cost)' },
        out: { ...OUT, description: `the panel directory (default: <dir>/report/review); ${PATHS}` }
      },
      required: ['dir'],
      additionalProperties: false
    },
    argv: args => required(args, ['dir']) ?? [
      text(args, 'dir') as string,
      ...(args.walk === true ? ['--walk'] : []),
      ...(text(args, 'out') === undefined ? [] : ['--out', text(args, 'out') as string])
    ],
    output: args => resolve(text(args, 'out') ?? join(text(args, 'dir') ?? '.', 'report', 'review')),
    usage: reviewUsage,
    run: (argv, io, invoke) => runReview(argv, io, invoke)
  }
]

export function invalidArguments (command: Command, args: Args): string | undefined {
  const { properties } = command.schema
  for (const [key, value] of Object.entries(args)) {
    const property = properties[key]
    if (property === undefined) return `unknown argument '${key}'; arguments: ${Object.keys(properties).join(', ')}`
    if (typeof value !== property.type) return `argument '${key}' must be a ${property.type}, not ${typeof value}`
    if (property.enum !== undefined && !property.enum.includes(value as string)) {
      return `argument '${key}' must be one of ${property.enum.join(', ')}`
    }
  }
  return undefined
}

export function commandNamed (name: string): Command | undefined {
  return COMMANDS.find(command => command.name === name)
}

export function helpText (invoke: Invoke = c => `pinata ${c}`): string {
  const width = Math.max(...COMMANDS.map(command => command.name.length), 'mcp'.length)
  const listed = [...COMMANDS, { name: 'mcp', summary: 'serve the commands as MCP tools over stdio' }]
  const lines = listed.map(c => `  ${c.name.padEnd(width)}  ${c.summary}`)
  const usages = COMMANDS.map(command => command.usage(invoke).replace(/^usage: /, '  ').replace(/\n {7}/g, '\n  '))
  return ['usage: pinata <command> [arguments]', '', 'commands:', ...lines, '', 'arguments:', ...usages].join('\n')
}
