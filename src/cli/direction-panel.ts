import { join } from 'node:path'
import { readWorld } from '../diagnostics/page-scenarios.ts'
import { DIRECTIONS } from '../export/directions.ts'
import { record, SKINNED_HUMANOIDS, subjectOf } from '../export/record.ts'
import { writeChoicePanel } from './choice-panel.ts'
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
    return { id: `${name}-${track.direction}`, image: `frames/${name}-${track.direction}.png`, label: track.direction,
      picture: track.frames[0].image }
  })
})
console.log(writeChoicePanel(OUT, SPEC, items))
