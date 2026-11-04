import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { sheet } from '../diagnostics/images.ts'
import { SURVEY } from '../diagnostics/glitches.ts'
import { readWorld } from '../diagnostics/page-scenarios.ts'
import { GAME_FINDERS, render, windowsIn } from '../diagnostics/rendering-panel.ts'
import type { PanelWindow, Strips } from '../diagnostics/rendering-panel.ts'
import { writeOutput } from '../diagnostics/report.ts'
import { createImage, getPixel, setPixel, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import { decodePng } from '../png/decode.ts'
import { encodePng } from '../png/encode.ts'
import { ROOT } from './paths.ts'
import { worldBundle } from './world-bundle.ts'

const OUT = join(ROOT, 'reports', 'game-panel')
const STRIP = { scale: 1, gap: 2, background: TRANSPARENT }
const SHEETS = ['male_walkcycle', 'female_walkcycle', 'soldier', 'soldier_altcolor']
const CELL = 64
const WALK_FRAMES = 8
const RIGHT_FACING_ROW = 3
const SPEC = {
  name: 'Page walks and landings vs hand-drawn game sprites',
  seed: 'e-1',
  question: 'Each item shows two pixel-art animations side by side, a left strip and a right strip (eight frames ' +
    'each, read left to right). One of them may have been assembled by software from separately drawn body-part ' +
    'sprites placed on an animated skeleton, rather than drawn by hand frame by frame. Which one was assembled by ' +
    'software? Answer left, right or cant_tell.',
  rating: 'Rate the quality of each side as game pixel art and animation, 1 (crude, amateur) to 5 ' +
    '(professional, ship-ready game art).',
  scale: 4
}

function crop (image: Image, x0: number, y0: number): Image {
  const out = createImage(CELL, CELL)
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) setPixel(out, x, y, getPixel(image, x0 + x, y0 + y))
  }
  return out
}

function referenceFrames (dir: string, name: string): Image[] {
  const image = decodePng(readFileSync(join(dir, `${name}.png`)))
  return Array.from({ length: WALK_FRAMES }, (_, k) => crop(image, (k + 1) * CELL, RIGHT_FACING_ROW * CELL))
}

function writeStrip (name: string, frames: Image[]): string {
  const file = `${name}.png`
  writeOutput(join(OUT, file), encodePng(sheet([frames.map(image => ({ image, anchor: [0, 0] }))], STRIP)))
  return file
}

function pairsOf (windows: PanelWindow[], strips: Map<PanelWindow, Strips>, dir: string): object[] {
  const references = SHEETS.map(name => writeStrip(`lpc-${name}`, referenceFrames(dir, name)))
  const characters = [...new Set(windows.map(w => w.character))]
  const real = ['walk', 'landing'].flatMap((kind, k) => characters.map((character, c) => {
    const w = windows.find(x => x.character === character && x.kind === kind) as PanelWindow
    const id = `${character}-${kind}`
    const page = writeStrip(`${id}-page`, (strips.get(w) as Strips).page)
    return { id, a: page, b: references[(c + k) % references.length] }
  }))
  const controls = [[0, 1], [2, 3]].map(([a, b]) => {
    return { id: `control-${SHEETS[a]}-${SHEETS[b]}`, a: references[a], b: references[b], control: true }
  })
  return [...real, ...controls]
}

const dir = process.argv[2]
if (dir === undefined) {
  console.error('usage: npm run game-panel -- <LPC people sprites dir>')
  process.exit(2)
}
const world = readWorld(worldBundle())
const windows = windowsIn(world, SURVEY, ROOT, GAME_FINDERS)
const skinned = [...new Set(windows.map(w => w.character))]
const kinds = Object.keys(GAME_FINDERS)
const missing = skinned.flatMap(c => kinds.filter(k => !windows.some(w => w.character === c && w.kind === k))
  .map(k => `${c} ${k}`))
if (missing.length > 0 || skinned.length === 0) throw new Error(`no window found for ${missing.join(', ')}`)
const strips = render(world, windows, ROOT)
const pairs = pairsOf(windows, strips, resolve(dir))
writeOutput(join(OUT, 'panel.json'), `${JSON.stringify({ ...SPEC, pairs }, null, 2)}\n`)
for (const w of windows) {
  const where = `${w.run.layout} seed ${w.seed}${w.run.wind === undefined ? '' : ` wind ${w.run.wind}`}`
  const stressed = w.run.stress === undefined ? '' : ' stressed'
  console.log(`${w.character} ${w.kind}: ${where}${stressed}, steps ${w.frames.join(' ')}`)
}
console.log(`panel: ${join(OUT, 'panel.json')}`)
