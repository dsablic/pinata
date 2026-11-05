import { sheet } from '../diagnostics/images.ts'
import { GLYPH_HEIGHT, textImage } from '../diagnostics/pixel-text.ts'
import { DIRECTIONS } from '../export/directions.ts'
import { record } from '../export/record.ts'
import type { Subject } from '../export/record.ts'
import { trackOf } from '../export/strip.ts'
import { createImage, getPixel, setPixel, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'

export const SHEET_LOOK = { scale: 6, gap: 6, background: 0xc8c8c8 }
const LABEL_COLOUR = 0x202020
const LABEL_GAP = 2
const LABEL_PAD = 4

function labelled (picture: Image, label: string): Image {
  const text = textImage(label, LABEL_COLOUR)
  const out = createImage(Math.max(picture.width, text.width + LABEL_PAD), GLYPH_HEIGHT + LABEL_GAP + picture.height)
  const copy = (from: Image, left: number, top: number): void => {
    for (let y = 0; y < from.height; y++) {
      for (let x = 0; x < from.width; x++) {
        const rgb = getPixel(from, x, y)
        if (rgb !== TRANSPARENT) setPixel(out, left + x, top + y, rgb)
      }
    }
  }
  copy(text, 0, 0)
  copy(picture, Math.floor((out.width - picture.width) / 2), GLYPH_HEIGHT + LABEL_GAP)
  return out
}

export function idleDirectionsSheet (subject: Subject): Image {
  const recording = record(subject, ['idle'])
  const cells = DIRECTIONS.map(direction => {
    const picture = trackOf(recording.tracks, 'idle', direction).frames[0].image
    return { image: labelled(picture, direction), anchor: [0, 0] as [number, number] }
  })
  return sheet([cells], SHEET_LOOK)
}
