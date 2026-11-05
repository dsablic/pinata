import { join } from 'node:path'
import { readWorld } from '../diagnostics/page-scenarios.ts'
import { directionBase, directionItems } from '../export/direction-panel.ts'
import { record, SKINNED_HUMANOIDS, subjectOf } from '../export/record.ts'
import { writeChoicePanel } from './choice-panel.ts'
import { ROOT } from './paths.ts'
import { worldBundle } from './world-bundle.ts'

const OUT = join(ROOT, 'reports', 'export-panel')
const BASE = directionBase('Facing of exported frames', 'facing-2')

const world = readWorld(worldBundle(join(ROOT, 'examples'), { only: SKINNED_HUMANOIDS }))
const items = SKINNED_HUMANOIDS.flatMap(name => {
  return directionItems(record(subjectOf(world, name), ['idle', 'walk']), `${name}-`)
})
console.log(writeChoicePanel(OUT, BASE, items))
