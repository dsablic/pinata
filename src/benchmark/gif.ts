import { getPixel, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'

const PALETTE_SIZE = 256
const MIN_CODE_SIZE = 8
const MOST_CODE_BITS = 12
const CLEAR = 1 << MIN_CODE_SIZE
const END = CLEAR + 1
const BLOCK = 255

function quantised (rgb: number, step: number): number {
  const channel = (shift: number): number => Math.min(255, Math.round(((rgb >> shift) & 0xff) / step) * step)
  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

function paletteFor (frames: Image[], background: number): { colours: number[], step: number } {
  for (let step = 1; ; step *= 2) {
    const seen = new Set<number>([quantised(background, step)])
    for (const frame of frames) {
      for (let y = 0; y < frame.height; y++) {
        for (let x = 0; x < frame.width; x++) {
          const rgb = getPixel(frame, x, y)
          if (rgb !== TRANSPARENT) seen.add(quantised(rgb, step))
        }
      }
    }
    if (seen.size <= PALETTE_SIZE) return { colours: [...seen], step }
  }
}

function lzw (indices: Uint8Array): number[] {
  const out: number[] = []
  let [buffer, bits, size] = [0, 0, MIN_CODE_SIZE + 1]
  const emit = (code: number): void => {
    buffer |= code << bits
    bits += size
    while (bits >= 8) {
      out.push(buffer & 0xff)
      buffer >>>= 8
      bits -= 8
    }
  }
  let table = new Map<number, number>()
  let next = END + 1
  emit(CLEAR)
  let prefix = indices[0]
  for (let i = 1; i < indices.length; i++) {
    const key = prefix * PALETTE_SIZE + indices[i]
    const known = table.get(key)
    if (known !== undefined) {
      prefix = known
      continue
    }
    emit(prefix)
    if (next < (1 << MOST_CODE_BITS)) {
      table.set(key, next++)
      if (next > (1 << size) && size < MOST_CODE_BITS) size++
    } else {
      emit(CLEAR)
      table = new Map()
      next = END + 1
      size = MIN_CODE_SIZE + 1
    }
    prefix = indices[i]
  }
  emit(prefix)
  emit(END)
  if (bits > 0) out.push(buffer & 0xff)
  return out
}

function blocks (bytes: number[]): Buffer {
  const parts: Buffer[] = []
  for (let i = 0; i < bytes.length; i += BLOCK) {
    const chunk = Buffer.from(bytes.slice(i, i + BLOCK))
    parts.push(Buffer.from([chunk.length]), chunk)
  }
  parts.push(Buffer.from([0]))
  return Buffer.concat(parts)
}

function word (value: number): number[] {
  return [value & 0xff, value >> 8]
}

export function encodeGif (frames: Image[], delayCentiseconds: number, background: number): Buffer {
  const { width, height } = frames[0]
  const { colours, step } = paletteFor(frames, background)
  const index = new Map(colours.map((rgb, i) => [rgb, i]))
  const table = Array.from({ length: PALETTE_SIZE }, (_, i) => {
    const rgb = colours[i] ?? 0
    return [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff]
  }).flat()
  const parts: Buffer[] = [
    Buffer.from([...Buffer.from('GIF89a'), ...word(width), ...word(height), 0xf7, 0, 0, ...table]),
    Buffer.from([0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0])
  ]
  for (const frame of frames) {
    const indices = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const rgb = getPixel(frame, x, y)
        indices[y * width + x] = index.get(quantised(rgb === TRANSPARENT ? background : rgb, step)) as number
      }
    }
    parts.push(
      Buffer.from([0x21, 0xf9, 4, 0, ...word(delayCentiseconds), 0, 0]),
      Buffer.from([0x2c, 0, 0, 0, 0, ...word(width), ...word(height), 0, MIN_CODE_SIZE]),
      blocks(lzw(indices))
    )
  }
  parts.push(Buffer.from([0x3b]))
  return Buffer.concat(parts)
}
