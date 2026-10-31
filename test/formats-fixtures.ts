import { after } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateMannequin } from '../src/formats/mannequin.ts'
import type { Mannequin } from '../src/formats/mannequin.ts'

export const CHARACTER_OK = new URL('./fixtures/character-ok', import.meta.url).pathname
export const CHARACTER_INVALID = new URL('./fixtures/character-invalid', import.meta.url).pathname

export const RIG_GAIT = {
  strideLength: 1.4,
  referenceSpeed: 1.2,
  stanceFraction: 0.6,
  stepHeight: 0.1,
  bobAmplitude: 0.03,
  armSwingDegrees: 25,
  footSpacing: 0.2
}

const scratch: string[] = []

after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

export function scratchDir (prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  scratch.push(dir)
  return dir
}

export function characterVariant (edit: (dir: string) => void, source = CHARACTER_OK): string {
  const dir = scratchDir('pinata-character-')
  cpSync(source, dir, { recursive: true })
  edit(dir)
  return dir
}

export function patchJson (dir: string, file: string, change: (json: any) => void): void {
  const json = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  change(json)
  writeFileSync(join(dir, file), JSON.stringify(json))
}

export function mannequinWithJoints (names: string[]): Mannequin {
  const joints = Object.fromEntries(names.map((n, i) => [n, [i, 0, 0]]))
  const parts = [{ name: 'p', shape: 'capsule', a: 'pelvis', b: 'chest', radiusA: 0.1, radiusB: 0.1, material: 'm' }]
  const result = validateMannequin({ name: 'm', height: 2, joints, parts })
  assert.deepEqual(result.errors, [])
  return result.value!
}
