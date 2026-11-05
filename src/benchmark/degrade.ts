import { createImage, getPixel, setPixel, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import { boxOf } from './frames.ts'
import type { Clip } from './frames.ts'

export type DegradedDimension = 'fluidity' | 'secondary' | 'environment' | 'anticipation'
export type Degraded = { dimension: DegradedDimension, clip: Clip }

const FEET_ROWS = 4
const MOST_SLIDE = 4
const MOST_WIND_UP_SHARE = 0.5
const NEEDED_FRAMES = 2

function needFrames (clip: Clip, what: string): void {
  if (clip.frames.length < NEEDED_FRAMES) throw new Error(`${clip.name}: ${what} needs at least two frames`)
}

function changed (a: Image, b: Image): number {
  let [different, drawn] = [0, 0]
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const [p, q] = [getPixel(a, x, y), getPixel(b, x, y)]
      if (p !== TRANSPARENT || q !== TRANSPARENT) drawn++
      if (p !== q) different++
    }
  }
  return drawn === 0 ? 0 : different / drawn
}

export function dropFrames (clip: Clip): Degraded {
  needFrames(clip, 'dropping frames')
  const frames = clip.frames.map((_, i) => clip.frames[i - i % 2])
  return { dimension: 'fluidity', clip: { ...clip, frames } }
}

function shiftedRows (frame: Image, from: number, by: number): Image {
  const out = createImage(frame.width, frame.height)
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const at = x + (y >= from ? by : 0)
      if (at >= 0 && at < frame.width) setPixel(out, at, y, getPixel(frame, x, y))
    }
  }
  return out
}

function slideRoom (clip: Clip, feetTop: number): { direction: 1 | -1, room: number } {
  const feet = boxOf(clip.frames.map(frame => {
    const rows = createImage(frame.width, frame.height)
    for (let y = feetTop; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) setPixel(rows, x, y, getPixel(frame, x, y))
    }
    return rows
  }))
  if (feet === undefined) throw new Error(`${clip.name}: no feet to slide`)
  const [left, right] = [feet.left, clip.frames[0].width - 1 - feet.right]
  return right >= left ? { direction: 1, room: right } : { direction: -1, room: left }
}

export function slideFeet (clip: Clip): Degraded {
  needFrames(clip, 'sliding the feet')
  const bottom = (boxOf(clip.frames) as NonNullable<ReturnType<typeof boxOf>>).bottom
  const feetTop = bottom - FEET_ROWS + 1
  const { direction, room } = slideRoom(clip, feetTop)
  const most = Math.min(MOST_SLIDE, room, Math.floor(clip.frames.length / 2))
  if (most < 1) throw new Error(`${clip.name}: no room inside the canvas to slide the feet`)
  const frames = clip.frames.map((frame, i) => {
    const offset = Math.min(i, clip.frames.length - i, most)
    return shiftedRows(frame, feetTop, direction * offset)
  })
  return { dimension: 'environment', clip: { ...clip, frames } }
}

export function windUpLength (clip: Clip): number {
  let [strike, largest] = [1, -1]
  for (let i = 1; i < clip.frames.length; i++) {
    const change = changed(clip.frames[i - 1], clip.frames[i])
    if (change > largest) [strike, largest] = [i, change]
  }
  return Math.min(strike, Math.floor(clip.frames.length * MOST_WIND_UP_SHARE))
}

export function removeWindUp (clip: Clip): Degraded {
  needFrames(clip, 'removing the wind-up')
  const removed = windUpLength(clip)
  const first = clip.frames[removed]
  const frames = [...Array.from({ length: removed }, () => first), ...clip.frames.slice(removed)]
  return { dimension: 'anticipation', clip: { ...clip, frames } }
}
