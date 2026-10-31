import { createImage, getPixel, setPixel, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import { sheet } from './images.ts'

export const CHANGED = 0xd7191c
export const UNCHANGED = 0x9a9a9a

export type StripOptions = { from: number, count: number, scale: number, gap: number, background: number }

export function differenceMap (before: Image, after: Image): Image {
  const out = createImage(after.width, after.height)
  for (let y = 0; y < after.height; y++) {
    for (let x = 0; x < after.width; x++) {
      const a = getPixel(before, x, y)
      const b = getPixel(after, x, y)
      if (a !== b) setPixel(out, x, y, CHANGED)
      else if (b !== TRANSPARENT) setPixel(out, x, y, UNCHANGED)
    }
  }
  return out
}

export function differenceStrip (images: Image[], options: StripOptions): Image {
  const cells = Array.from({ length: options.count }, (_, i) => {
    const k = options.from + i
    return { image: differenceMap(images[k - 1], images[k]), anchor: [0, 0] as [number, number] }
  })
  return sheet([cells], options)
}
