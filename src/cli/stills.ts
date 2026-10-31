import { stride } from '../formats/rig.ts'
import type { Character } from '../formats/character.ts'
import type { Image } from '../image.ts'
import type { LocomotionRecording } from '../motion/metrics.ts'
import { bodyFrameOnionSkin } from '../diagnostics/motion-images.ts'
import { footprintTrace, pixelStrip } from '../diagnostics/locomotion-images.ts'
import type { Mannequin } from '../formats/mannequin.ts'
import type { Recording } from '../sim/metrics.ts'
import { clothParts, withClothParts } from '../sim/render.ts'
import { walkingWindows } from './locomotion.ts'

const FOOTPRINT_SIZE = 384
const CLOTH_SIZE = 384
const CLOTH_EVERY = 2
const MAX_CLOTH_FRAMES = 30
const STRIP = { frames: 8, elevationDeg: 0, targetHeightPx: 48, scale: 6, gap: 4 }

function steadyRange (character: Character, recording: LocomotionRecording): { first: number, last: number } {
  const [window] = walkingWindows(character)
  const fps = recording.fps
  const clamp = (i: number): number => Math.min(recording.frames.length - 1, Math.max(0, i))
  return { first: clamp(Math.round(window.start * fps)), last: clamp(Math.round(window.end * fps)) }
}

export function withSettledCloth (
  character: Character,
  locomotion: LocomotionRecording,
  cloth: Recording
): Mannequin {
  const { first, last } = steadyRange(character, locomotion)
  const frame = Math.round((first + last) / 2)
  const parts = clothParts(character.scenario, cloth.frames[frame].positions, locomotion.frames[frame].root)
  return withClothParts(character.mannequin, parts)
}

export function walkStrip (character: Character, recording: LocomotionRecording, cloth?: Recording): Image {
  const { first, last } = steadyRange(character, recording)
  const [window] = walkingWindows(character)
  const cycle = stride(character.rig.gait, window.speed) / window.speed
  const step = Math.max(1, Math.round(cycle * recording.fps / STRIP.frames))
  const middle = Math.round((first + last) / 2)
  const start = Math.max(0, Math.min(recording.frames.length - 1 - (STRIP.frames - 1) * step, middle - 4 * step))
  return pixelStrip(recording, {
    mannequin: character.mannequin,
    style: character.style,
    cloth: cloth === undefined
      ? undefined
      : (frame, root) => clothParts(character.scenario, cloth.frames[frame].positions, root),
    frames: Array.from({ length: STRIP.frames }, (_, i) => start + i * step),
    azimuthDeg: 90,
    elevationDeg: STRIP.elevationDeg,
    targetHeightPx: STRIP.targetHeightPx,
    scale: STRIP.scale,
    gap: STRIP.gap
  })
}

export function footprints (character: Character, recording: LocomotionRecording): Image {
  const { rig, mannequin } = character
  return footprintTrace(recording, { rig, mannequin, size: FOOTPRINT_SIZE })
}

export function clothOnionSkin (character: Character, locomotion: LocomotionRecording, cloth: Recording): Image {
  const { first, last } = steadyRange(character, locomotion)
  const every = Math.max(CLOTH_EVERY, Math.ceil((last - first + 1) / MAX_CLOTH_FRAMES))
  const frames: number[] = []
  for (let i = first; i <= last; i += every) frames.push(i)
  return bodyFrameOnionSkin(cloth, {
    size: CLOTH_SIZE, frames, body: character.mannequin, exclude: character.scenario.bodyExcludeParts
  })
}
