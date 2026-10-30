import { deflateSync } from 'node:zlib'
import type { Image } from '../image.ts'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const CRC_TABLE = buildCrcTable()

function buildCrcTable (): Uint32Array {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
}

export function crc32 (bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) {
    c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk (type: string, body: Uint8Array): Buffer {
  const typeAndBody = Buffer.concat([Buffer.from(type, 'ascii'), body])
  const out = Buffer.alloc(8 + body.length + 4)
  out.writeUInt32BE(body.length, 0)
  typeAndBody.copy(out, 4)
  out.writeUInt32BE(crc32(typeAndBody), 8 + body.length)
  return out
}

function header (img: Image): Buffer {
  const out = Buffer.alloc(13)
  out.writeUInt32BE(img.width, 0)
  out.writeUInt32BE(img.height, 4)
  out[8] = 8
  out[9] = 6
  return out
}

function compressed (img: Image): Buffer {
  const stride = img.width * 4
  const raw = Buffer.alloc((stride + 1) * img.height)
  for (let y = 0; y < img.height; y++) {
    raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  return deflateSync(raw, { level: 9 })
}

export function encodePng (img: Image): Buffer {
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header(img)),
    chunk('IDAT', compressed(img)),
    chunk('IEND', new Uint8Array(0))
  ])
}

export type ApngOptions = { delayNum: number, delayDen: number, plays?: number }

function u32 (...values: number[]): Buffer {
  const out = Buffer.alloc(4 * values.length)
  values.forEach((v, i) => out.writeUInt32BE(v, 4 * i))
  return out
}

function frameControl (sequence: number, img: Image, options: ApngOptions): Buffer {
  const delay = Buffer.alloc(4)
  delay.writeUInt16BE(options.delayNum, 0)
  delay.writeUInt16BE(options.delayDen, 2)
  // x offset, y offset, then delay, dispose_op NONE and blend_op SOURCE: every frame replaces the whole canvas.
  return chunk('fcTL', Buffer.concat([u32(sequence, img.width, img.height, 0, 0), delay, Buffer.from([0, 0])]))
}

/**
 * Animated PNG: every frame must have the first frame's size and replaces the whole canvas. The first frame is also
 * the default image, so decoders without APNG support show it. `plays` of 0 loops forever.
 */
export function encodeApng (frames: Image[], options: ApngOptions): Buffer {
  if (frames.length === 0) throw new RangeError('an animation needs at least one frame')
  const [first] = frames
  if (frames.some(f => f.width !== first.width || f.height !== first.height)) {
    throw new RangeError('all frames must have the same size')
  }
  const chunks = [
    SIGNATURE,
    chunk('IHDR', header(first)),
    chunk('acTL', u32(frames.length, options.plays ?? 0))
  ]
  let sequence = 0
  frames.forEach((frame, i) => {
    chunks.push(frameControl(sequence++, frame, options))
    const data = compressed(frame)
    if (i === 0) chunks.push(chunk('IDAT', data))
    else chunks.push(chunk('fdAT', Buffer.concat([u32(sequence++), data])))
  })
  chunks.push(chunk('IEND', new Uint8Array(0)))
  return Buffer.concat(chunks)
}
