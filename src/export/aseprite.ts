import { deflateSync } from 'node:zlib'
import type { Image } from '../image.ts'
import type { Recording } from './record.ts'
import { durationOf, tagOf } from './sheet.ts'

const FILE_MAGIC = 0xa5e0
const FRAME_MAGIC = 0xf1fa
const HEADER_BYTES = 128
const FRAME_HEADER_BYTES = 16
const CHUNK_HEADER_BYTES = 6
const LAYER = 0x2004
const CEL = 0x2005
const TAGS = 0x2018
const SLICE = 0x2022
const RGBA = 32
const LAYER_OPACITY_VALID = 1
const LAYER_VISIBLE_EDITABLE = 3
const COMPRESSED_CEL = 2
const SLICE_HAS_PIVOT = 2
const FORWARD = 0
const OPAQUE = 255
const GRID = 16

function field (size: number, write: (buffer: Buffer) => void): Buffer {
  const buffer = Buffer.alloc(size)
  write(buffer)
  return buffer
}

const u8 = (v: number): Buffer => field(1, b => b.writeUInt8(v))
const u16 = (v: number): Buffer => field(2, b => b.writeUInt16LE(v))
const i16 = (v: number): Buffer => field(2, b => b.writeInt16LE(v))
const u32 = (v: number): Buffer => field(4, b => b.writeUInt32LE(v))
const i32 = (v: number): Buffer => field(4, b => b.writeInt32LE(v))
const zeros = (count: number): Buffer => Buffer.alloc(count)

function text (value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8')
  return Buffer.concat([u16(bytes.length), bytes])
}

function chunk (type: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts)
  return Buffer.concat([u32(CHUNK_HEADER_BYTES + body.length), u16(type), body])
}

function layerChunk (): Buffer {
  return chunk(LAYER, u16(LAYER_VISIBLE_EDITABLE), u16(0), u16(0), u16(0), u16(0), u16(0), u8(OPAQUE), zeros(3),
    text('pinata'))
}

function celChunk (image: Image): Buffer {
  const pixels = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength)
  return chunk(CEL, u16(0), i16(0), i16(0), u8(OPAQUE), u16(COMPRESSED_CEL), i16(0), zeros(5),
    u16(image.width), u16(image.height), deflateSync(pixels))
}

function tagsChunk (recording: Recording): Buffer {
  let first = 0
  const tags = recording.tracks.map(track => {
    const from = first
    first += track.frames.length
    return Buffer.concat([u16(from), u16(first - 1), u8(FORWARD), u16(0), zeros(6), zeros(3), zeros(1),
      text(tagOf(track))])
  })
  return chunk(TAGS, u16(tags.length), zeros(8), ...tags)
}

function sliceChunk (recording: Recording): Buffer {
  const { width, height, pivot } = recording.cell
  return chunk(SLICE, u32(1), u32(SLICE_HAS_PIVOT), u32(0), text('anchor'),
    u32(0), i32(0), i32(0), u32(width), u32(height), i32(pivot[0]), i32(pivot[1]))
}

function frameOf (duration: number, chunks: Buffer[]): Buffer {
  const body = Buffer.concat(chunks)
  const count = chunks.length
  return Buffer.concat([u32(FRAME_HEADER_BYTES + body.length), u16(FRAME_MAGIC), u16(Math.min(count, 0xffff)),
    u16(duration), zeros(2), u32(count), body])
}

function headerOf (size: number, frames: number, recording: Recording): Buffer {
  const { width, height } = recording.cell
  return Buffer.concat([u32(size), u16(FILE_MAGIC), u16(frames), u16(width), u16(height), u16(RGBA),
    u32(LAYER_OPACITY_VALID), u16(durationOf(0)), u32(0), u32(0), u8(0), zeros(3), u16(0), u8(1), u8(1),
    i16(0), i16(0), u16(GRID), u16(GRID), zeros(84)])
}

export function asepriteFile (recording: Recording): Buffer {
  const cels = recording.tracks.flatMap(track => track.frames.map((frame, index) => ({
    duration: durationOf(index), cel: celChunk(frame.image)
  })))
  const frames = cels.map(({ duration, cel }, i) => {
    return frameOf(duration, i === 0 ? [layerChunk(), tagsChunk(recording), sliceChunk(recording), cel] : [cel])
  })
  const body = Buffer.concat(frames)
  return Buffer.concat([headerOf(HEADER_BYTES + body.length, frames.length, recording), body])
}
