import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readWorld } from '../diagnostics/page-scenarios.ts'
import { writeOutput } from '../diagnostics/report.ts'
import { DIRECTIONS, record, SKINNED_HUMANOIDS, subjectOf } from '../export/record.ts'
import { buildChoicePacket } from '../judge/choice.ts'
import type { ChoiceSpec } from '../judge/choice.ts'
import { decodePng } from '../png/decode.ts'
import { encodePng } from '../png/encode.ts'
import { ROOT } from './paths.ts'
import { worldBundle } from './world-bundle.ts'

const OUT = join(ROOT, 'reports', 'export-panel')
const SPEC = {
  kind: 'choice' as const,
  name: 'Facing of exported idle frames',
  seed: 'facing-1',
  question: 'The character is standing still, seen by a camera a little above its eye level. Which way is it ' +
    'facing? "front" is toward the viewer, "back" is away from the viewer (its back is visible), "right" and ' +
    '"left" are toward the right and the left edge of the image (seen from the side), and the four diagonals ' +
    'are in between ("front-right" is toward the viewer and toward the right edge, "back-left" is away from ' +
    'the viewer and toward the left edge, and so on). Left and right are as seen on screen.',
  labels: [...DIRECTIONS],
  scale: 6
}

const world = readWorld(worldBundle(join(ROOT, 'examples'), { only: SKINNED_HUMANOIDS }))
const items = SKINNED_HUMANOIDS.flatMap(name => {
  const recording = record(subjectOf(world, name), ['idle'])
  return recording.tracks.map(track => {
    const image = `frames/${name}-${track.direction}.png`
    writeOutput(join(OUT, image), encodePng(track.frames[0].image))
    return { id: `${name}-${track.direction}`, image, label: track.direction }
  })
})
const spec: ChoiceSpec = { ...SPEC, background: '#c8c8c8', items }
writeOutput(join(OUT, 'panel.json'), `${JSON.stringify({ ...SPEC, items }, null, 2)}\n`)
const packet = buildChoicePacket(spec, path => decodePng(readFileSync(join(OUT, path))))
for (const [file, image] of Object.entries(packet.images)) writeOutput(join(OUT, 'packet', file), encodePng(image))
writeOutput(join(OUT, 'packet', 'questions.md'), packet.questions)
writeOutput(join(OUT, 'key.json'), `${JSON.stringify(packet.key, null, 2)}\n`)
console.log(`${Object.keys(packet.images).length} items in ${join(OUT, 'packet')}; key in ${join(OUT, 'key.json')}`)
