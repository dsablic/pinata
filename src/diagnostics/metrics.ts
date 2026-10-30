import { getPixel, neighbours4, neighbours8, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import type { Mannequin } from '../formats/mannequin.ts'
import { EMPTY } from '../raster/gbuffer.ts'
import type { GBuffer } from '../raster/gbuffer.ts'

export type ThinPart = { part: string, pixels: number, thinFraction: number }

export function outlineGaps (img: Image, outline: number): number {
  let gaps = 0
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const c = getPixel(img, x, y)
      if (c === TRANSPARENT || c === outline) continue
      if (neighbours4(img, x, y).includes(TRANSPARENT)) gaps++
    }
  }
  return gaps
}

export function strayPixels (img: Image, exclude: Uint8Array): number {
  let strays = 0
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const c = getPixel(img, x, y)
      if (c === TRANSPARENT || exclude[y * img.width + x] === 1) continue
      if (!neighbours8(img, x, y).includes(c)) strays++
    }
  }
  return strays
}

export function paletteSize (images: Image[]): number {
  const colours = new Set<number>()
  for (const img of images) {
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const c = getPixel(img, x, y)
        if (c !== TRANSPARENT) colours.add(c)
      }
    }
  }
  return colours.size
}

export function thinParts (g: GBuffer, m: Mannequin): ThinPart[] {
  const pixels = new Array<number>(m.parts.length).fill(0)
  const thin = new Array<number>(m.parts.length).fill(0)
  const partAt = (x: number, y: number) => (x < 0 || y < 0 || x >= g.width || y >= g.height)
    ? EMPTY
    : g.part[y * g.width + x]
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const p = partAt(x, y)
      if (p === EMPTY) continue
      pixels[p]++
      const narrowAcross = partAt(x - 1, y) !== p && partAt(x + 1, y) !== p
      const narrowDown = partAt(x, y - 1) !== p && partAt(x, y + 1) !== p
      if (narrowAcross || narrowDown) thin[p]++
    }
  }
  return m.parts
    .map((part, i) => ({ part: part.name, pixels: pixels[i], thinFraction: pixels[i] === 0 ? 0 : thin[i] / pixels[i] }))
    .filter((_, i) => m.parts[i].allowThin !== true)
}
