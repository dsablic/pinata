import { createHash } from 'node:crypto'

export type Image = { width: number, height: number, data: Uint8ClampedArray }

export const TRANSPARENT = -1

const OFFSETS_4: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const OFFSETS_8: Array<[number, number]> = [...OFFSETS_4, [1, 1], [1, -1], [-1, 1], [-1, -1]]

export function createImage (width: number, height: number): Image {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

export function parseHex (hex: string): number {
  return Number.parseInt(hex.slice(1), 16)
}

export function getPixel (img: Image, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return TRANSPARENT
  const i = (y * img.width + x) * 4
  if (img.data[i + 3] === 0) return TRANSPARENT
  return (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]
}

export function setPixel (img: Image, x: number, y: number, rgb: number): void {
  const i = (y * img.width + x) * 4
  if (rgb === TRANSPARENT) {
    img.data.fill(0, i, i + 4)
    return
  }
  img.data[i] = (rgb >> 16) & 0xff
  img.data[i + 1] = (rgb >> 8) & 0xff
  img.data[i + 2] = rgb & 0xff
  img.data[i + 3] = 255
}

export function neighbours4 (img: Image, x: number, y: number): number[] {
  return OFFSETS_4.map(([dx, dy]) => getPixel(img, x + dx, y + dy))
}

export function neighbours8 (img: Image, x: number, y: number): number[] {
  return OFFSETS_8.map(([dx, dy]) => getPixel(img, x + dx, y + dy))
}

export function imageHash (img: Image): string {
  return createHash('sha256').update(`${img.width}x${img.height}`).update(img.data).digest('hex')
}
