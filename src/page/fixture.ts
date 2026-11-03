import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Hints } from './dom.ts'
import type { Rect } from './perception.ts'
import type { Box } from './surfaces.ts'

export type Target = { id: string, rect: Rect, say?: string, ground?: string }
export type LaidOutMark = { id: string, box: Box, hints: Hints }
export type LayoutFixture = {
  name: string
  platform: string
  page: string
  width: number
  height: number
  pixelsPerMetre: number
  scale: number
  seed: number
  marks: LaidOutMark[]
  targets: Target[]
}
export type LayoutSpec = Pick<LayoutFixture, 'name' | 'page' | 'width' | 'height' | 'pixelsPerMetre' | 'scale' | 'seed'>

const DEMO = { page: 'index.html?measure', pixelsPerMetre: 54, scale: 2, seed: 3 }

export const LAYOUTS: LayoutSpec[] = [
  { name: 'page-test', page: 'page-test.html', width: 1200, height: 900, pixelsPerMetre: 54, scale: 2, seed: 7 },
  {
    name: 'perception', page: 'perception-test.html', width: 1200, height: 900, pixelsPerMetre: 54, scale: 2, seed: 11
  },
  { name: 'jumps', page: 'jump-test.html', width: 1200, height: 900, pixelsPerMetre: 54, scale: 2, seed: 13 },
  { name: 'demo-1200', width: 1200, height: 900, ...DEMO },
  { name: 'demo-390', width: 390, height: 844, ...DEMO }
]

export function layoutPath (root: string, name: string): string {
  return join(root, 'test', 'fixtures', 'layouts', `${name}.json`)
}

export function readLayout (root: string, name: string): LayoutFixture {
  return JSON.parse(readFileSync(layoutPath(root, name), 'utf8')) as LayoutFixture
}
