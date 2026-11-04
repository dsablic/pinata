import { getPixel } from '../image.ts'
import type { Image } from '../image.ts'

export type Seam = { seam: number, median: number }

export function changedPixels (a: Image, b: Image): number {
  let changed = 0
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) if (getPixel(a, x, y) !== getPixel(b, x, y)) changed++
  }
  return changed
}

export function medianOf (values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function steps (images: Image[]): number[] {
  return images.slice(1).map((image, k) => changedPixels(images[k], image))
}

export function seamOf (images: Image[]): Seam {
  return { seam: changedPixels(images[images.length - 1], images[0]), median: medianOf(steps(images)) }
}

export function measured ({ median }: Seam): boolean {
  return median > 0
}

export function repeated ({ seam, median }: Seam): boolean {
  return seam === 0 && median > 0
}

export function seamless (seam: Seam): boolean {
  return measured(seam) && seam.seam <= seam.median && !repeated(seam)
}

export function ratioOf ({ seam, median }: Seam): number {
  if (median === 0) return seam === 0 ? 1 : Infinity
  return seam / median
}
