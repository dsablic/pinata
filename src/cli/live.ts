import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { formatCharacterErrors, loadCharacter } from '../formats/character.ts'
import type { Image } from '../image.ts'
import { encodePng } from '../png/encode.ts'
import { validateBehaviours } from '../runtime/behaviours.ts'
import { createLive } from '../runtime/character.ts'
import { createView, DEFAULT_VIEW } from '../runtime/render.ts'
import { ROOT } from './paths.ts'

const USAGE = 'usage: node src/cli/live.ts [--character <dir>] [--events <file>] [--start <event>] ' +
  '[--format png|cells] [--px <n>] [--fps <n>] [--samples <n>] [--frames <n>]'
const UPPER_HALF = 0x2580
const LOWER_HALF = 0x2584
const SPACE = 0x20
const DEFAULT_COLOR = 0x01000000
const OPAQUE = 128

export type Format = 'png' | 'cells'
export type LiveArgs = {
  character: string
  events: string | undefined
  start: string | undefined
  format: Format
  px: number
  fps: number
  samples: number
  frames: number
}

function wholeNumber (value: string | undefined, min: number, max: number): number | undefined {
  const n = Number(value)
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined
}

export function parseArgs (argv: string[]): LiveArgs | string {
  const args: LiveArgs = {
    character: join(ROOT, 'examples', 'unicorn'),
    events: undefined,
    start: undefined,
    format: 'png',
    px: 64,
    fps: 15,
    samples: 2,
    frames: 0
  }
  const numbers: Record<string, [keyof LiveArgs, number, number]> = {
    '--px': ['px', 8, 128], '--fps': ['fps', 1, 60], '--samples': ['samples', 1, 4], '--frames': ['frames', 0, 1e9]
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[++i]
    if (flag === '--character' && value !== undefined) args.character = resolve(value)
    else if (flag === '--events' && value !== undefined) args.events = resolve(value)
    else if (flag === '--start' && value !== undefined) args.start = value
    else if (flag === '--format' && (value === 'png' || value === 'cells')) args.format = value
    else if (flag in numbers) {
      const [key, min, max] = numbers[flag]
      const n = wholeNumber(value, min, max)
      if (n === undefined) return `${flag} needs a whole number from ${min} to ${max}\n${USAGE}`
      Object.assign(args, { [key]: n })
    } else return `bad option '${flag}'\n${USAGE}`
  }
  return args
}

export function toCells (img: Image): { columns: number, rows: number, cells: Buffer } {
  const columns = img.width
  const rows = Math.ceil(img.height / 2)
  const words = new Uint32Array(columns * rows * 3)
  const color = (x: number, y: number): number => {
    if (y >= img.height) return DEFAULT_COLOR
    const i = (y * img.width + x) * 4
    if (img.data[i + 3] < OPAQUE) return DEFAULT_COLOR
    return (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]
  }
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < columns; x++) {
      const top = color(x, 2 * r)
      const bottom = color(x, 2 * r + 1)
      const at = (r * columns + x) * 3
      if (top === DEFAULT_COLOR && bottom === DEFAULT_COLOR) words.set([SPACE, DEFAULT_COLOR, DEFAULT_COLOR], at)
      else if (top === DEFAULT_COLOR) words.set([LOWER_HALF, bottom, DEFAULT_COLOR], at)
      else words.set([UPPER_HALF, top, bottom], at)
    }
  }
  const bytes = Buffer.from(words.buffer)
  if (!isLittleEndian()) bytes.swap32()
  return { columns, rows, cells: bytes }
}

function isLittleEndian (): boolean {
  return new Uint8Array(Uint32Array.of(1).buffer)[0] === 1
}

export function readEvents (path: string, seen: number): Array<{ seq: number, name: string }> {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const events: Array<{ seq: number, name: string }> = []
  for (const line of text.split('\n').slice(0, -1)) {
    const [seq, name] = line.trim().split(/\s+/)
    const n = Number(seq)
    if (Number.isInteger(n) && n > seen && name !== undefined) events.push({ seq: n, name })
  }
  return events.sort((a, b) => a.seq - b.seq)
}

export function frameLine (format: Format, behaviour: string, image: Image): Record<string, string | number> {
  if (format === 'png') {
    return { behaviour, width: image.width, height: image.height, png: encodePng(image).toString('base64') }
  }
  const { columns, rows, cells } = toCells(image)
  return { behaviour, columns, rows, cells: cells.toString('base64') }
}

function main (): void {
  const args = parseArgs(process.argv.slice(2))
  if (typeof args === 'string') {
    console.error(args)
    process.exit(2)
  }
  const character = loadCharacter(args.character)
  if (character.value === undefined) {
    console.error(formatCharacterErrors(character.errors))
    process.exit(1)
  }
  const behaviours = validateBehaviours(JSON.parse(readFileSync(join(args.character, 'behaviours.json'), 'utf8')))
  if (behaviours.value === undefined) {
    console.error(behaviours.errors.map(e => `${e.path}: ${e.message}`).join('\n'))
    process.exit(1)
  }
  const live = createLive(character.value, behaviours.value, {
    fps: args.fps, substeps: 8, reduced: false, anchor: [0, 2, 0], gravity: 9.81, wind: [0, 0, 0]
  })
  if (args.start !== undefined) live.dispatch(args.start)
  const scale = args.px / DEFAULT_VIEW.characterPx
  const view = createView(character.value, {
    ...DEFAULT_VIEW,
    characterPx: args.px,
    width: Math.round(DEFAULT_VIEW.width * scale),
    height: Math.round(DEFAULT_VIEW.height * scale),
    anchorAt: [Math.round(DEFAULT_VIEW.anchorAt[0] * scale), Math.max(1, Math.round(DEFAULT_VIEW.anchorAt[1] * scale))],
    samples: args.samples
  })
  const parent = process.ppid
  let seen = args.events === undefined ? 0 : readEvents(args.events, 0).reduce((max, e) => Math.max(max, e.seq), 0)
  let count = 0
  let isBlocked = false
  process.stdout.on('error', () => process.exit(0))
  process.stdout.on('drain', () => { isBlocked = false })
  const tick = (): void => {
    if (process.ppid !== parent) process.exit(0)
    if (args.events !== undefined) {
      for (const event of readEvents(args.events, seen)) {
        seen = event.seq
        if (event.name === 'quit') process.exit(0)
        if (event.name === 'hit') live.hit()
        else live.dispatch(event.name)
      }
    }
    const frame = live.step()
    const image = view.render(frame)
    count++
    if (!isBlocked) {
      isBlocked = !process.stdout.write(JSON.stringify(frameLine(args.format, frame.behaviour, image)) + '\n')
    }
    if (args.frames > 0 && count >= args.frames) {
      clearInterval(timer)
      process.stdout.end()
    }
  }
  const timer = setInterval(tick, 1000 / args.fps)
}

if (import.meta.main) main()
