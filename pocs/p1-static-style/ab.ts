import { createHash } from 'node:crypto'

export type Side = 'left' | 'right'
export type AbPlan = { pair: number, ref: string, frame: string, ours: Side }

const SMALL_REFERENCE_HEIGHT = 40
const ELEVATION = 30
const DIRECTIONS = [0, 1, 7]
const PNG_HEIGHT_OFFSET = 20

export function pngHeight (bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(PNG_HEIGHT_OFFSET)
}

export function frameFor (referenceHeight: number, index: number): string {
  const size = referenceHeight < SMALL_REFERENCE_HEIGHT ? 32 : 48
  return `${size}px-el${ELEVATION}-d${DIRECTIONS[index % DIRECTIONS.length]}`
}

export function planAb (refs: Array<{ name: string, height: number }>): AbPlan[] {
  const hash = (name: string): string => createHash('sha256').update(name).digest('hex')
  const ordered = [...refs].sort((a, b) => hash(a.name).localeCompare(hash(b.name)))
  return ordered.map((r, i) => ({
    pair: i + 1,
    ref: r.name,
    frame: frameFor(r.height, i),
    ours: i % 2 === 0 ? 'left' : 'right'
  }))
}
