import { createHash } from 'node:crypto'
import type { Image } from './image.ts'

/** SHA-256 hex digest of an image's size and RGBA bytes (Node only; the browser runtime does not need it). */
export function imageHash (img: Image): string {
  return createHash('sha256').update(`${img.width}x${img.height}`).update(img.data).digest('hex')
}
