import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AUTHORING_GATES } from '../src/checks/gate-spec.ts'
import { THREE_QUARTER_MIN } from '../src/export/direction-cues.ts'
import { DIRECTIONS } from '../src/export/directions.ts'
import type { Frame, Recording, Track } from '../src/export/record.ts'
import { loadCharacter } from '../src/formats/character.ts'
import { createImage, setPixel } from '../src/image.ts'
import { decodePng } from '../src/png/decode.ts'
import type { Ask } from '../src/judge/runner.ts'
import { DIRECTION_CHECKS, directionChecks, measurerFor } from '../src/tool/direction-checks.ts'
import { bufferIo, pinataInvoke } from '../src/tool/io.ts'
import { NO_SCORE, runReview } from '../src/tool/review.ts'
import { runSkin } from '../src/tool/skin.ts'
import { characterWithViews, completeViews, recoloured } from './direction-fixtures.ts'
import type { Views } from './direction-fixtures.ts'
import { CHARACTER_OK, patchJson, scratchDir } from './formats-fixtures.ts'

const KNIGHT = new URL('../examples/knight', import.meta.url).pathname
const COST = 0.01

const measured = (dir: string): ReturnType<typeof directionChecks> => directionChecks(loadCharacter(dir).value!)

const valueOf = (dir: string, name: string): { value: number, hint: string } => {
  const check = measured(dir).checks.find(own => own.gate.name === name)!
  return { value: check.gate.value, hint: check.hint() }
}

function judging (out: string, misread: Record<string, string>, wrongJudges: number): Ask {
  let asked = 0
  return async () => {
    const read = readFileSync(join(out, 'key.json'), 'utf8')
    const key = JSON.parse(read) as { items: Record<string, { id: string, label: string }> }
    const wrong = asked++ < wrongJudges
    const answers = Object.fromEntries(Object.entries(key.items).map(([item, { id, label }]) => {
      return [item, { choice: wrong ? misread[id] ?? label : label }]
    }))
    return { text: JSON.stringify(answers), durationMs: 5, costUsd: COST }
  }
}

test('the declared direction gates are exactly the direction checks, each emitted under its own name', () => {
  const declared = AUTHORING_GATES.filter(gate => gate !== 'pivot')
  assert.deepEqual(DIRECTION_CHECKS.map(check => check.declared).sort(), [...declared].sort())
  const { checks, notes } = measured(characterWithViews({}))
  assert.deepEqual(checks.map(check => check.gate.name), DIRECTION_CHECKS.map(check => check.name))
  assert.deepEqual(notes, [])
})

test('a complete skin of distinct views passes every direction gate', () => {
  const { checks } = measured(characterWithViews({}))
  assert.deepEqual(checks.map(check => check.gate.value), [0, 0, 0])
})

test('a three-quarter head equal to its cardinal neighbour fails with the view, the part and the cue', () => {
  const dir = characterWithViews({ backSide: { head: completeViews({}).back!.head } })
  const { value, hint } = valueOf(dir, 'threeQuarterViewFindings')
  assert.equal(value, 1)
  assert.match(hint, /^backSide head: .*by 0 px .*hair, hood or helmet back/)
})

test('redrawing that head so it differs from the neighbouring view enough passes the gate', () => {
  const back = completeViews({}).back!.head
  const dir = characterWithViews({ backSide: { head: recoloured(back, 'h', 'm', THREE_QUARTER_MIN) } })
  assert.equal(valueOf(dir, 'threeQuarterViewFindings').value, 0)
})

test('a sprite missing from a compared view is a finding that names it', () => {
  const dir = characterWithViews({}, copy => patchJson(copy, 'skin.json', skin => {
    delete skin.views.frontSide.parts.head
  }))
  const { value, hint } = valueOf(dir, 'threeQuarterViewFindings')
  assert.ok(value >= 1)
  assert.match(hint, /frontSide head: has no sprite/)
})

