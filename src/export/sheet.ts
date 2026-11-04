import { sheet } from '../diagnostics/images.ts'
import { TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import { encodePng } from '../png/encode.ts'
import { FPS } from '../page/cast.ts'
import type { Recording, Track } from './record.ts'

export type Placement = { track: Track, index: number, x: number, y: number }

export const MOST_SHEET_PX = 4096
const APP = 'https://github.com/dsablic/pinata'
const TRAVEL_DECIMALS = 3

export function tagOf (track: Track): string {
  return `${track.behaviour}-${track.direction}`
}

function columnsOf (recording: Recording): number {
  const columns = Math.floor(MOST_SHEET_PX / recording.cell.width)
  if (columns < 1) throw new Error(`a ${recording.cell.width} px cell does not fit a sheet of ${MOST_SHEET_PX} px`)
  return columns
}

export function placementsOf (recording: Recording): Placement[] {
  const { width, height } = recording.cell
  const columns = columnsOf(recording)
  let row = 0
  const placed = recording.tracks.flatMap(track => {
    const own = track.frames.map((_, index): Placement => {
      return { track, index, x: (index % columns) * width, y: (row + Math.floor(index / columns)) * height }
    })
    row += Math.ceil(track.frames.length / columns)
    return own
  })
  if (row * height > MOST_SHEET_PX) {
    throw new Error(`the sheet needs ${row * height} px of height, at most ${MOST_SHEET_PX}`)
  }
  return placed
}

export function sheetOf (recording: Recording): Image {
  const columns = columnsOf(recording)
  const rows = recording.tracks.flatMap(track => {
    const cells = track.frames.map(frame => ({ image: frame.image, anchor: [0, 0] as [number, number] }))
    const count = Math.ceil(cells.length / columns)
    return Array.from({ length: count }, (_, r) => cells.slice(r * columns, (r + 1) * columns))
  })
  return sheet(rows, { scale: 1, gap: 0, background: TRANSPARENT })
}

export function durationOf (index: number): number {
  return Math.round((index + 1) * 1000 / FPS) - Math.round(index * 1000 / FPS)
}

function rounded (v: number): number {
  return Number(v.toFixed(TRAVEL_DECIMALS)) + 0
}

function frameJson (recording: Recording, at: Placement): string {
  const { width: w, height: h } = recording.cell
  const { track, index } = at
  return JSON.stringify({
    filename: `${tagOf(track)} ${index}`,
    frame: { x: at.x, y: at.y, w, h },
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w, h },
    sourceSize: { w, h },
    duration: durationOf(index),
    travel: track.frames[index].travel.map(rounded)
  })
}

export function asepriteJson (recording: Recording, imageName: string, size: Pick<Image, 'width' | 'height'>): string {
  const { cell } = recording
  let first = 0
  const frameTags = recording.tracks.map(track => {
    const tag = { name: tagOf(track), from: first, to: first + track.frames.length - 1, direction: 'forward' }
    first += track.frames.length
    return tag
  })
  const meta = {
    app: APP,
    version: '1',
    image: imageName,
    format: 'RGBA8888',
    size: { w: size.width, h: size.height },
    scale: '1',
    frameTags,
    slices: [{
      name: 'anchor',
      color: '#0000ffff',
      keys: [{
        frame: 0,
        bounds: { x: 0, y: 0, w: cell.width, h: cell.height },
        pivot: { x: cell.pivot[0], y: cell.pivot[1] }
      }]
    }],
    pinata: {
      character: recording.name,
      fps: FPS,
      spritePerMetre: recording.spritePerMetre,
      loops: recording.tracks.filter(track => track.loop).map(tagOf)
    }
  }
  const frames = placementsOf(recording).map(at => `    ${frameJson(recording, at)}`).join(',\n')
  const head = JSON.stringify(meta, null, 2).split('\n').map((line, i) => i === 0 ? line : `  ${line}`).join('\n')
  return `{\n  "frames": [\n${frames}\n  ],\n  "meta": ${head}\n}\n`
}

export function exportFiles (recording: Recording): Record<string, Uint8Array | string> {
  const image = sheetOf(recording)
  const name = recording.name
  return {
    [`${name}.png`]: encodePng(image),
    [`${name}.json`]: asepriteJson(recording, `${name}.png`, image)
  }
}
