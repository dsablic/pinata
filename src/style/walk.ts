import { createImage, parseHex, setPixel } from '../image.ts'
import type { Image } from '../image.ts'
import { TRANSPARENT_CHAR } from '../formats/skin.ts'
import type { Pixel, Walk, WalkFrame } from '../formats/skin.ts'

export type Box = { width: number, height: number, baseline: number }
export type Silhouette = Set<number>

const MIRRORED = new WeakMap<Walk, Walk>()
const KEY_OFFSET = 65536

export function mirroredWalk (walk: Walk): Walk {
  const found = MIRRORED.get(walk)
  if (found !== undefined) return found
  const frames = walk.frames.map((frame): WalkFrame => {
    const width = [...frame.rows[0]].length
    const flip = ([x, y]: Pixel): Pixel => [width - 1 - x, y]
    return {
      rows: frame.rows.map(row => [...row].reverse().join('')),
      soles: [flip(frame.soles[1]), flip(frame.soles[0])],
      planted: frame.planted === 0 ? 1 : 0
    }
  })
  const made = { frames }
  MIRRORED.set(walk, made)
  return made
}

export function facingWalk (walk: Walk, mirror: boolean): Walk {
  return mirror ? mirroredWalk(walk) : walk
}

export function meanSoleX (frame: WalkFrame): number {
  return (frame.soles[0][0] + frame.soles[1][0]) / 2
}

export function plantedSole (frame: WalkFrame): Pixel {
  return frame.soles[frame.planted]
}

export function drawFrame (
  frame: WalkFrame, palette: Record<string, string>, box: Box, origin: Pixel
): Image {
  const image = createImage(box.width, box.height)
  const colours = new Map(Object.entries(palette).map(([key, hex]) => [key, parseHex(hex)]))
  frame.rows.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      const colour = colours.get(cell)
      if (colour !== undefined) setPixel(image, origin[0] + x, origin[1] + y, colour)
    })
  })
  return image
}

export function silhouetteOf (image: Image, left = 0, top = 0): Silhouette {
  const found: Silhouette = new Set()
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] === 0) continue
      found.add(keyOf(left + x, top + y))
    }
  }
  return found
}

const PIXELS = new WeakMap<WalkFrame, Pixel[]>()

export function pixelsOf (frame: WalkFrame): Pixel[] {
  const found = PIXELS.get(frame)
  if (found !== undefined) return found
  const pixels = frame.rows.flatMap((row, y) => [...row].flatMap((cell, x): Pixel[] => cell === TRANSPARENT_CHAR ? [] : [[x, y]]))
  PIXELS.set(frame, pixels)
  return pixels
}

export function keyOf (x: number, y: number): number {
  return (y + KEY_OFFSET) * 2 * KEY_OFFSET + x + KEY_OFFSET
}

export function sharedShare (frame: WalkFrame, left: number, top: number, drawn: Silhouette): number {
  const pixels = pixelsOf(frame)
  let shared = 0
  for (const [x, y] of pixels) if (drawn.has(keyOf(left + x, top + y))) shared++
  const larger = Math.max(pixels.length, drawn.size)
  return larger === 0 ? 0 : (pixels.length + drawn.size - 2 * shared) / larger
}

export function changedShare (before: Silhouette, after: Silhouette): number {
  let differing = 0
  for (const key of before) if (!after.has(key)) differing++
  for (const key of after) if (!before.has(key)) differing++
  const larger = Math.max(before.size, after.size)
  return larger === 0 ? 0 : differing / larger
}
