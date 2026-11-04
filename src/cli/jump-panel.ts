import { join } from 'node:path'
import { sheet } from '../diagnostics/images.ts'
import type { SurveyRun } from '../diagnostics/glitches.ts'
import { readWorld } from '../diagnostics/page-scenarios.ts'
import { JUMP_FINDERS, render, windowsIn } from '../diagnostics/rendering-panel.ts'
import type { PanelWindow, Strips } from '../diagnostics/rendering-panel.ts'
import { writeOutput } from '../diagnostics/report.ts'
import { TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import { encodePng } from '../png/encode.ts'
import type { ReadWorld } from '../world/bundle.ts'
import { ROOT } from './paths.ts'
import { worldBundle } from './world-bundle.ts'

const OUT = join(ROOT, 'reports', 'jump-panel')
const STRIP = { scale: 1, gap: 2, background: TRANSPARENT }
const RUNS: SurveyRun[] = [
  { layout: 'jumps', seconds: 120 },
  ...[1, 2, 3].map(seed => ({ layout: 'jumps', seed, seconds: 120 })),
  ...['page-test', 'demo-1200', 'demo-390'].map(layout => ({ layout, seconds: 120, jumps: 'super' as const }))
]
const CONTROLS = ['knight', 'wizard']
const SPEC = {
  name: 'Jump animations',
  seed: 'jump-1',
  layout: 'stacked',
  question: 'Each image shows two pixel-art animations of the same character jumping, one above the other (eight ' +
    'frames each, read left to right). Which one is the better jump animation, the one you would rather ship in a ' +
    'game? Answer left (top), right (bottom) or cant_tell.',
  rating: 'Rate each animation as game pixel-art animation, 1 (crude, amateur) to 5 (professional, ship-ready).',
  scale: 4
}

function writeStrip (name: string, frames: Image[]): string {
  const file = `${name}.png`
  writeOutput(join(OUT, file), encodePng(sheet([frames.map(image => ({ image, anchor: [0, 0] }))], STRIP)))
  return file
}

type Version = { world: ReadWorld, windows: PanelWindow[] }

const find = (windows: PanelWindow[], character: string, kind: string): PanelWindow | undefined => {
  return windows.find(w => w.character === character && w.kind === kind)
}

function pairedWindows (takes: ReadWorld, procedural: ReadWorld): { takes: Version, procedural: Version } {
  const characters = takes.cast.filter((_, i) => takes.looks[i].skin !== undefined).map(m => m.name)
  const chosen = {
    takes: { world: takes, windows: [] as PanelWindow[] },
    procedural: { world: procedural, windows: [] as PanelWindow[] }
  }
  for (const run of RUNS) {
    const left = characters.filter(c => find(chosen.takes.windows, c, 'jump') === undefined)
    if (left.length === 0) break
    const own = windowsIn(takes, [run], ROOT, JUMP_FINDERS)
    const plain = windowsIn(procedural, [run], ROOT, { jump: JUMP_FINDERS.jump })
    for (const c of left) {
      const wanted = CONTROLS.includes(c) ? ['jump', 'jump-again'] : ['jump']
      const mine = wanted.map(kind => find(own, c, kind))
      const other = find(plain, c, 'jump')
      if (other === undefined || mine.includes(undefined)) continue
      chosen.takes.windows.push(...mine as PanelWindow[])
      chosen.procedural.windows.push(other)
    }
  }
  const missing = characters.filter(c => find(chosen.takes.windows, c, 'jump') === undefined)
  if (missing.length > 0 || characters.length === 0) throw new Error(`no jump window found for ${missing.join(', ')}`)
  return chosen
}

const takesWorld = readWorld(worldBundle())
const proceduralWorld = readWorld(worldBundle(undefined, { jumpTakes: false }))
const versions = pairedWindows(takesWorld, proceduralWorld)
const takes = { windows: versions.takes.windows, strips: render(takesWorld, versions.takes.windows, ROOT) }
const procedural = {
  windows: versions.procedural.windows, strips: render(proceduralWorld, versions.procedural.windows, ROOT)
}
const characters = [...new Set(takes.windows.map(w => w.character))]
const real = characters.map(character => {
  const a = find(takes.windows, character, 'jump') as PanelWindow
  const b = find(procedural.windows, character, 'jump') as PanelWindow
  return {
    id: `${character}-jump`,
    a: writeStrip(`${character}-takes`, (takes.strips.get(a) as Strips).page),
    b: writeStrip(`${character}-procedural`, (procedural.strips.get(b) as Strips).page)
  }
})
const controls = CONTROLS.map(character => {
  const again = find(takes.windows, character, 'jump-again') as PanelWindow
  return {
    id: `control-${character}-jump`,
    a: `${character}-takes.png`,
    b: writeStrip(`${character}-takes-again`, (takes.strips.get(again) as Strips).page),
    control: true
  }
})
writeOutput(join(OUT, 'panel.json'), `${JSON.stringify({ ...SPEC, pairs: [...real, ...controls] }, null, 2)}\n`)
const describe = (label: string, windows: PanelWindow[]): void => {
  for (const w of windows) {
    const where = `${w.run.layout} seed ${w.seed}${w.run.jumps === undefined ? '' : ` ${w.run.jumps} jumps`}`
    console.log(`${label} ${w.character} ${w.kind}: ${where}, steps ${w.frames.join(' ')}`)
  }
}
describe('takes', takes.windows)
describe('procedural', procedural.windows)
console.log(`panel: ${join(OUT, 'panel.json')}`)
