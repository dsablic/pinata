import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Image } from '../image.ts'
import { decodePng } from '../png/decode.ts'
import { COMMON_FPS, crop, overlay, sliceSheet } from './frames.ts'
import type { Clip } from './frames.ts'

export type Sheet = { id: string, source: string, file: string, cell: [number, number], fps?: number }

const LUIZ = (pack: string, folder: string): string => join('files', pack, pack, folder)

export const SHEETS: Sheet[] = [
  ...['Idle', 'Run', 'Jump', 'Attack1'].map((name): Sheet => ({
    id: `warrior-${name.toLowerCase()}`, source: 'fantasy-warrior', cell: [162, 162],
    file: join(LUIZ('Fantasy Warrior', 'Sprites'), `${name}.png`)
  })),
  ...['Idle', 'Run', 'Jump', 'Attack'].map((name): Sheet => ({
    id: `huntress-${name.toLowerCase()}`, source: 'huntress-2', cell: [100, 100],
    file: join(LUIZ('Huntress 2', join('Sprites', 'Character')), `${name}.png`)
  })),
  ...['Idle', 'Move', 'Attack'].map((name): Sheet => ({
    id: `wizard-${name.toLowerCase()}`, source: 'evil-wizard', cell: [150, 150],
    file: join(LUIZ('Evil Wizard', 'Sprites'), `${name}.png`)
  }))
]

export const LPC_LAYERS = ['capebg', 'body', 'head', 'pants', 'shirt', 'boots', 'hair', 'capefg']
export const LPC_ROW = 0
const LPC_CELL = 64
const LPC_STANDING = 1

function load (path: string): Image {
  return decodePng(readFileSync(path))
}

export function sheetClip (raw: string, sheet: Sheet): Clip {
  const [width, height] = sheet.cell
  const frames = sliceSheet(load(join(raw, sheet.source, sheet.file)), width, height)
  return { name: sheet.id, frames, fps: sheet.fps ?? COMMON_FPS }
}

export function lpcWalk (raw: string, name: string, layers: string[], frozen: string[] = []): Clip {
  const sheets = layers.map(layer => load(join(raw, 'lpc', 'files', `${layer}.png`)))
  const count = Math.floor(sheets[0].width / LPC_CELL)
  const cell = (sheetIndex: number, i: number): Image => {
    const at = frozen.includes(layers[sheetIndex]) ? LPC_STANDING : i
    const box = { left: at * LPC_CELL, top: LPC_ROW * LPC_CELL, right: (at + 1) * LPC_CELL - 1,
      bottom: (LPC_ROW + 1) * LPC_CELL - 1 }
    return crop(sheets[sheetIndex], box)
  }
  const frames = Array.from({ length: count - LPC_STANDING }, (_, k) => {
    return overlay(layers.map((_, sheetIndex) => cell(sheetIndex, k + LPC_STANDING)))
  })
  return { name, frames, fps: COMMON_FPS }
}

type AsepriteFrame = { frame: { x: number, y: number, w: number, h: number }, duration: number }
type Aseprite = { frames: AsepriteFrame[], meta: { frameTags: { name: string, from: number, to: number }[] } }

export function pinataClip (exported: string, character: string, animation: string, direction = 'right'): Clip {
  const base = join(exported, character, `${character}-${animation}`)
  const data = JSON.parse(readFileSync(`${base}.json`, 'utf8')) as Aseprite
  const tag = data.meta.frameTags.find(t => t.name === `${animation}-${direction}`)
  if (tag === undefined) throw new Error(`no tag ${animation}-${direction} in ${base}.json`)
  const sheet = load(`${base}.png`)
  const picked = data.frames.slice(tag.from, tag.to + 1)
  const frames = picked.map(({ frame }) => {
    return crop(sheet, { left: frame.x, top: frame.y, right: frame.x + frame.w - 1, bottom: frame.y + frame.h - 1 })
  })
  const seconds = picked.reduce((sum, frame) => sum + frame.duration, 0) / 1000
  return { name: `${character}-${animation}`, frames, fps: frames.length / seconds }
}
