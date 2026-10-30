import { createImage, setPixel } from '../image.ts'
import type { Image } from '../image.ts'

const BACKGROUND = 0xffffff
const AXIS = 0x000000
const ZERO_LINE = 0xbbbbbb

export function line (img: Image, x0: number, y0: number, x1: number, y1: number, rgb: number): void {
  let x = Math.round(x0)
  let y = Math.round(y0)
  const xEnd = Math.round(x1)
  const yEnd = Math.round(y1)
  const dx = Math.abs(xEnd - x)
  const dy = -Math.abs(yEnd - y)
  const sx = x < xEnd ? 1 : -1
  const sy = y < yEnd ? 1 : -1
  let error = dx + dy
  for (;;) {
    setPixel(img, x, y, rgb)
    if (x === xEnd && y === yEnd) return
    const doubled = 2 * error
    if (doubled >= dy) {
      error += dy
      x += sx
    }
    if (doubled <= dx) {
      error += dx
      y += sy
    }
  }
}

export function disc (img: Image, cx: number, cy: number, r: number, rgb: number): void {
  const x0 = Math.round(cx)
  const y0 = Math.round(cy)
  const reach = Math.ceil(r)
  for (let y = y0 - reach; y <= y0 + reach; y++) {
    for (let x = x0 - reach; x <= x0 + reach; x++) {
      if ((x - x0) ** 2 + (y - y0) ** 2 <= r * r) setPixel(img, x, y, rgb)
    }
  }
}

export type Series = { values: number[], rgb: number }
export type PlotOptions = { width: number, height: number, yMin: number, yMax: number }

export function plot (series: Series[], options: PlotOptions): Image {
  const { width, height, yMin, yMax } = options
  const img = createImage(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) setPixel(img, x, y, BACKGROUND)
  }
  const margin = Math.max(2, Math.round(Math.min(width, height) * 0.08))
  const left = margin
  const right = width - 1 - margin
  const top = margin
  const bottom = height - 1 - margin
  const toY = (v: number): number => {
    const clamped = Math.min(yMax, Math.max(yMin, v))
    return bottom - (clamped - yMin) / (yMax - yMin) * (bottom - top)
  }
  if (yMin < 0 && yMax > 0) line(img, left, toY(0), right, toY(0), ZERO_LINE)
  line(img, left, top, left, bottom, AXIS)
  line(img, left, bottom, right, bottom, AXIS)
  for (const { values, rgb } of series) {
    const span = right - left - 1
    const toX = (i: number): number => left + 1 + (values.length === 1 ? 0 : i / (values.length - 1) * span)
    values.forEach((v, i) => {
      if (values.length === 1) disc(img, toX(0), toY(v), 1, rgb)
      else if (i > 0) line(img, toX(i - 1), toY(values[i - 1]), toX(i), toY(v), rgb)
    })
  }
  return img
}
