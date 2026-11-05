import { createImage, getPixel, setPixel, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'

export type Clip = { name: string, frames: Image[], fps: number }
export type Box = { left: number, top: number, right: number, bottom: number }

export const COMMON_FPS = 12
export const MOST_FRAMES = 16

export function boxOf (frames: Image[]): Box | undefined {
  let box: Box | undefined
  for (const image of frames) {
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        if (getPixel(image, x, y) === TRANSPARENT) continue
        box = box === undefined
          ? { left: x, top: y, right: x, bottom: y }
          : { left: Math.min(box.left, x), top: Math.min(box.top, y), right: Math.max(box.right, x),
            bottom: Math.max(box.bottom, y) }
      }
    }
  }
  return box
}

export function isEmpty (image: Image): boolean {
  return boxOf([image]) === undefined
}

export function crop (image: Image, box: Box): Image {
  const out = createImage(box.right - box.left + 1, box.bottom - box.top + 1)
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) setPixel(out, x, y, getPixel(image, box.left + x, box.top + y))
  }
  return out
}

export function sliceSheet (sheet: Image, cellWidth: number, cellHeight: number, row = 0): Image[] {
  const cells = Math.floor(sheet.width / cellWidth)
  return Array.from({ length: cells }, (_, i) => {
    const box = { left: i * cellWidth, top: row * cellHeight, right: (i + 1) * cellWidth - 1,
      bottom: (row + 1) * cellHeight - 1 }
    return crop(sheet, box)
  }).filter(frame => !isEmpty(frame))
}

export function commonBox (clips: Clip[]): Box {
  const box = boxOf(clips.flatMap(clip => clip.frames))
  if (box === undefined) throw new Error('every frame is empty')
  return box
}

export function cropAll (clip: Clip, box: Box): Clip {
  return { ...clip, frames: clip.frames.map(frame => crop(frame, box)) }
}

export function overlay (layers: Image[]): Image {
  const out = createImage(layers[0].width, layers[0].height)
  for (const layer of layers) {
    for (let y = 0; y < layer.height; y++) {
      for (let x = 0; x < layer.width; x++) {
        const rgb = getPixel(layer, x, y)
        if (rgb !== TRANSPARENT) setPixel(out, x, y, rgb)
      }
    }
  }
  return out
}

export function atRate (clip: Clip, fps: number, most: number): Clip {
  const count = Math.max(1, Math.min(most, Math.floor(clip.frames.length * fps / clip.fps)))
  const frames = Array.from({ length: count }, (_, i) => clip.frames[Math.floor(i * clip.fps / fps)])
  return { ...clip, frames, fps }
}

export function grid (frames: Image[], perRow: number, gap: number): Image {
  const [width, height] = [frames[0].width, frames[0].height]
  const rows = Math.ceil(frames.length / perRow)
  const columns = Math.min(perRow, frames.length)
  const out = createImage(columns * width + (columns - 1) * gap, rows * height + (rows - 1) * gap)
  frames.forEach((frame, i) => {
    const [ox, oy] = [(i % perRow) * (width + gap), Math.floor(i / perRow) * (height + gap)]
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) setPixel(out, ox + x, oy + y, getPixel(frame, x, y))
    }
  })
  return out
}
