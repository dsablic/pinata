import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatCharacterErrors, loadCharacter } from '../src/formats/character.ts'
import { steadySegments } from '../src/motion/metrics.ts'

const ok = new URL('./fixtures/character-ok', import.meta.url).pathname
const invalid = new URL('./fixtures/character-invalid', import.meta.url).pathname

function variant (edit: (dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'pinata-character-'))
  cpSync(ok, dir, { recursive: true })
  edit(dir)
  return dir
}

function patch (dir: string, file: string, change: (json: any) => void): void {
  const json = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  change(json)
  writeFileSync(join(dir, file), JSON.stringify(json))
}

test('a complete character loads with its scenario assembled from the motion file', () => {
  const { value, errors } = loadCharacter(ok)
  assert.deepEqual(errors, [])
  assert.equal(value?.name, 'imp')
  assert.equal(value?.scenario.body, 'mannequin.json')
  assert.deepEqual(value?.scenario.bodyExcludeParts, [])
  assert.deepEqual(value?.scenario.chains, [])
  assert.equal(value?.scenario.cape?.material, 'cloth')
})

test('errors from several files are all listed, prefixed by the file name', () => {
  const { value, errors } = loadCharacter(invalid)
  assert.equal(value, undefined)
  const lines = formatCharacterErrors(errors).split('\n')
  assert.ok(lines.some(l => l.startsWith('mannequin.json: parts[0].radiusA: ')), lines.join('\n'))
  assert.ok(lines.some(l => l.startsWith("motion.json: name: unknown field 'name'")), lines.join('\n'))
  assert.ok(lines.some(l => l.startsWith('motion.json: fps: ')), lines.join('\n'))
})

test('a missing file and unknown manifest fields are reported', () => {
  const dir = variant(d => {
    rmSync(join(d, 'rig.json'))
    patch(d, 'character.json', j => { j.colour = 'red' })
  })
  const lines = formatCharacterErrors(loadCharacter(dir).errors).split('\n')
  assert.ok(lines.includes('rig.json: (root): file not found'), lines.join('\n'))
  assert.ok(lines.some(l => l.startsWith("character.json: colour: unknown field 'colour'")), lines.join('\n'))
  rmSync(dir, { recursive: true })
})

test('file names are configurable and must stay inside the directory', () => {
  const dir = variant(d => {
    cpSync(join(d, 'rig.json'), join(d, 'legs.json'))
    patch(d, 'character.json', j => { j.rig = 'legs.json'; j.style = '../style.json' })
  })
  const lines = formatCharacterErrors(loadCharacter(dir).errors).split('\n')
  assert.equal(lines.length, 1, lines.join('\n'))
  assert.ok(lines[0].startsWith('character.json: style: expected a file name inside'), lines[0])
  rmSync(dir, { recursive: true })
})

test('cross-checks name the file that has to change', () => {
  const dir = variant(d => {
    patch(d, 'rig.json', j => { j.upperBody.push('nowhere') })
    patch(d, 'motion.json', j => { j.cape.anchorLeft = 'nowhere'; j.cape.material = 'silk'; j.exclude = ['wing'] })
    patch(d, 'mannequin.json', j => { j.parts[0].material = 'armour' })
  })
  const lines = formatCharacterErrors(loadCharacter(dir).errors).split('\n')
  assert.ok(lines.some(l => l.startsWith("rig.json: upperBody[5]: unknown joint 'nowhere'")), lines.join('\n'))
  assert.ok(lines.some(l => l.startsWith("motion.json: cape.anchorLeft: unknown joint 'nowhere'")), lines.join('\n'))
  assert.ok(lines.some(l => l.startsWith("motion.json: cape.material: unknown material 'silk'")), lines.join('\n'))
  assert.ok(lines.some(l => l.startsWith("motion.json: exclude[0]: unknown part 'wing'")), lines.join('\n'))
  const ramp = "mannequin.json: parts[0].material: material 'armour' has no ramp"
  assert.ok(lines.some(l => l.startsWith(ramp)), lines.join('\n'))
  rmSync(dir, { recursive: true })
})

test('a script without a steady walking window is rejected', () => {
  const dir = variant(d => {
    patch(d, 'motion.json', j => { j.script.segments = [{ action: 'hold', duration: 1 }] })
  })
  const lines = formatCharacterErrors(loadCharacter(dir).errors).split('\n')
  assert.ok(lines.some(l => l.startsWith('motion.json: script.segments: no steady walking window')), lines.join('\n'))
  rmSync(dir, { recursive: true })
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
