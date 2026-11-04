import { join, resolve } from 'node:path'
import { sheet } from '../diagnostics/images.ts'
import type { SheetCell } from '../diagnostics/images.ts'
import { writeOutput } from '../diagnostics/report.ts'
import { DIRECTIONS, record } from '../export/record.ts'
import type { Track } from '../export/record.ts'
import { encodePng } from '../png/encode.ts'
import { messageOf } from './io.ts'
import type { Invoke, Io } from './io.ts'
import { subjectFor } from './subject.ts'

const LOOK = { scale: 3, gap: 3, background: 0xc8c8c8 }
const STRIP_FRAMES = 8

export const renderUsage = (invoke: Invoke): string => `usage: ${invoke('render')} <character dir> <out dir>`

function cells (track: Track, indices: number[]): SheetCell[] {
  return indices.map(index => ({ image: track.frames[index].image, anchor: [0, 0] as [number, number] }))
}

function evenly (count: number): number[] {
  return Array.from({ length: STRIP_FRAMES }, (_, i) => Math.floor(i * count / STRIP_FRAMES))
}

function find (tracks: Track[], behaviour: string, direction: string): Track {
  return tracks.find(track => track.behaviour === behaviour && track.direction === direction) as Track
}

export function runRender (argv: string[], io: Io, invoke: Invoke): number {
  const [dir, out] = argv
  if (dir === undefined || out === undefined || argv.length !== 2) {
    io.err(renderUsage(invoke))
    return 2
  }
  try {
    const recording = record(subjectFor(dir), ['idle', 'walk'])
    const idle = DIRECTIONS.map(direction => cells(find(recording.tracks, 'idle', direction), [0])[0])
    const walk = find(recording.tracks, 'walk', 'right')
    const files = {
      'idle-directions.png': encodePng(sheet([idle], LOOK)),
      'walk-strip.png': encodePng(sheet([cells(walk, evenly(walk.frames.length))], LOOK))
    }
    for (const [file, contents] of Object.entries(files)) {
      writeOutput(join(resolve(out), file), contents)
      io.out(`wrote ${join(resolve(out), file)}`)
    }
    io.out(`idle-directions.png: the idle pose in ${DIRECTIONS.join(', ')}; ` +
      `walk-strip.png: ${STRIP_FRAMES} of the ${walk.frames.length} frames of the right-facing walk loop`)
    return 0
  } catch (err) {
    io.err(`could not render '${dir}': ${messageOf(err)}`)
    return 2
  }
}
