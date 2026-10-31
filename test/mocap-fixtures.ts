import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadCharacter } from '../src/formats/character.ts'
import type { Character } from '../src/formats/character.ts'
import { validateClip } from '../src/mocap/clip.ts'
import type { Clip } from '../src/mocap/clip.ts'
import { mergeRetargeting } from '../src/mocap/retarget.ts'
import type { RetargetOptions } from '../src/mocap/retarget.ts'
import type { MotionStyle } from '../src/mocap/style.ts'
import { restPose } from '../src/motion/pose.ts'

export const CLIPS = 'motion/clips'
export const HUMANOIDS = ['knight', 'rogue', 'dwarf', 'wizard']
export const clipFiles = readdirSync(CLIPS).filter(f => f.endsWith('.json')).sort()

export function readJson (path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export const sharedRetargeting = readJson('motion/humanoid.json')

export function rawClips (): unknown[] {
  return clipFiles.map(file => readJson(join(CLIPS, file)))
}

export function loadClip (name: string): Clip {
  const read = validateClip(readJson(join(CLIPS, `${name}.json`)))
  assert.deepEqual(read.errors, [])
  return read.value as Clip
}

export function loadClips (): Clip[] {
  return clipFiles.map(file => loadClip(file.replace(/\.json$/, '')))
}

const characters = new Map<string, Character>()

export function character (name: string): Character {
  const known = characters.get(name)
  if (known !== undefined) return known
  const loaded = loadCharacter(join('examples', name)).value
  assert.ok(loaded !== undefined, `${name} loads`)
  characters.set(name, loaded)
  return loaded
}

export function ownRetargeting (name: string): any {
  return readJson(join('examples', name, 'retarget.json'))
}

export function retargetOptions (name: string, style?: MotionStyle): RetargetOptions {
  const { rig, mannequin } = character(name)
  const own = ownRetargeting(name)
  const map = mergeRetargeting(sharedRetargeting, own)
  return { rig, rest: restPose(mannequin), mannequin, map, style: style ?? own.style }
}
