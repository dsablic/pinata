import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { formatCharacterErrors, loadCharacter } from '../src/formats/character.ts'
import { steadySegments } from '../src/motion/metrics.ts'
import { CHARACTER_INVALID, CHARACTER_OK, characterVariant, patchJson } from './formats-fixtures.ts'

function errorLines (dir: string): string[] {
  return formatCharacterErrors(loadCharacter(dir).errors).split('\n')
}

function assertHasLine (lines: string[], start: string): void {
  assert.ok(lines.some(l => l.startsWith(start)), lines.join('\n'))
}

test('a complete character loads with its scenario assembled from the motion file', () => {
  const { value, errors } = loadCharacter(CHARACTER_OK)
  assert.deepEqual(errors, [])
  assert.equal(value?.name, 'imp')
  assert.equal(value?.scenario.body, 'mannequin.json')
  assert.deepEqual(value?.scenario.bodyExcludeParts, [])
  assert.deepEqual(value?.scenario.chains, [])
  assert.equal(value?.scenario.cape?.material, 'cloth')
})

test('errors from several files are all listed, prefixed by the file name', () => {
  const { value, errors } = loadCharacter(CHARACTER_INVALID)
  assert.equal(value, undefined)
  const lines = formatCharacterErrors(errors).split('\n')
  assertHasLine(lines, 'mannequin.json: parts[0].radiusA: ')
  assertHasLine(lines, "motion.json: name: unknown field 'name'")
  assertHasLine(lines, 'motion.json: fps: ')
})

test('a missing file and unknown manifest fields are reported', () => {
  const dir = characterVariant(d => {
    rmSync(join(d, 'rig.json'))
    patchJson(d, 'character.json', j => { j.colour = 'red' })
  })
  const lines = errorLines(dir)
  assert.ok(lines.includes('rig.json: (root): file not found'), lines.join('\n'))
  assertHasLine(lines, "character.json: colour: unknown field 'colour'")
})

test('file names are configurable and must stay inside the directory', () => {
  const dir = characterVariant(d => {
    cpSync(join(d, 'rig.json'), join(d, 'legs.json'))
    patchJson(d, 'character.json', j => { j.rig = 'legs.json'; j.style = '../style.json' })
  })
  const lines = errorLines(dir)
  assert.equal(lines.length, 1, lines.join('\n'))
  assert.ok(lines[0].startsWith('character.json: style: expected a file name inside'), lines[0])
})

test('cross-checks name the file that has to change', () => {
  const dir = characterVariant(d => {
    patchJson(d, 'rig.json', j => { j.upperBody.push('nowhere') })
    patchJson(d, 'motion.json', j => { j.cape.anchorLeft = 'nowhere'; j.cape.material = 'silk'; j.exclude = ['wing'] })
    patchJson(d, 'mannequin.json', j => { j.parts[0].material = 'armour' })
  })
  const lines = errorLines(dir)
  assertHasLine(lines, "rig.json: upperBody[5]: unknown joint 'nowhere'")
  assertHasLine(lines, "motion.json: cape.anchorLeft: unknown joint 'nowhere'")
  assertHasLine(lines, "motion.json: cape.material: unknown material 'silk'")
  assertHasLine(lines, "motion.json: exclude[0]: unknown part 'wing'")
  const ramp = "mannequin.json: parts[0].material: material 'armour' has no ramp"
  assertHasLine(lines, ramp)
})

test('rig errors for a legs and arms rig name legs and arms, not limbs', () => {
  const dir = characterVariant(d => {
    patchJson(d, 'mannequin.json', j => { j.parts = j.parts.filter((p: any) => p.b !== 'toeR') })
    patchJson(d, 'rig.json', j => { j.legs[1].knee = 'nowhere' })
  })
  const lines = errorLines(dir)
  assertHasLine(lines, "rig.json: legs[1].knee: unknown joint 'nowhere'")
  const feet = 'rig.json: legs[1]: no capsule part in the mannequin spans'
  assertHasLine(lines, feet)
  assert.ok(lines.every(l => !l.includes('limbs[')), lines.join('\n'))
})

test('a script without a steady walking window is rejected', () => {
  const dir = characterVariant(d => {
    patchJson(d, 'motion.json', j => { j.script.segments = [{ action: 'hold', duration: 1 }] })
  })
  const lines = errorLines(dir)
  assertHasLine(lines, 'motion.json: script.segments: no steady walking window')
})

test('steadySegments skips the acceleration time and moves that overlap a turn', () => {
  const windows = steadySegments({
    accelSeconds: 0.5,
    segments: [
      { action: 'move', speed: 1.2, duration: 2 },
      { action: 'turn', degrees: 90, duration: 1 },
      { action: 'move', speed: 1.2, duration: 1.5 },
      { action: 'hold', duration: 2 }
    ]
  })
  assert.deepEqual(windows, [{ start: 0.5, end: 2, speed: 1.2 }, { start: 3.5, end: 4.5, speed: 1.2 }])
})

test('a missing manifest is reported once', () => {
  const dir = characterVariant(d => { rmSync(join(d, 'character.json')) })
  const lines = errorLines(dir)
  assert.deepEqual(lines, ['character.json: (root): file not found'])
})

test('a height far from the span of the parts is an error with both numbers', () => {
  const dir = characterVariant(d => { patchJson(d, 'mannequin.json', j => { j.height = 1.5 }) })
  const lines = errorLines(dir)
  assert.equal(lines.length, 1, lines.join('\n'))
  assert.match(lines[0], /^mannequin\.json: height: 1\.5 m differs from the parts, which span 1\.\d+ m from the lowest/)
  patchJson(dir, 'mannequin.json', j => { j.height = 1.25 })
  assert.deepEqual(loadCharacter(dir).errors, [])
})

test('cape anchors outside the pelvis and upperBody are an error in motion.json', () => {
  const dir = characterVariant(d => { patchJson(d, 'motion.json', j => { j.cape.anchorRight = 'wristR' }) })
  const lines = errorLines(dir)
  assertHasLine(lines, "motion.json: cape.anchorRight: 'wristR' is an arm joint")
})
