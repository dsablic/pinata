import { getPixel, neighbours4, neighbours8, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import type { Mannequin } from '../formats/mannequin.ts'
import { EMPTY } from '../raster/gbuffer.ts'
import type { GBuffer } from '../raster/gbuffer.ts'

export type ThinPart = { part: string, pixels: number, thinFraction: number }

export function outlineGaps (img: Image, outlineMask: Uint8Array): number {
  let gaps = 0
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const c = getPixel(img, x, y)
      if (c === TRANSPARENT || outlineMask[y * img.width + x] === 1) continue
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
  const isEdge = (x: number, y: number, p: number, depth: number) => {
    if (x < 0 || y < 0 || x >= g.width || y >= g.height) return true
    const j = y * g.width + x
    return g.part[j] === EMPTY || (g.part[j] !== p && g.depth[j] > depth)
  }
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const i = y * g.width + x
      const p = g.part[i]
      if (p === EMPTY) continue
      pixels[p]++
      const d = g.depth[i]
      const narrowAcross = isEdge(x - 1, y, p, d) && isEdge(x + 1, y, p, d)
      const narrowDown = isEdge(x, y - 1, p, d) && isEdge(x, y + 1, p, d)
      if (narrowAcross || narrowDown) thin[p]++
    }
  }
  return m.parts
    .map((part, i) => ({ part: part.name, pixels: pixels[i], thinFraction: pixels[i] === 0 ? 0 : thin[i] / pixels[i] }))
    .filter((_, i) => m.parts[i].allowThin !== true)
}
