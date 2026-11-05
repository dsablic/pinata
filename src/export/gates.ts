import { getPixel, TRANSPARENT } from '../image.ts'
import { expectedSector } from './directions.ts'
import type { Cell, Foot, Frame, Sole, Track } from './record.ts'

export type Held = { pairs: number, flickers: number, hidden: number, worst: number }

export const FEET_HELD_PX = 1

function slide (from: Sole, to: Sole, travel: [number, number]): number {
  return Math.max(Math.abs(to.x - from.x + travel[0]), Math.abs(to.y - from.y + travel[1]))
}

export function heldOf (track: Track): Held {
  const { frames } = track
  const at = (k: number): Frame | undefined => track.loop ? frames[(k + frames.length) % frames.length] : frames[k]
  const held: Held = { pairs: 0, flickers: 0, hidden: 0, worst: 0 }
  for (let k = 0; k < frames.length; k++) {
    frames[k].feet.forEach((now, leg) => {
      const [before, next] = [at(k - 1)?.feet[leg], at(k + 1)?.feet[leg]]
      if (before?.planted === true && !now.planted && next?.planted === true) held.flickers++
      const to = at(k + 1)
      if (to === undefined || !now.planted || !to.feet[leg].planted) return
      const [a, b] = [now.sole, to.feet[leg].sole]
      if (a === undefined || b === undefined) {
        held.hidden++
        return
      }
      held.pairs++
      held.worst = Math.max(held.worst, slide(a, b, to.travel))
    })
  }
  return held
}

export function sectorMisses (track: Track): number {
  const wanted = expectedSector(track.direction)
  return track.frames.filter(frame => frame.sector !== wanted).length
}

export function clippedPixels (track: Track): number {
  let clipped = 0
  for (const { image } of track.frames) {
    const { width, height } = image
    for (let x = 0; x < width; x++) {
      if (getPixel(image, x, 0) !== TRANSPARENT) clipped++
      if (getPixel(image, x, height - 1) !== TRANSPARENT) clipped++
    }
    for (let y = 1; y < height - 1; y++) {
      if (getPixel(image, 0, y) !== TRANSPARENT) clipped++
      if (getPixel(image, width - 1, y) !== TRANSPARENT) clipped++
    }
  }
  return clipped
}

export const GROUND_PX = 1
export const ANCHOR_PX = 0.5

export const MOST_OFF_GROUND_SHARE = 0.05

export type Ground = { planted: number, seen: number, off: number, worst: number, hidden: number[] }

function neverSeen (feet: Foot[][], mustBePlanted: boolean): number[] {
  const count = Math.max(0, ...feet.map(own => own.length))
  return Array.from({ length: count }, (_, leg) => leg).filter(leg => {
    const considered = feet.filter(own => !mustBePlanted || own[leg]?.planted === true)
    return considered.length > 0 && considered.every(own => own[leg]?.sole === undefined)
  })
}

export function groundOf (track: Track): Ground {
  const hidden = neverSeen(track.frames.map(frame => frame.feet), true)
  const ground: Ground = { planted: 0, seen: 0, off: 0, worst: 0, hidden }
  for (const { feet } of track.frames) {
    for (const foot of feet) {
      if (!foot.planted) continue
      ground.planted++
      if (foot.drawn === undefined) continue
      const gap = foot.drawn.y + 1 - Math.round(foot.level)
      ground.seen++
      if (Math.abs(gap) > GROUND_PX) ground.off++
      if (Math.abs(gap) > Math.abs(ground.worst)) ground.worst = gap
    }
  }
  return ground
}

export function unseenLegs (tracks: Track[]): number[] {
  return neverSeen(tracks.flatMap(track => track.frames.map(frame => frame.feet)), false)
}

export function anchorOffset (cell: Cell): number {
  return Math.max(Math.abs(cell.root[0] - cell.pivot[0]), Math.abs(cell.root[1] - cell.pivot[1]))
}
