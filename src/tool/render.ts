import { join, resolve } from 'node:path'
import { sheet } from '../diagnostics/images.ts'
import { writeOutput } from '../diagnostics/report.ts'
import { DIRECTIONS } from '../export/directions.ts'
import { record } from '../export/record.ts'
import type { Behaviour } from '../export/record.ts'
import { stripOf, trackOf } from '../export/strip.ts'
import { encodePng } from '../png/encode.ts'
import { messageOf } from './io.ts'
import type { Invoke, Io } from './io.ts'
import { subjectFor } from './subject.ts'

const LOOK = { scale: 3, gap: 3, background: 0xc8c8c8 }
const STRIP_FRAMES = 8
const STRIPS: Behaviour[] = ['walk', 'crouch', 'attack']

export const renderUsage = (invoke: Invoke): string => `usage: ${invoke('render')} <character dir> <out dir>`

export function runRender (argv: string[], io: Io, invoke: Invoke): number {
  const [dir, out] = argv
  if (dir === undefined || out === undefined || argv.length !== 2) {
    io.err(renderUsage(invoke))
    return 2
  }
  try {
    const recording = record(subjectFor(dir), ['idle', 'walk', 'crouch', 'attack'])
    const idle = DIRECTIONS.map(direction => {
      return { image: trackOf(recording.tracks, 'idle', direction).frames[0].image, anchor: [0, 0] as [number, number] }
    })
    const strips = STRIPS.map(behaviour => trackOf(recording.tracks, behaviour, 'right'))
    const files = {
      'idle-directions.png': encodePng(sheet([idle], LOOK)),
      ...Object.fromEntries(strips.map(track => {
        return [`${track.behaviour}-strip.png`, encodePng(stripOf(track, STRIP_FRAMES, LOOK))]
      }))
    }
    for (const [file, contents] of Object.entries(files)) {
      writeOutput(join(resolve(out), file), contents)
      io.out(`wrote ${join(resolve(out), file)}`)
    }
    io.out(`idle-directions.png: the first idle frame in ${DIRECTIONS.join(', ')}`)
    for (const track of strips) {
      io.out(`${track.behaviour}-strip.png: ${STRIP_FRAMES} of the ${track.frames.length} frames of the right-facing ` +
        `${track.behaviour}`)
    }
    return 0
  } catch (err) {
    io.err(`could not render '${dir}': ${messageOf(err)}`)
    return 2
  }
}
