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

export function encodePng (img: Image): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(img.width, 0)
  header.writeUInt32BE(img.height, 4)
  header[8] = 8
  header[9] = 6
  const stride = img.width * 4
  const raw = Buffer.alloc((stride + 1) * img.height)
  for (let y = 0; y < img.height; y++) {
    raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0))
  ])
}