test('a rig without arms is reported as not measured, with no direction gate to read as a pass', () => {
  const dir = characterWithViews({}, copy => patchJson(copy, 'rig.json', rig => {
    rig.upperBody.push(...rig.arms.flatMap((arm: Record<string, string>) => Object.values(arm).slice(1)))
    rig.arms = []
  }))
  const { checks, notes } = measured(dir)
  assert.deepEqual(checks, [])
  assert.match(notes.join('\n'), /direction checks not measured: the rig has no arms/)
})

test('a one-view skin is reported as not measured', () => {
  const dir = characterWithViews({}, copy => {
    const parts = { head: { rows: ['hh'], pivotA: [0, 0] } }
    const skin = { name: 'one', view: 'side-right', palette: { h: '#111111' }, parts }
    writeFileSync(join(copy, 'skin.json'), JSON.stringify(skin))
  })
  assert.match(measured(dir).notes.join('\n'), /not measured: the skin draws one view/)
})

test('an unreadable skin is reported as not measured, and a character without a skin has no direction notes', () => {
  const dir = characterWithViews({}, copy => writeFileSync(join(copy, 'skin.json'), '{'))
  assert.match(measured(dir).notes.join('\n'), /not measured: the skin cannot be read/)
  assert.deepEqual(measured(CHARACTER_OK), { checks: [], notes: [] })
})

test('a head with no face colour of its own is not measured by the back-view check, the others still are', () => {
  const plain = ['.hhhhh.', 'hhhhhhh', 'hhhhhhh', 'hhhhhhh', '.hhhhh.']
  const { checks, notes } = measured(characterWithViews({ front: { head: plain } }))
  assert.match(notes.join('\n'), /backViewFaceFindings not measured: the front face has no colour of its own/)
  assert.deepEqual(checks.map(check => check.gate.name), ['threeQuarterViewFindings', 'sideProfileFindings'])
})

test('with no head part above the shoulders the face checks are not measured and the torso still is', () => {
  const dir = characterWithViews({}, copy => patchJson(copy, 'mannequin.json', mannequin => {
    mannequin.parts = mannequin.parts.filter((part: { name: string }) => part.name !== 'head')
    mannequin.height = 1.01
  }))
  const { checks, notes } = measured(dir)
  assert.deepEqual(checks.map(check => check.gate.name), ['threeQuarterViewFindings'])
  assert.equal(notes.length, 2)
})

test('skin preview writes the labelled eight-direction idle sheet next to the other images', () => {
  const out = scratchDir('pinata-preview-')
  const { io, lines } = bufferIo()
  assert.equal(runSkin(['preview', KNIGHT, join(KNIGHT, 'skin.json'), out], io, pinataInvoke), 0)
  assert.match(lines.join('\n'), /idle-directions\.png: the first idle frame/)
  const image = decodePng(readFileSync(join(out, 'idle-directions.png')))
  const plain = decodePng(readFileSync(join(out, 'directions.png')))
  assert.ok(image.width > 8 * 6 * 20 && image.height > plain.height / 2)
})

function stubbedRecording (): Recording {
  let colour = 0
  const frame = (): Frame => {
    const image = createImage(4, 4)
    setPixel(image, 0, 0, 0x100000 + colour++ * 0x101)
    return { image, sector: undefined, travel: [0, 0], feet: [] }
  }
  const track = (behaviour: Track['behaviour'], direction: Track['direction']): Track => {
    return { behaviour, direction, loop: true, frames: [frame(), frame()] }
  }
  const tracks = (['idle', 'walk'] as const).flatMap(behaviour => DIRECTIONS.map(own => track(behaviour, own)))
  return { name: 'stub', cell: { width: 4, height: 4, pivot: [2, 3], root: [2, 3] }, spritePerMetre: 1, tracks }
}

