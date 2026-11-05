import { sheet } from '../diagnostics/images.ts'
import type { Image } from '../image.ts'
import type { Direction } from './directions.ts'
import type { Behaviour, Track } from './record.ts'

export type StripLook = { scale: number, gap: number, background: number }

export function trackOf (tracks: Track[], behaviour: Behaviour, direction: Direction): Track {
  const found = tracks.find(track => track.behaviour === behaviour && track.direction === direction)
  if (found === undefined) throw new Error(`no ${behaviour}-${direction} track was recorded`)
  return found
}

export function stripOf (track: Track, count: number, look: StripLook): Image {
  const picks = Array.from({ length: count }, (_, i) => Math.floor(i * track.frames.length / count))
  const cells = picks.map(index => ({ image: track.frames[index].image, anchor: [0, 0] as [number, number] }))
  return sheet([cells], look)
}
