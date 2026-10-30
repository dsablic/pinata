import { gate, P1_GATES } from '../../pocs/p1-static-style/gates.ts'
import { createImage } from '../image.ts'
import type { Image } from '../image.ts'
import type { Mannequin, Part } from '../formats/mannequin.ts'
import type { Style } from '../formats/style.ts'
import { fitCamera } from '../raster/camera.ts'
import type { Camera } from '../raster/camera.ts'
import { EMPTY, rasterize } from '../raster/gbuffer.ts'
import type { GBuffer } from '../raster/gbuffer.ts'
import { stylize } from '../style/stylize.ts'
import { sheet } from '../diagnostics/images.ts'
import { outlineGaps, paletteSize, strayPixelIndices, thinParts } from '../diagnostics/metrics.ts'
import type { ThinPart } from '../diagnostics/metrics.ts'
import type { Check } from './summary.ts'

export const SIZES = [32, 48]
export const ELEVATIONS = [0, 30]
export const DIRECTIONS = 8
const MARGIN = 4
const SHEET_SCALE = 8
const SHEET_BACKGROUND = 0xc8c8c8
const MIN_PIXELS_FOR_THIN = 4
const THIN_PIXELS = 2
const SHOWN_THIN_PARTS = 3
const SHOWN_STRAY_PARTS = 3

export type StaticFrame = {
  id: string
  size: number
  elevation: number
  direction: number
  camera: Camera
  gbuffer: GBuffer
  image: Image
  decalMask: Uint8Array
  outlineMask: Uint8Array
}

type FrameMetrics = { frame: StaticFrame, gaps: number, strays: number[], thin: ThinPart[] }

export function renderStatic (mannequin: Mannequin, style: Style): StaticFrame[] {
  return SIZES.flatMap(size => ELEVATIONS.flatMap(elevation => {
    return Array.from({ length: DIRECTIONS }, (_, direction) => {
      const camera = fitCamera(mannequin, {
        azimuthDeg: direction * 45, elevationDeg: elevation, targetHeightPx: size, margin: MARGIN
      })
      const gbuffer = rasterize(mannequin, camera)
      const { image, decalMask, outlineMask } = stylize(gbuffer, mannequin, camera, style)
      return { id: `${size}px-el${elevation}-d${direction}`, size, elevation, direction, camera, gbuffer, image,
        decalMask, outlineMask }
    })
  }))
}

export function contactSheet (frames: StaticFrame[]): Image {
  const rows = SIZES.flatMap(size => ELEVATIONS.map(elevation => {
    return frames.filter(f => f.size === size && f.elevation === elevation)
  }))
  const cells = rows.map(row => row.map(f => {
    return { image: f.image, anchor: [f.camera.width / 2, f.camera.baseline] as [number, number] }
  }))
  if (cells.length === 0) return createImage(1, 1)
  return sheet(cells, { scale: SHEET_SCALE, gap: SHEET_SCALE, background: SHEET_BACKGROUND })
}

function dimensions (part: Part): { across: number, text: string } {
  if (part.shape === 'capsule') {
    const text = `capsule, radii ${part.radiusA} and ${part.radiusB}`
    return { across: 2 * Math.min(part.radiusA, part.radiusB), text }
  }
  return { across: Math.min(part.width, part.thickness), text: `box, width ${part.width}, thickness ${part.thickness}` }
}

function metres (value: number): string {
  return `${(Math.ceil(value * 100) / 100).toFixed(2)} m`
}

function directionName (direction: number): string {
  return ['front', 'front-left', 'left side', 'back-left', 'back', 'back-right', 'right side', 'front-right'][direction]
}

function describe (f: StaticFrame): string {
  return `${f.size}px, elevation ${f.elevation}, direction ${f.direction} (${directionName(f.direction)})`
}

