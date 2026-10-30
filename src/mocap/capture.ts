import type { Mannequin } from '../formats/mannequin.ts'
import type { Rig } from '../formats/rig.ts'
import { isRecord } from '../formats/validate.ts'
import type { ValidationError } from '../formats/validate.ts'
import { restPose } from '../motion/pose.ts'
import { validateClip } from './clip.ts'
import type { Clip } from './clip.ts'
import { buildDatabase } from './database.ts'
import type { MotionDatabase } from './database.ts'
import { mergeRetargeting, validateRetargeting } from './retarget.ts'
import { validateStyle } from './style.ts'

/**
 * Motion capture for a set of characters, as written: the clips, the retargeting every character shares, and per
 * character its own (`hang`, and an optional `style`). A character without its own entry does not use capture.
 */
export type CaptureData = { clips: unknown[], base: unknown, members: Record<string, unknown> }

export function readClips (clips: unknown[], errors: ValidationError[], path: string): Clip[] {
  const read: Clip[] = []
  clips.forEach((input, i) => {
    const clip = validateClip(input)
    errors.push(...clip.errors.map(e => ({ ...e, path: `${path}[${i}].${e.path}` })))
    if (clip.value !== undefined) read.push(clip.value)
  })
  return read
}

/**
 * A character's motion database from its retargeting (the shared one with its own merged over it) and style,
 * checked against its rig and the clips; undefined, with errors, when they do not fit.
 */
export function captureFor (
  character: { rig: Rig, mannequin: Mannequin },
  clips: Clip[],
  base: unknown,
  own: unknown,
  errors: ValidationError[],
  path: string
): MotionDatabase | undefined {
  if (!isRecord(base) || !isRecord(own) || clips.length === 0) {
    errors.push({ path, message: 'expected the shared retargeting, the character\'s own, and at least one clip' })
    return undefined
  }
  const { style, ...retargeting } = own
  const rest = restPose(character.mannequin)
  const map = validateRetargeting(mergeRetargeting(base, retargeting), character.rig, rest, clips[0])
  errors.push(...map.errors.map(e => ({ ...e, path: `${path}.${e.path}` })))
  const styled = style === undefined ? undefined : validateStyle(style)
  errors.push(...(styled?.errors ?? []).map(e => ({ ...e, path: `${path}.style.${e.path}` })))
  if (map.value === undefined || (styled !== undefined && styled.value === undefined)) return undefined
  const { rig, mannequin } = character
  return buildDatabase(clips, { rig, rest, mannequin, map: map.value, style: styled?.value })
}