test('review exits 3 with the spent cost when a judge fails, and 1 when a gate is missed', async () => {
  const out = join(scratchDir('pinata-review-'), 'review')
  const { io, lines } = bufferIo()
  const answering = judging(out, {}, 0)
  const broke: Ask = async (model, prompt, cwd, timeout) => {
    if (model === 'haiku') throw new Error('no claude')
    return answering(model, prompt, cwd, timeout)
  }
  assert.equal(await runReview([KNIGHT, '--out', out], io, pinataInvoke, broke, stubbedRecording), NO_SCORE)
  const text = lines.join('\n')
  assert.match(text, /judge haiku: FAILED: no claude/)
  assert.match(text, /cost: \$0\.020 for 3 judges, 1 unknown/)
  assert.match(text, /no score is given/)
})

test('review with every answer right passes, and a misread names its direction, confusions and cue', async () => {
  const out = join(scratchDir('pinata-review-'), 'review')
  const { io, lines } = bufferIo()
  const misread = { 'idle-front-right': 'front', 'idle-back-right': 'back-left' }
  const ask = judging(out, misread, 2)
  const status = await runReview([KNIGHT, '--out', out], io, pinataInvoke, ask, stubbedRecording)
  const text = lines.join('\n')
  assert.equal(status, 1)
  assert.match(text, /idle: 20 of 24 right, 83%/)
  assert.match(text, /front-right: 1 of 3 right; named front 2 times: its head differs from the front head by \d+ px/)
  assert.match(text, /back-right: 1 of 3 right; named back-left 2 times\. Draw the backSide view/)
  assert.match(text, /cost: \$0\.030 for 3 judges/)
  const clean = bufferIo()
  const again = join(scratchDir('pinata-review-'), 'review')
  const right = judging(again, {}, 0)
  assert.equal(await runReview([KNIGHT, '--out', again], clean.io, pinataInvoke, right, stubbedRecording), 0)
  assert.match(clean.lines.join('\n'), /idle: 24 of 24 right, 100%[^\n]*PASS/)
})

test('review --walk scores the walk frames apart from the idle frames', async () => {
  const out = join(scratchDir('pinata-review-'), 'review')
  const { io, lines } = bufferIo()
  const walked = Object.fromEntries(DIRECTIONS.slice(1, 5).map(direction => [`walk-${direction}`, 'front']))
  const status = await runReview([KNIGHT, '--walk', '--out', out], io, pinataInvoke,
    judging(out, walked, 3), stubbedRecording)
  const text = lines.join('\n')
  assert.equal(status, 1)
  assert.match(text, /idle: 24 of 24 right, 100%[^\n]*PASS/)
  assert.match(text, /walk: 12 of 24 right, 50%[^\n]*FAIL/)
})

test('a misread names the structural measure between the true view and the named one', () => {
  const equalHead = characterWithViews({ backSide: { head: completeViews({}).back!.head } })
  const measure = measurerFor(loadCharacter(equalHead).value!)
  assert.match(measure('back-right', 'back')!, /^its head differs from the back head by 0 px, its torso .*is 8$/)
  assert.match(measure('back-right', 'front')!, /^its head carries \d+ px in colours only the front face uses/)
  assert.match(measure('right', 'front-right')!, /^its head differs from the frontSide head by \d+ px/)
  assert.equal(measure('back-right', 'back-left'), undefined)
  assert.equal(measure('back-right', 'cant_tell'), undefined)
})

test('a misread side view names its head\'s difference from its own mirror', () => {
  const symmetric = characterWithViews({ side: { head: ['.hhhhh.', 'hhhhhhh', 'hhhhhhh', 'hhhhhhh', '.hhhhh.'] } })
  const measure = measurerFor(loadCharacter(symmetric).value!)
  assert.equal(measure('right', 'front'), 'its head differs from its own mirror by 0 px, the minimum is 4')
})

test('review refuses a missing directory argument', async () => {
  const { io, lines } = bufferIo()
  assert.equal(await runReview([], io, pinataInvoke), 2)
  assert.match(lines.join('\n'), /usage: pinata review/)
})
