import { basename, resolve } from 'node:path'
import { readWorld } from '../diagnostics/page-scenarios.ts'
import { subjectOf } from '../export/record.ts'
import type { Subject } from '../export/record.ts'
import { worldBundle } from '../cli/world-bundle.ts'

export function subjectFor (dir: string): Subject {
  const character = resolve(dir)
  const name = basename(character)
  return subjectOf(readWorld(worldBundle(resolve(character, '..'), { only: [name] })), name)
}
