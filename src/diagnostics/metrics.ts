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

/** Pixel indices (y * width + x) of coloured pixels outside `exclude` with no 8-neighbour of the same colour. */
export function strayPixelIndices (img: Image, exclude: Uint8Array): number[] {
  const strays: number[] = []
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const c = getPixel(img, x, y)
      if (c === TRANSPARENT || exclude[y * img.width + x] === 1) continue
      if (!neighbours8(img, x, y).includes(c)) strays.push(y * img.width + x)
    }
  }
  return strays
}

export function strayPixels (img: Image, exclude: Uint8Array): number {
  return strayPixelIndices(img, exclude).length
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

function isEdge (g: GBuffer, x: number, y: number, p: number, depth: number): boolean {
  if (x < 0 || y < 0 || x >= g.width || y >= g.height) return true
  const j = y * g.width + x
  return g.part[j] === EMPTY || (g.part[j] !== p && g.depth[j] > depth)
}

function isThinPixel (g: GBuffer, x: number, y: number, p: number, depth: number): boolean {
  const narrowAcross = isEdge(g, x - 1, y, p, depth) && isEdge(g, x + 1, y, p, depth)
  const narrowDown = isEdge(g, x, y - 1, p, depth) && isEdge(g, x, y + 1, p, depth)
  return narrowAcross || narrowDown
}

export function thinParts (g: GBuffer, m: Mannequin): ThinPart[] {
  const pixels = new Array<number>(m.parts.length).fill(0)
  const thin = new Array<number>(m.parts.length).fill(0)
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const p = g.part[y * g.width + x]
      if (p === EMPTY) continue
      pixels[p]++
      if (isThinPixel(g, x, y, p, g.depth[y * g.width + x])) thin[p]++
    }
  }
  return m.parts
    .map((part, i) => ({ part: part.name, pixels: pixels[i], thinFraction: pixels[i] === 0 ? 0 : thin[i] / pixels[i] }))
    .filter((_, i) => m.parts[i].allowThin !== true)
}

/** Names of the parts that sit in front of the 1-px-wide pixels of `part`, most pixels first. */
export function thinOccluders (g: GBuffer, m: Mannequin, part: string): string[] {
  const target = m.parts.findIndex(p => p.name === part)
  const counts = new Map<number, number>()
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const i = y * g.width + x
      if (g.part[i] !== target || !isThinPixel(g, x, y, target, g.depth[i])) continue
      const front = new Set<number>()
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (x + dx < 0 || y + dy < 0 || x + dx >= g.width || y + dy >= g.height) continue
          const j = (y + dy) * g.width + x + dx
          if (g.part[j] !== EMPTY && g.part[j] !== target && g.depth[j] < g.depth[i]) front.add(g.part[j])
        }
      }
      for (const q of front) counts.set(q, (counts.get(q) ?? 0) + 1)
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([q]) => m.parts[q].name)
}
