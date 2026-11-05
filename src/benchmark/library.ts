import { dropFrames, removeWindUp, slideFeet } from './degrade.ts'
import type { Degraded } from './degrade.ts'
import { atRate, commonBox, cropAll, COMMON_FPS, MOST_FRAMES } from './frames.ts'
import type { Clip } from './frames.ts'
import { lpcWalk, pinataClip, sheetClip, SHEETS } from './sources.ts'

export type Entry = { set: 'reference' | 'pinata' | 'degraded', clip: Clip }

const LPC_BASE = ['capebg', 'body', 'head', 'pants', 'shirt', 'boots', 'hair', 'capefg']
const LPC_WIZARD = ['capebg', 'body', 'head', 'platelegs', 'plate', 'boots', 'wizhat', 'beard', 'capefg']
const CAPE_LAYERS = ['capebg', 'capefg']
const PINATA_ANIMATIONS = ['idle', 'walk', 'run', 'jump', 'attack']
const PINATA_CHARACTERS = ['knight', 'wizard']

export const FLUIDITY = ['warrior-run', 'huntress-run', 'wizard-move']
export const ENVIRONMENT = ['warrior-run', 'huntress-run', 'wizard-move']
export const ANTICIPATION = ['warrior-attack1', 'huntress-attack', 'wizard-attack']
export const CONTROLS = ['warrior-idle', 'huntress-idle']
export const FROZEN = ['lpc-base', 'lpc-wizard']

export function shown (clip: Clip, box = commonBox([clip])): Clip {
  return atRate(cropAll(clip, box), COMMON_FPS, MOST_FRAMES)
}

export function references (raw: string): Clip[] {
  const sheets = SHEETS.map(sheet => sheetClip(raw, sheet))
  const lpc = [lpcWalk(raw, 'lpc-base', LPC_BASE), lpcWalk(raw, 'lpc-wizard', LPC_WIZARD)]
  return [...sheets, ...lpc].map(clip => shown(clip))
}

export function pinataClips (exported: string): Clip[] {
  return PINATA_CHARACTERS.flatMap(character => {
    return PINATA_ANIMATIONS.map(animation => shown(pinataClip(exported, character, animation)))
  })
}

function sameShape (reference: Clip, copy: Clip): boolean {
  const [x, y] = [reference.frames[0], copy.frames[0]]
  return x.width === y.width && x.height === y.height && reference.frames.length === copy.frames.length &&
    reference.fps === copy.fps
}

function named (reference: Clip, degraded: Degraded): Entry {
  if (!sameShape(reference, degraded.clip)) throw new Error(`${reference.name}: the ${degraded.dimension} copy differs`)
  return { set: 'degraded', clip: { ...degraded.clip, name: `${degraded.dimension}--${reference.name}` } }
}

function frozenCopy (clips: Clip[], raw: string, name: string): Entry {
  const layers: Record<string, string[]> = { 'lpc-base': LPC_BASE, 'lpc-wizard': LPC_WIZARD }
  const box = commonBox([lpcWalk(raw, name, layers[name])])
  const clip = shown(lpcWalk(raw, name, layers[name], CAPE_LAYERS), box)
  return named(clips.find(found => found.name === name) as Clip, { dimension: 'secondary', clip })
}

function degrade (clips: Clip[], names: string[], make: (clip: Clip) => Degraded): Entry[] {
  return names.map(name => {
    const found = clips.find(clip => clip.name === name) as Clip
    return named(found, make(found))
  })
}

export function degradedCopies (clips: Clip[], raw: string): Entry[] {
  return [
    ...degrade(clips, FLUIDITY, dropFrames),
    ...degrade(clips, ENVIRONMENT, slideFeet),
    ...degrade(clips, ANTICIPATION, removeWindUp),
    ...FROZEN.map(name => frozenCopy(clips, raw, name))
  ]
}
