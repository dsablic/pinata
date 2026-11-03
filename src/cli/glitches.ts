import { join } from 'node:path'
import { survey, SURVEY } from '../diagnostics/glitches.ts'
import type { Kind, Tally } from '../diagnostics/glitches.ts'
import { sheet } from '../diagnostics/images.ts'
import { readWorld } from '../diagnostics/page-scenarios.ts'
import { writeOutput } from '../diagnostics/report.ts'
import { FPS } from '../page/cast.ts'
import { encodePng } from '../png/encode.ts'
import { ROOT } from './paths.ts'
import { worldBundle } from './world-bundle.ts'

const OUT = join(ROOT, 'reports', 'glitches')
const LEAST_MINUTES = 10
const LEAST_EVENTS = 20
const MOST_SHARE = 0.001
const STRIP = { scale: 4, gap: 4, background: 0xf4f1ea }
const KINDS: Kind[] = ['fragment', 'pop', 'stretch', 'miss', 'refit', 'flicker', 'blank']

function gate (met: boolean, text: string): string {
  return `${met ? 'GATE MET' : 'GATE MISSED'} ${text}`
}

function summary (name: string, t: Tally): string[] {
  const minutes = t.frames / FPS / 60
  const share = (n: number): string => `${(100 * n / Math.max(1, t.frames)).toFixed(2)}%`
  return [
    `${name}: ${minutes.toFixed(1)} min, ${t.drops} drops, ${t.turns} turns on the spot`,
    gate(minutes >= LEAST_MINUTES && t.drops >= LEAST_EVENTS && t.turns >= LEAST_EVENTS,
      `${name} surveyed for at least ${LEAST_MINUTES} min with ${LEAST_EVENTS} drops and ${LEAST_EVENTS} turns`),
    gate(t.fragmentFrames <= MOST_SHARE * t.frames, `${name} fragments (${share(t.fragmentFrames)} of frames)`),
    gate(t.pops === 0, `${name} pops (${t.pops})`),
    gate(t.stretchFrames <= MOST_SHARE * t.frames, `${name} stretch (${share(t.stretchFrames)} of frames)`),
    `${name} a part's end 2 px or more off its joint (not gated): ${share(t.missFrames)} of frames`,
    `${name} far from their usual fit in the view (not gated): ${share(t.refitFrames)} of frames`,
    `${name} blank or cut-off frames: ${t.blankFrames}`,
    `${name} flicker: worst window ${(100 * Math.max(0, ...t.flicker)).toFixed(2)}%, ` +
      `median ${(100 * [...t.flicker].sort((a, b) => a - b)[t.flicker.length >> 1]).toFixed(2)}%`
  ]
}

function strips (name: string, t: Tally): string[] {
  return KINDS.flatMap(kind => {
    const worst = t.worst[kind]
    if (worst.length === 0) return []
    const rows = worst.map(w => w.frames.map(image => ({ image, anchor: [0, 0] as [number, number] })))
    writeOutput(join(OUT, `${name}-${kind}.png`), encodePng(sheet(rows, STRIP)))
    return [`${name} ${kind}:`, ...worst.map(w => `  ${w.note}`)]
  })
}

const tallies = survey(readWorld(worldBundle()), SURVEY, ROOT)
const notes: string[] = []
for (const [name, t] of tallies) {
  console.log(summary(name, t).join('\n'))
  notes.push(...strips(name, t))
}
writeOutput(join(OUT, 'worst.txt'), `${notes.join('\n')}\n`)
console.log(`worst frames: ${OUT}`)
