import { expectedSector } from '../src/export/record.ts'
import type { Cell, Direction, Foot, Frame, Recording, Track } from '../src/export/record.ts'
import { checksOf } from '../src/export/report.ts'
import type { Gate } from '../src/export/report.ts'
import type { Verdict } from '../src/checks/gate-spec.ts'
import { createImage, setPixel } from '../src/image.ts'
import type { Image } from '../src/image.ts'

export const CELL: Cell = { width: 4, height: 4, pivot: [2, 2], root: [2, 2] }

export function frameWith (foot: { x: number, y: number }, travel: [number, number]): Frame {
  const image = createImage(4, 4)
  return { image, sector: expectedSector('right'), travel, feet: [{ planted: true, sole: foot, level: 0 }] }
}

export function feetFrame (feet: Foot[]): Frame {
  return { ...frameWith({ x: 0, y: 0 }, [0, 0]), feet }
}

export function trackOf (frames: Frame[], options: Partial<Omit<Track, 'frames'>> = {}): Track {
  return { behaviour: 'walk', direction: 'right', loop: false, ...options, frames }
}

export function recordingOf (tracks: Track[], cell: Cell = CELL): Recording {
  return { name: 'case', cell, spritePerMetre: 27, tracks }
}

export function verdictOf (recording: Recording, gate: Gate): Verdict {
  const checks = checksOf(recording).filter(check => check.gate === gate)
  return { pass: checks.every(check => check.pass), measured: checks.every(check => check.measured) }
}

export function soleAt (x: number, travel: number): Frame {
  return frameWith({ x, y: 0 }, [travel, 0])
}

export function soleDown (y: number, travel: number): Frame {
  return frameWith({ x: 0, y }, [0, travel])
}

export function planted (y: number, level = 0): Foot {
  return { planted: true, sole: { x: 0, y }, level }
}

export const LIFTED: Foot = { planted: false, sole: { x: 0, y: -9 }, level: 0 }

export function mixedGroundFrames (): Frame[] {
  return [
    feetFrame([planted(-1), planted(0)]),
    feetFrame([planted(-2), LIFTED]),
    feetFrame([planted(2), planted(-3)]),
    feetFrame([planted(-1), planted(-1)])
  ]
}

export function bar (length: number): Image {
  const image = createImage(8, 1)
  for (let x = 0; x < length; x++) setPixel(image, x, 0, 1)
  return image
}

export function frameOf (image: Image, direction: Direction = 'right'): Frame {
  return { ...frameWith({ x: 0, y: 0 }, [0, 0]), image, sector: expectedSector(direction), feet: [] }
}

export function markedAt (width: number, height: number, ...at: Array<[number, number]>): Frame {
  const image = createImage(width, height)
  for (const [x, y] of at) setPixel(image, x, y, 1)
  return frameOf(image)
}
