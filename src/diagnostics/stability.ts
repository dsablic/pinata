import { getPixel, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import { EMPTY } from '../raster/gbuffer.ts'
import type { GBuffer } from '../raster/gbuffer.ts'

export const MIN_PART_PIXELS = 8

type PartMap = Pick<GBuffer, 'width' | 'height' | 'part'>
type Extent = { count: number, minX: number, maxX: number, minY: number, maxY: number }

/**
 * Per frame k with neighbours, the pixels that are colour A at k-1, a different colour at k and A again at k+1,
 * as a fraction of the silhouette area at k. The worst frame; 0 for fewer than three frames.
 */
export function flickerFraction (images: Image[]): number {
  let worst = 0
  for (let k = 1; k + 1 < images.length; k++) {
    const [before, now, after] = [images[k - 1], images[k], images[k + 1]]
    let area = 0
    let flicker = 0
    for (let y = 0; y < now.height; y++) {
      for (let x = 0; x < now.width; x++) {
        const c = getPixel(now, x, y)
        if (c !== TRANSPARENT) area++
        const a = getPixel(before, x, y)
        if (c !== a && getPixel(after, x, y) === a) flicker++
      }
    }
    if (area > 0) worst = Math.max(worst, flicker / area)
  }
  return worst
}

function extents (map: PartMap): Map<number, Extent> {
  const out = new Map<number, Extent>()
  for (let i = 0; i < map.part.length; i++) {
    const p = map.part[i]
    if (p === EMPTY) continue
    const x = i % map.width
    const y = Math.floor(i / map.width)
    const e = out.get(p)
    if (e === undefined) out.set(p, { count: 1, minX: x, maxX: x, minY: y, maxY: y })
    else {
      e.count++
      e.minX = Math.min(e.minX, x)
      e.maxX = Math.max(e.maxX, x)
      e.minY = Math.min(e.minY, y)
      e.maxY = Math.max(e.maxY, y)
    }
  }
  return out
}

function boxMoved (a: Extent, b: Extent): boolean {
  return [a.minX - b.minX, a.maxX - b.maxX, a.minY - b.minY, a.maxY - b.maxY].some(d => Math.abs(d) >= 1)
}

/**
 * The largest relative change in a part's pixel count between consecutive frames, skipping parts under
 * MIN_PART_PIXELS in either frame and frames where the part's bounding box moves by a pixel or more.
 */
export function partAreaJump (maps: PartMap[]): number {
  let worst = 0
  let previous = maps.length > 0 ? extents(maps[0]) : new Map<number, Extent>()
  for (let k = 1; k < maps.length; k++) {
    const current = extents(maps[k])
    for (const [part, e] of current) {
      const p = previous.get(part)
      if (p === undefined || Math.min(p.count, e.count) < MIN_PART_PIXELS || boxMoved(p, e)) continue
      worst = Math.max(worst, Math.abs(e.count - p.count) / p.count)
    }
    previous = current
  }
  return worst
}
