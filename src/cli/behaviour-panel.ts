import { join } from 'node:path'
import { readWorld } from '../diagnostics/page-scenarios.ts'
import { TRANSPARENT } from '../image.ts'
import { record, SKINNED_HUMANOIDS, subjectOf } from '../export/record.ts'
import type { Behaviour } from '../export/record.ts'
import { stripOf, trackOf } from '../export/strip.ts'
import { writeChoicePanel } from './choice-panel.ts'
import { ROOT } from './paths.ts'
import { worldBundle } from './world-bundle.ts'

const OUT = join(ROOT, 'reports', 'behaviour-panel')
const SHOWN: Behaviour[] = ['idle', 'crouch', 'attack']
const CONTROLS: Behaviour[] = ['walk', 'jump']
const STRIP_FRAMES = 8
const LOOK = { scale: 1, gap: 2, background: TRANSPARENT }
const SPEC = {
  kind: 'choice' as const,
  name: 'Action in exported side-view strips',
  seed: 'behaviours-2',
  question: 'The image is a short animation strip of one character seen from the side, frames from left to right, ' +
    'covering one whole action. Which action is shown?',
  labels: ['idle', 'crouch', 'attack', 'walk', 'jump', 'wave', 'sit', 'fall'],
  scale: 4
}

const world = readWorld(worldBundle(join(ROOT, 'examples'), { only: SKINNED_HUMANOIDS }))
const items = SKINNED_HUMANOIDS.flatMap(name => {
  const recording = record(subjectOf(world, name), [...SHOWN, ...CONTROLS])
  return [...SHOWN, ...CONTROLS].map(behaviour => ({
    id: `${name}-${behaviour}`,
    image: `frames/${name}-${behaviour}.png`,
    label: behaviour,
    ...(CONTROLS.includes(behaviour) ? { control: true } : {}),
    picture: stripOf(trackOf(recording.tracks, behaviour, 'right'), STRIP_FRAMES, LOOK)
  }))
})
console.log(writeChoicePanel(OUT, SPEC, items))
