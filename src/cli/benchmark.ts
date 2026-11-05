import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { writeOutput } from '../diagnostics/report.ts'
import { filledImage } from '../diagnostics/draw.ts'
import { upscale, getPixel, parseHex, setPixel, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import { formatRubricScore, isRubricKey, rubricProblems, scoreRubric, usableAnswers } from '../judge/rubric.ts'
import { encodePng } from '../png/encode.ts'
import {
  ANTICIPATION, CONTROLS, degradedCopies, ENVIRONMENT, FLUIDITY, FROZEN, pinataClips, references
} from '../benchmark/library.ts'
import type { Entry } from '../benchmark/library.ts'
import { encodeGif } from '../benchmark/gif.ts'
import { grid } from '../benchmark/frames.ts'
import { failed, formatValidation, SEPARATOR, validate } from '../benchmark/gate.ts'

const USAGE = 'usage: npm run benchmark -- build <raw folder> <pinata exports folder> <out folder>\n' +
  '       npm run benchmark -- gate <key.json> <judge answers.json>...\n' +
  'exit codes: 0 done, and for gate every dimension kept and the controls stable; 1 for gate a dimension was ' +
  'dropped or the controls are unstable; 2 bad arguments or unreadable or invalid files'
const BACKGROUND = '#c8c8c8'
const GIF_SCALE = 4
const PER_ROW = 4
const STRIP_GAP = 1
const CENTISECONDS = 100

function flattened (image: Image, background: number): Image {
  const out = filledImage(image.width, image.height, background)
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const rgb = getPixel(image, x, y)
      if (rgb !== TRANSPARENT) setPixel(out, x, y, rgb)
    }
  }
  return out
}

function writeClip (out: string, { set, clip }: Entry): string {
  const dir = join(out, set, clip.name)
  clip.frames.forEach((frame, i) => writeOutput(join(dir, `frame-${String(i).padStart(2, '0')}.png`), encodePng(frame)))
  const strip = join(out, 'strips', `${set}-${clip.name}.png`)
  writeOutput(strip, encodePng(grid(clip.frames, PER_ROW, STRIP_GAP)))
  const background = parseHex(BACKGROUND)
  const scaled = clip.frames.map(frame => flattened(upscale(frame, GIF_SCALE), background))
  const gif = join(out, 'gifs', `${set}-${clip.name}.gif`)
  writeOutput(gif, encodeGif(scaled, Math.round(CENTISECONDS / clip.fps), background))
  return `${set}/${clip.name}: ${clip.frames.length} frames at ${clip.fps.toFixed(1)} fps`
}

function pairs (): { id: string, a: string, b: string, control?: true }[] {
  const strip = (set: string, name: string): string => `../strips/${set}-${name}.png`
  const degraded = (names: string[], dimension: string): { id: string, a: string, b: string }[] => {
    return names.map(name => ({
      id: `${dimension}${SEPARATOR}${name}`,
      a: strip('reference', name),
      b: strip('degraded', `${dimension}${SEPARATOR}${name}`)
    }))
  }
  return [
    ...degraded(FLUIDITY, 'fluidity'),
    ...degraded(ENVIRONMENT, 'environment'),
    ...degraded(ANTICIPATION, 'anticipation'),
    ...degraded(FROZEN, 'secondary'),
    ...CONTROLS.map(name => ({
      id: `control${SEPARATOR}${name}`, a: strip('reference', name), b: strip('reference', name), control: true as const
    }))
  ]
}

function build (raw: string, exported: string, out: string): number {
  const refs = references(raw)
  const entries: Entry[] = [
    ...refs.map((clip): Entry => ({ set: 'reference', clip })),
    ...pinataClips(exported).map((clip): Entry => ({ set: 'pinata', clip })),
    ...degradedCopies(refs, raw)
  ]
  mkdirSync(out, { recursive: true })
  for (const entry of entries) console.log(writeClip(out, entry))
  const panel = { kind: 'rubric', name: 'Motion craft round', seed: 'rubric-1', gap: 10, items: pairs() }
  writeOutput(join(out, 'validation', 'panel.json'), `${JSON.stringify(panel, null, 2)}\n`)
  return 0
}

function readJson (path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function gate (keyPath: string, answerPaths: string[]): number {
  const key = readJson(keyPath)
  if (!isRubricKey(key)) throw new Error(`${keyPath}: not a rubric key`)
  const judges = answerPaths.map(path => {
    const answers = readJson(path)
    const problems = rubricProblems(answers, key)
    if (problems.length > 0) console.error(`${path}: counted as wrong where invalid:\n  ${problems.join('\n  ')}`)
    return usableAnswers(answers, key)
  })
  const score = scoreRubric(key, judges)
  const result = validate(score)
  console.log(formatRubricScore(key, score))
  console.log(formatValidation(result))
  return failed(result) ? 1 : 0
}

function main (argv: string[]): number {
  const [command, ...args] = argv
  if (command === 'build' && args.length === 3) return build(resolve(args[0]), resolve(args[1]), resolve(args[2]))
  if (command === 'gate' && args.length >= 2) return gate(resolve(args[0]), args.slice(1).map(p => resolve(p)))
  console.error(USAGE)
  return 2
}

function run (argv: string[]): number {
  try {
    return main(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    return 2
  }
}

process.exitCode = run(process.argv.slice(2))
