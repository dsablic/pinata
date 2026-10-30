import { createImage, getPixel, setPixel, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import { EMPTY } from '../raster/gbuffer.ts'
import type { GBuffer } from '../raster/gbuffer.ts'

const PART_COLOURS = [
  0xe6194b, 0x3cb44b, 0xffe119, 0x4363d8, 0xf58231, 0x911eb4, 0x46f0f0, 0xf032e6,
  0xbcf60c, 0xfabebe, 0x008080, 0xe6beff, 0x9a6324, 0x800000, 0xaaffc3, 0x808000
]

export type SheetOptions = { scale: number, gap: number, background: number }

export function sheet (rows: Image[][], options: SheetOptions): Image {
  const { scale, gap, background } = options
  const cells = rows.flat()
  const cellWidth = Math.max(...cells.map(c => c.width)) * scale
  const cellHeight = Math.max(...cells.map(c => c.height)) * scale
  const cols = Math.max(...rows.map(r => r.length))
  const out = createImage(cols * cellWidth + (cols + 1) * gap, rows.length * cellHeight + (rows.length + 1) * gap)
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) setPixel(out, x, y, background)
  }
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      const ox = gap + c * (cellWidth + gap)
      const oy = gap + r * (cellHeight + gap)
      for (let y = 0; y < cell.height * scale; y++) {
        for (let x = 0; x < cell.width * scale; x++) {
          const rgb = getPixel(cell, Math.floor(x / scale), Math.floor(y / scale))
          if (rgb !== TRANSPARENT) setPixel(out, ox + x, oy + y, rgb)
        }
      }
    })
  })
  return out
}

function fromGBuffer (g: GBuffer, colour: (i: number) => number): Image {
  const out = createImage(g.width, g.height)
  for (let i = 0; i < g.part.length; i++) {
    if (g.part[i] !== EMPTY) setPixel(out, i % g.width, Math.floor(i / g.width), colour(i))
  }
  return out
}

export function partImage (g: GBuffer): Image {
  return fromGBuffer(g, i => PART_COLOURS[g.part[i] % PART_COLOURS.length])
}

export function normalImage (g: GBuffer): Image {
  const channel = (v: number) => Math.round((v * 0.5 + 0.5) * 255)
  return fromGBuffer(g, i => {
    return (channel(g.normal[i * 3]) << 16) | (channel(g.normal[i * 3 + 1]) << 8) | channel(g.normal[i * 3 + 2])
  })
}

export function depthImage (g: GBuffer): Image {
  let near = Infinity
  let far = -Infinity
  for (let i = 0; i < g.part.length; i++) {
    if (g.part[i] === EMPTY) continue
    near = Math.min(near, g.depth[i])
    far = Math.max(far, g.depth[i])
  }
  const span = far - near || 1
  return fromGBuffer(g, i => {
    const v = Math.round(255 - ((g.depth[i] - near) / span) * 200)
    return (v << 16) | (v << 8) | v
  })
}
