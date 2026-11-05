import { createImage, setPixel } from '../image.ts'
import type { Image } from '../image.ts'

export const GLYPH_WIDTH = 3
export const GLYPH_HEIGHT = 5
const ADVANCE = GLYPH_WIDTH + 1

const GLYPHS: Record<string, string[]> = {
  a: ['.#.', '#.#', '###', '#.#', '#.#'],
  b: ['##.', '#.#', '##.', '#.#', '##.'],
  c: ['.##', '#..', '#..', '#..', '.##'],
  e: ['###', '#..', '##.', '#..', '###'],
  f: ['###', '#..', '##.', '#..', '#..'],
  g: ['.##', '#..', '#.#', '#.#', '.##'],
  h: ['#.#', '#.#', '###', '#.#', '#.#'],
  i: ['###', '.#.', '.#.', '.#.', '###'],
  k: ['#.#', '#.#', '##.', '#.#', '#.#'],
  l: ['#..', '#..', '#..', '#..', '###'],
  n: ['##.', '#.#', '#.#', '#.#', '#.#'],
  o: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  r: ['##.', '#.#', '##.', '#.#', '#.#'],
  t: ['###', '.#.', '.#.', '.#.', '.#.'],
  '-': ['...', '...', '###', '...', '...']
}

export function textWidth (text: string): number {
  return [...text].length * ADVANCE - 1
}

export function textImage (text: string, colour: number): Image {
  const image = createImage(textWidth(text), GLYPH_HEIGHT)
  ;[...text].forEach((char, i) => {
    const glyph = GLYPHS[char]
    if (glyph === undefined) throw new RangeError(`no pixel glyph for '${char}'`)
    glyph.forEach((row, y) => [...row].forEach((on, x) => {
      if (on === '#') setPixel(image, i * ADVANCE + x, y, colour)
    }))
  })
  return image
}