function thinHint (worst: FrameMetrics, mannequin: Mannequin): string {
  const { frame } = worst
  const bad = worst.thin.filter(p => p.thinFraction > P1_GATES.maxThinFraction.threshold)
    .sort((a, b) => b.thinFraction - a.thinFraction).slice(0, SHOWN_THIN_PARTS)
  const needed = THIN_PIXELS * mannequin.height / frame.size
  const parts = bad.map(p => {
    const part = mannequin.parts.find(q => q.name === p.part) as Part
    const { across, text } = dimensions(part)
    return `'${p.part}' (${(p.thinFraction * 100).toFixed(0)}% of its pixels are 1px wide, about ${metres(across)} ` +
      `across; ${text})`
  })
  return `thin parts at ${describe(frame)}: ${parts.join('; ')}. At ${frame.size}px one pixel is ` +
    `${(mannequin.height / frame.size).toFixed(3)} m, so make each at least ${metres(needed)} across ` +
    '(raise radiusA and radiusB, or width and thickness), or set allowThin: true on the part if it is meant ' +
    'to be a thin line such as a blade or a cord.'
}

function ownerOf (frame: StaticFrame, index: number, mannequin: Mannequin): string {
  const { width, height, part } = frame.gbuffer
  const x = index % width
  const y = Math.floor(index / width)
  for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const nx = x + dx
    const ny = y + dy
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
    const p = part[ny * width + nx]
    if (p !== EMPTY) return mannequin.parts[p].name
  }
  return 'outline'
}

function strayHint (worst: FrameMetrics, mannequin: Mannequin): string {
  const counts = new Map<string, number>()
  for (const i of worst.strays) {
    const name = ownerOf(worst.frame, i, mannequin)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, SHOWN_STRAY_PARTS)
    .map(([name, n]) => `'${name}' (${n})`).join(', ')
  return `${worst.strays.length} isolated pixels at ${describe(worst.frame)}, from part ${top}. These are ` +
    'parts smaller than a pixel or mostly hidden behind a neighbour: make them at least ' +
    `${metres(THIN_PIXELS * mannequin.height / worst.frame.size)} across, merge them into a neighbouring part, or ` +
    'draw a deliberate single-pixel feature as a decal.'
}

function paletteHint (mannequin: Mannequin, style: Style, count: number): string {
  const uses = new Map<string, number>()
  for (const part of mannequin.parts) uses.set(part.material, (uses.get(part.material) ?? 0) + 1)
  const ramps = [...uses].map(([name, n]) => `'${name}' (${style.materials[name]?.length ?? 0} colours, ${n} parts)`)
  const decals = new Set(mannequin.decals.flatMap(d => [...d.pattern.join('')]).filter(c => c !== '.')).size
  return `${count} distinct colours over all views. Parts use ${ramps.join(', ')}, plus the outline colour and ` +
    `${decals} decal colours. Give parts the same material where the look allows it, drop an unused ramp colour from ` +
    'style.json materials, or use fewer decal colours.'
}

function worstBy (items: FrameMetrics[], value: (m: FrameMetrics) => number): FrameMetrics {
  return items.reduce((a, b) => value(b) > value(a) ? b : a)
}

export function staticChecks (mannequin: Mannequin, style: Style, frames: StaticFrame[]): Check[] {
  const all: FrameMetrics[] = frames.map(frame => ({
    frame,
    gaps: outlineGaps(frame.image, frame.outlineMask),
    strays: strayPixelIndices(frame.image, frame.decalMask),
    thin: thinParts(frame.gbuffer, mannequin).filter(p => p.pixels >= MIN_PIXELS_FOR_THIN)
  }))
  const thinness = (m: FrameMetrics): number => Math.max(0, ...m.thin.map(p => p.thinFraction))
  const gapped = worstBy(all, m => m.gaps)
  const thinnest = worstBy(all, thinness)
  const strayed = worstBy(all, m => m.strays.length)
  const palette = paletteSize(frames.map(f => f.image))
  return [
    {
      gate: gate('outlineGaps', gapped.gaps),
      hint: () => `${gapped.gaps} outline gaps at ${describe(gapped.frame)}: the silhouette touches the image edge, ` +
        'so something is clipped. Check mannequin height against the real top-to-bottom extent of the parts (a part ' +
        'far above or below the figure makes the camera crop), and that no part is a huge outlier.'
    },
    { gate: gate('maxThinFraction', thinness(thinnest)), hint: () => thinHint(thinnest, mannequin) },
    { gate: gate('paletteSize', palette), hint: () => paletteHint(mannequin, style, palette) },
    { gate: gate('maxStrayPixels', strayed.strays.length), hint: () => strayHint(strayed, mannequin) }
  ]
}
