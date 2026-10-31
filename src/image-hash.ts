import { createHash } from 'node:crypto'
import type { Image } from './image.ts'

export function imageHash (img: Image): string {
  return createHash('sha256').update(`${img.width}x${img.height}`).update(img.data).digest('hex')
}
