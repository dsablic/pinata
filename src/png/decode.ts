import { inflateSync } from 'node:zlib'
import { createImage } from '../image.ts'
import type { Image } from '../image.ts'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

type Header = { width: number, height: number, depth: number, colour: number, interlace: number }

function paeth (a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/** Undoes the per-row filters; returns the raw samples, one row of `stride` bytes after another. */
function unfilter (data: Buffer, header: Header): Uint8Array {
  const bits = CHANNELS[header.colour] * header.depth
  const stride = Math.ceil(header.width * bits / 8)
  const step = Math.max(1, bits / 8)
  const out = new Uint8Array(stride * header.height)
  for (let y = 0; y < header.height; y++) {
    const type = data[y * (stride + 1)]
    const row = data.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const at = y * stride
    for (let x = 0; x < stride; x++) {
      const left = x >= step ? out[at + x - step] : 0
      const up = y > 0 ? out[at - stride + x] : 0
      const corner = x >= step && y > 0 ? out[at - stride + x - step] : 0
      const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, corner)][type]
      if (predictor === undefined) throw new Error(`unknown PNG filter type ${type}`)
      out[at + x] = (row[x] + predictor) & 0xff
    }
  }
  return out
}

function sample (raw: Uint8Array, header: Header, x: number, y: number, channel: number): number {
  const channels = CHANNELS[header.colour]
  const stride = Math.ceil(header.width * channels * header.depth / 8)
  if (header.depth === 8) return raw[y * stride + x * channels + channel]
  const at = y * stride + (x * channels + channel) * 2
  if (header.depth === 16) return raw[at] * 256 + raw[at + 1]
  const perByte = 8 / header.depth
  const byte = raw[y * stride + Math.floor(x / perByte)]
  const shift = 8 - header.depth * (x % perByte + 1)
  return (byte >> shift) & ((1 << header.depth) - 1)
}

/**
 * Decodes a non-interlaced PNG of any colour type and bit depth into an RGBA image, scaling samples to 8 bits and
 * applying tRNS transparency (palette alpha, or the transparent grey or RGB colour).
 */
export function decodePng (bytes: Uint8Array): Image {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (!SIGNATURE.every((b, i) => buffer[i] === b)) throw new Error('not a PNG file')
  let header: Header | undefined
  let palette: Uint8Array = new Uint8Array(0)
  let alpha: Uint8Array = new Uint8Array(0)
  const parts: Buffer[] = []
  for (let at = 8; at < buffer.length;) {
    const length = buffer.readUInt32BE(at)
    const type = buffer.toString('ascii', at + 4, at + 8)
    const body = buffer.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], colour: body[9], interlace: body[12]
      }
    } else if (type === 'PLTE') palette = body
    else if (type === 'tRNS') alpha = body
    else if (type === 'IDAT') parts.push(body)
    else if (type === 'IEND') break
    at += 12 + length
  }
  if (header === undefined) throw new Error('PNG has no IHDR chunk')
  if (header.interlace !== 0) throw new Error('interlaced PNGs are not supported')
  if (CHANNELS[header.colour] === undefined) throw new Error(`unknown PNG colour type ${header.colour}`)
  const raw = unfilter(inflateSync(Buffer.concat(parts)), header)
  const image = createImage(header.width, header.height)
  const max = (1 << header.depth) - 1
  const to8 = (v: number): number => header.depth === 8 ? v : Math.round(v * 255 / max)
  const keyed = header.colour === 0 || header.colour === 2
  const key = keyed && alpha.length >= (header.colour === 0 ? 2 : 6)
    ? Array.from({ length: header.colour === 0 ? 1 : 3 }, (_, k) => alpha[2 * k] * 256 + alpha[2 * k + 1])
    : undefined
  for (let y = 0; y < header.height; y++) {
    for (let x = 0; x < header.width; x++) {
      const s = (channel: number): number => sample(raw, header, x, y, channel)
      let rgba: [number, number, number, number]
      if (header.colour === 3) {
        const index = s(0)
        rgba = [palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2], alpha[index] ?? 255]
      } else if (header.colour === 0 || header.colour === 4) {
        const grey = to8(s(0))
        const opaque = key === undefined || s(0) !== key[0]
        rgba = [grey, grey, grey, header.colour === 4 ? to8(s(1)) : opaque ? 255 : 0]
      } else {
        const opaque = key === undefined || [0, 1, 2].some(k => s(k) !== key[k])
        rgba = [to8(s(0)), to8(s(1)), to8(s(2)), header.colour === 6 ? to8(s(3)) : opaque ? 255 : 0]
      }
      image.data.set(rgba, (y * header.width + x) * 4)
    }
  }
  return image
}
