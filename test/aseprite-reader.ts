import { inflateSync } from 'node:zlib'

export type AsepriteHeader = {
  width: number
  height: number
  depth: number
  flags: number
  speed: number
  colours: number
  pixelRatio: [number, number]
  grid: { x: number, y: number, width: number, height: number }
}
export type AsepriteLayer = { flags: number, type: number, level: number, blend: number, opacity: number, name: string }
export type AsepriteTag = { name: string, from: number, to: number, direction: number, repeat: number }
export type AsepriteCel = {
  layer: number
  x: number
  y: number
  opacity: number
  z: number
  width: number
  height: number
  rgba: Uint8Array
}
export type AsepriteSlice = { name: string, frame: number, bounds: number[], pivot: number[] | undefined }
export type AsepriteFrame = { duration: number, cels: AsepriteCel[] }
export type AsepriteFile = {
  header: AsepriteHeader
  layers: AsepriteLayer[]
  tags: AsepriteTag[]
  slices: AsepriteSlice[]
  frames: AsepriteFrame[]
}

class Cursor {
  at = 0
  readonly view: DataView
  readonly bytes: Uint8Array

  constructor (bytes: Uint8Array) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  u8 (): number { return this.view.getUint8(this.at++) }
  u16 (): number { const v = this.view.getUint16(this.at, true); this.at += 2; return v }
  i16 (): number { const v = this.view.getInt16(this.at, true); this.at += 2; return v }
  u32 (): number { const v = this.view.getUint32(this.at, true); this.at += 4; return v }
  i32 (): number { const v = this.view.getInt32(this.at, true); this.at += 4; return v }
  skip (count: number): void { this.at += count }
  take (count: number): Uint8Array {
    const v = this.bytes.subarray(this.at, this.at + count)
    this.at += count
    return v
  }

  string (): string { return Buffer.from(this.take(this.u16())).toString('utf8') }
}

function headerOf (c: Cursor): AsepriteHeader {
  c.skip(8)
  const [width, height, depth, flags, speed] = [c.u16(), c.u16(), c.u16(), c.u32(), c.u16()]
  c.skip(4 + 4 + 1 + 3)
  const colours = c.u16()
  const pixelRatio: [number, number] = [c.u8(), c.u8()]
  const grid = { x: c.i16(), y: c.i16(), width: c.u16(), height: c.u16() }
  c.skip(84)
  return { width, height, depth, flags, speed, colours, pixelRatio, grid }
}

function layerOf (c: Cursor): AsepriteLayer {
  const [flags, type, level] = [c.u16(), c.u16(), c.u16()]
  c.skip(4)
  const blend = c.u16()
  const opacity = c.u8()
  c.skip(3)
  return { flags, type, level, blend, opacity, name: c.string() }
}

function celOf (c: Cursor, end: number): AsepriteCel {
  const layer = c.u16()
  const [x, y, opacity, type, z] = [c.i16(), c.i16(), c.u8(), c.u16(), c.i16()]
  c.skip(5)
  if (type !== 2) throw new Error(`cel type ${type} is not a compressed image`)
  const [width, height] = [c.u16(), c.u16()]
  const rgba = new Uint8Array(inflateSync(c.take(end - c.at)))
  if (rgba.length !== width * height * 4) throw new Error('a cel does not hold width x height RGBA pixels')
  return { layer, x, y, opacity, z, width, height, rgba }
}

function tagsOf (c: Cursor): AsepriteTag[] {
  const count = c.u16()
  c.skip(8)
  return Array.from({ length: count }, () => {
    const [from, to, direction, repeat] = [c.u16(), c.u16(), c.u8(), c.u16()]
    c.skip(6 + 3 + 1)
    return { from, to, direction, repeat, name: c.string() }
  })
}

function sliceOf (c: Cursor): AsepriteSlice {
  const [keys, flags] = [c.u32(), c.u32()]
  c.skip(4)
  const name = c.string()
  if (keys !== 1 || flags !== 2) throw new Error('expected one slice key with a pivot')
  const frame = c.u32()
  const bounds = [c.i32(), c.i32(), c.u32(), c.u32()]
  return { name, frame, bounds, pivot: [c.i32(), c.i32()] }
}

export function readAseprite (bytes: Uint8Array): AsepriteFile {
  const c = new Cursor(bytes)
  if (c.u32() !== bytes.length) throw new Error('the file size in the header is wrong')
  if (c.u16() !== 0xa5e0) throw new Error('not an Aseprite file')
  const count = c.u16()
  c.at = 0
  const header = headerOf(c)
  if (c.at !== 128) throw new Error('the header is not 128 bytes')
  const file: AsepriteFile = { header, layers: [], tags: [], slices: [], frames: [] }
  for (let f = 0; f < count; f++) {
    const start: number = c.at
    const size = c.u32()
    if (c.u16() !== 0xf1fa) throw new Error(`frame ${f} has no frame magic`)
    const old = c.u16()
    const duration = c.u16()
    c.skip(2)
    const chunks = c.u32() || old
    const frame: AsepriteFrame = { duration, cels: [] }
    for (let k = 0; k < chunks; k++) {
      const chunkStart = c.at
      const chunkSize = c.u32()
      const type = c.u16()
      if (type === 0x2004) file.layers.push(layerOf(c))
      else if (type === 0x2005) frame.cels.push(celOf(c, chunkStart + chunkSize))
      else if (type === 0x2018) file.tags = tagsOf(c)
      else if (type === 0x2022) file.slices.push(sliceOf(c))
      c.at = chunkStart + chunkSize
    }
    if (c.at !== start + size) throw new Error(`frame ${f} does not end where its header says`)
    file.frames.push(frame)
  }
  if (c.at !== bytes.length) throw new Error('bytes follow the last frame')
  return file
}
