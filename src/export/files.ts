import { encodePng } from '../png/encode.ts'
import { asepriteFile } from './aseprite.ts'
import { BEHAVIOURS } from './record.ts'
import type { Behaviour, Recording } from './record.ts'
import { asepriteJson, sheetOf } from './sheet.ts'

export function animationOf (recording: Recording, behaviour: Behaviour): Recording {
  return { ...recording, tracks: recording.tracks.filter(track => track.behaviour === behaviour) }
}

export function exportFiles (recording: Recording): Record<string, Uint8Array | string> {
  const files: Record<string, Uint8Array | string> = {}
  for (const behaviour of BEHAVIOURS.filter(own => recording.tracks.some(track => track.behaviour === own))) {
    const own = animationOf(recording, behaviour)
    const base = `${recording.name}-${behaviour}`
    const image = sheetOf(own)
    files[`${base}.png`] = encodePng(image)
    files[`${base}.json`] = asepriteJson(own, `${base}.png`, image)
    files[`${base}.aseprite`] = asepriteFile(own)
  }
  return files
}
