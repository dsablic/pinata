import { join } from 'node:path'
import { sheet } from '../diagnostics/images.ts'
import { SURVEY } from '../diagnostics/glitches.ts'
import { readWorld } from '../diagnostics/page-scenarios.ts'
import { render, windowsIn } from '../diagnostics/rendering-panel.ts'
import type { PanelWindow, Strips } from '../diagnostics/rendering-panel.ts'
import { writeOutput } from '../diagnostics/report.ts'
import { TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import { encodePng } from '../png/encode.ts'
import { ROOT } from './paths.ts'
import { worldBundle } from './world-bundle.ts'

const OUT = join(ROOT, 'reports', 'rendering-panel')
const STRIP = { scale: 1, gap: 2, background: TRANSPARENT }
const CONTROLS = [{ character: 'knight', kind: 'walk' }, { character: 'wizard', kind: 'fall' }]
const SPEC = {
  name: 'Animation strips',
  seed: 'round-3',
  question: 'Each image is a short animation strip of one character, frames left to right. Which strip looks ' +
    'cleaner and more like hand-made pixel-art game animation: fewer glitches (parts tearing, vanishing, ' +
    'stretching or jittering) and smoother motion? Answer left, right or cant_tell.',
  rating: 'Rate how clean each strip is, 1 (glitchy) to 5 (professional game animation).',
  scale: 5
}

const idOf = (w: PanelWindow): string => `${w.character}-${w.kind}`

function writeStrip (name: string, frames: Image[]): string {
  const file = `${name}.png`
  writeOutput(join(OUT, file), encodePng(sheet([frames.map(image => ({ image, anchor: [0, 0] }))], STRIP)))
  return file
}

function pairsOf (windows: PanelWindow[], strips: Map<PanelWindow, Strips>): object[] {
  const of = (w: PanelWindow): Strips => strips.get(w) as Strips
  const real = windows.map(w => ({
    id: idOf(w), a: writeStrip(`${idOf(w)}-strip`, of(w).page), b: writeStrip(`${idOf(w)}-rotate`, of(w).current)
  }))
  const controls = CONTROLS.flatMap(({ character, kind }) => {
    const w = windows.find(x => x.character === character && x.kind === kind)
    if (w === undefined) return []
    const id = `control-${idOf(w)}`
    return [{
      id, a: writeStrip(`${id}-a`, of(w).current), b: writeStrip(`${id}-b`, of(w).later), control: true
    }]
  })
  return [...real, ...controls]
}

const world = readWorld(worldBundle())
const windows = windowsIn(world, SURVEY, ROOT)
const KINDS = ['walk', 'turn', 'fall']
const skinned = [...new Set(windows.map(w => w.character))]
const missing = skinned.flatMap(c => KINDS.filter(k => !windows.some(w => w.character === c && w.kind === k))
  .map(k => `${c} ${k}`))
if (missing.length > 0) throw new Error(`no window found for ${missing.join(', ')}`)
const strips = render(world, windows, ROOT)
writeOutput(join(OUT, 'panel.json'), `${JSON.stringify({ ...SPEC, pairs: pairsOf(windows, strips) }, null, 2)}\n`)
for (const w of windows) {
  const where = `${w.run.layout} seed ${w.seed}${w.run.wind === undefined ? '' : ` wind ${w.run.wind}`}`
  const stressed = w.run.stress === undefined ? '' : ' stressed'
  console.log(`${w.character} ${w.kind}: ${where}${stressed}, steps ${w.frames.join(' ')}`)
}
console.log(`panel: ${join(OUT, 'panel.json')}`)
