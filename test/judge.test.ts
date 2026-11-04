import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createImage, getPixel, setPixel, TRANSPARENT } from '../src/image.ts'
import type { Image } from '../src/image.ts'
import {
  buildChoicePacket, choiceProblems, isChoiceSpec, scoreChoices, validateChoiceSpec
} from '../src/judge/choice.ts'
import type { ChoiceAnswers, ChoiceSpec } from '../src/judge/choice.ts'
import { buildPacket, pairImage, validatePanelSpec } from '../src/judge/packet.ts'
import type { PanelSpec } from '../src/judge/packet.ts'
import { answerProblems, scorePanel } from '../src/judge/score.ts'
import type { Answer, JudgeAnswers } from '../src/judge/score.ts'
import { encodePng } from '../src/png/encode.ts'

const RED = 0xff0000
const BLUE = 0x0000ff
const GREEN = 0x00ff00
const cli = new URL('../src/cli/judge.ts', import.meta.url).pathname
const scratch = mkdtempSync(join(tmpdir(), 'pinata-judge-'))

after(() => { rmSync(scratch, { recursive: true, force: true }) })

function block (colour: number, width: number, height: number, pad = 2): Image {
  const image = createImage(width + 2 * pad, height + 2 * pad)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) setPixel(image, x + pad, y + pad, colour)
  return image
}

const IMAGES: Record<string, Image> = { red: block(RED, 3, 6), blue: block(BLUE, 5, 2), green: block(GREEN, 2, 2) }

const spec: PanelSpec = {
  name: 'test panel',
  seed: 'one',
  question: 'Which looks more hand-made?',
  scale: 2,
  gap: 1,
  background: '#c8c8c8',
  pairs: [{ id: 'ours', a: 'red', b: 'blue' }, { id: 'control', a: 'blue', b: 'green', control: true }]
}

function packetFor (panel: PanelSpec = spec): ReturnType<typeof buildPacket> {
  return buildPacket(panel, name => IMAGES[name])
}

function colourOn (image: Image, side: 'left' | 'right'): number {
  const x0 = side === 'left' ? 0 : Math.floor(image.width / 2)
  for (let y = 0; y < image.height; y++) {
    for (let x = x0; x < x0 + Math.floor(image.width / 2); x++) {
      const c = getPixel(image, x, y)
      if (c !== 0xc8c8c8 && c !== TRANSPARENT) return c
    }
  }
  return TRANSPARENT
}

test('a packet shows every pair in both orders under neutral names, and the key says where a is', () => {
  const packet = packetFor()
  assert.deepEqual(Object.keys(packet.images), ['item-01.png', 'item-02.png', 'item-03.png', 'item-04.png'])
  const sides = Object.values(packet.key.items).map(e => `${e.pair}/${e.aSide}`).sort()
  assert.deepEqual(sides, ['control/left', 'control/right', 'ours/left', 'ours/right'])
  for (const [name, image] of Object.entries(packet.images)) {
    const entry = packet.key.items[name.replace('.png', '')]
    const a = entry.pair === 'ours' ? RED : BLUE
    assert.equal(colourOn(image, entry.aSide), a, name)
  }
  assert.match(packet.questions, /Which looks more hand-made\?/)
  assert.doesNotMatch(packet.questions, /ours|control|red|blue/)
  assert.notDeepEqual(packetFor({ ...spec, seed: 'two' }).key, packet.key)
  assert.deepEqual(packetFor().key, packet.key)
})

test('pair images are trimmed, stand on one baseline and sit in equal cells', () => {
  const image = pairImage(IMAGES.red, IMAGES.blue, { scale: 1, gap: 1, background: '#c8c8c8' })
  assert.equal(image.width, 1 + 5 + 1 + 5 + 1)
  assert.equal(image.height, 1 + 6 + 1)
  assert.equal(getPixel(image, 2, 6), RED)
  assert.equal(getPixel(image, 7, 6), BLUE)
  assert.equal(getPixel(image, 7, 4), 0xc8c8c8)
})

test('the spec needs a control pair and unique ids', () => {
  const noControl = validatePanelSpec({ ...spec, pairs: [spec.pairs[0]] })
  assert.match(noControl.errors.map(e => e.message).join(), /at least one control pair/)
  const twice = validatePanelSpec({ ...spec, pairs: [...spec.pairs, spec.pairs[0]] })
  assert.match(twice.errors.map(e => e.message).join(), /id 'ours' is used twice/)
  assert.equal(validatePanelSpec({ name: 'x', seed: 's', question: 'q', pairs: spec.pairs }).value?.scale, 8)
})

function answersFor (pick: (pair: string, aSide: 'left' | 'right') => Answer['choice']): JudgeAnswers {
  const { key } = packetFor()
  return Object.fromEntries(Object.entries(key.items).map(([item, e]) => [item, { choice: pick(e.pair, e.aSide) }]))
}

test('scoring resolves left and right back to a and b and measures position bias and controls', () => {
  const { key } = packetFor()
  const faithful = answersFor((pair, aSide) => pair === 'ours' ? aSide : 'cant_tell')
  const leftie = answersFor(() => 'left')
  const score = scorePanel(key, [faithful, faithful, leftie])
  const ours = score.pairs.find(p => p.pair === 'ours')!
  assert.deepEqual([ours.a, ours.b, ours.cantTell, ours.consistent, ours.judges], [5, 1, 0, 2, 3])
  assert.equal(score.aShare, 5 / 6)
  assert.equal(score.leftShare, 6 / 8)
  assert.equal(score.controlNeutral, 1)
  assert.deepEqual(score.missing, [])
})

test('judges who each separate a control, in opposite directions, do not count as neutral', () => {
  const { key } = packetFor()
  const forA = answersFor((pair, aSide) => pair === 'control' ? aSide : 'cant_tell')
  const forB = answersFor((pair, aSide) => pair === 'control' ? (aSide === 'left' ? 'right' : 'left') : 'cant_tell')
  const score = scorePanel(key, [forA, forB])
  const control = score.pairs.find(p => p.pair === 'control')!
  assert.deepEqual([control.a, control.b, control.consistent, control.neutral, control.judges], [2, 2, 2, 0, 2])
  assert.equal(score.controlNeutral, 0)
  const ours = score.pairs.find(p => p.pair === 'ours')!
  assert.deepEqual([ours.consistent, ours.neutral], [0, 2], 'cant_tell in both orders is not a consistent pick')
})

test('ratings are checked and averaged per side', () => {
  const rated = { ...spec, rating: 'Rate each 1-5.' }
  const { key } = packetFor(rated)
  assert.equal(key.rating, true)
  const items = Object.keys(key.items)
  const unrated = Object.fromEntries(items.map(item => [item, { choice: 'cant_tell' }]))
  assert.match(answerProblems(unrated, key)[0], /missing rating/)
  const bad = { ...unrated, [items[0]]: { choice: 'left', rating: { left: '5', right: 9 } } }
  assert.match(answerProblems(bad, key).join(), /expected "rating": \{ "left": 1-5, "right": 1-5 \}/)
  const answers: JudgeAnswers = Object.fromEntries(items.map(item => {
    const aSide = key.items[item].aSide
    return [item, { choice: aSide, rating: aSide === 'left' ? { left: 4, right: 2 } : { left: 2, right: 4 } }]
  }))
  assert.deepEqual(answerProblems(answers, key), [])
  const ours = scorePanel(key, [answers]).pairs.find(p => p.pair === 'ours')!
  assert.deepEqual([ours.ratingA, ours.ratingB], [4, 2])
})

test('answerProblems lists missing, malformed and unknown items', () => {
  const { key } = packetFor()
  const problems = answerProblems({ 'item-01': { choice: 'maybe' }, 'item-09': { choice: 'left' } }, key)
  assert.deepEqual(problems, [
    'item-01: expected { "choice": "left" | "right" | "cant_tell" }',
    'item-02: missing', 'item-03: missing', 'item-04: missing', 'item-09: not in the panel'
  ])
})

test('the CLI builds a packet from PNG files and refuses a key inside the packet', () => {
  for (const [name, image] of Object.entries(IMAGES)) writeFileSync(join(scratch, `${name}.png`), encodePng(image))
  const pairs = spec.pairs.map(p => ({ ...p, a: `${p.a}.png`, b: `${p.b}.png` }))
  writeFileSync(join(scratch, 'panel.json'), JSON.stringify({ ...spec, pairs }))
  const packet = join(scratch, 'packet')
  const judge = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
  const inside = judge('build', join(scratch, 'panel.json'), packet, join(packet, 'key.json'))
  assert.equal(inside.status, 2)
  assert.match(inside.stderr, /must not be inside the packet folder/)
  assert.equal(existsSync(join(packet, 'key.json')), false)
  symlinkSync(packet, join(scratch, 'keys'))
  const sneaky = [join(packet, '..key.json'), join(scratch, 'keys', 'key.json'), join(scratch, 'PACKET', 'key.json')]
  for (const key of process.platform === 'darwin' ? sneaky : sneaky.slice(0, 2)) {
    const refused = judge('build', join(scratch, 'panel.json'), packet, key)
    assert.equal(refused.status, 2, key)
  }
  assert.deepEqual(readdirSync(packet), [])
  writeFileSync(join(packet, 'item-09.png'), 'stale')
  const built = judge('build', join(scratch, 'panel.json'), packet, join(scratch, 'key.json'))
  assert.equal(built.status, 0, built.stderr)
  const files = ['item-01.png', 'item-02.png', 'item-03.png', 'item-04.png', 'questions.md']
  assert.deepEqual(readdirSync(packet).sort(), files)
  const panelName = JSON.parse(readFileSync(join(scratch, 'panel.json'), 'utf8')).name
  assert.ok(!readFileSync(join(packet, 'questions.md'), 'utf8').includes(panelName))
  writeFileSync(join(scratch, 'judge1.json'), JSON.stringify(answersFor(() => 'cant_tell')))
  const scored = judge('score', join(scratch, 'key.json'), join(scratch, 'judge1.json'))
  assert.equal(scored.status, 0, scored.stderr)
  assert.match(scored.stdout, /controls left unseparated .* by 100% of judges/)
})

test('a stacked panel puts the left image on top and says so', () => {
  const a = createImage(4, 2)
  const b = createImage(4, 2)
  for (let x = 0; x < 4; x++) for (let y = 0; y < 2; y++) {
    setPixel(a, x, y, 0xff0000)
    setPixel(b, x, y, 0x0000ff)
  }
  const image = pairImage(a, b, { scale: 1, gap: 1, background: '#c8c8c8', layout: 'stacked' })
  assert.ok(image.height > image.width)
  const pairs = [{ id: 'p', a: 'a', b: 'b' }, { id: 'c', a: 'b', b: 'b', control: true }]
  const spec = validatePanelSpec({ name: 'n', seed: 's', question: 'q', layout: 'stacked', pairs })
  assert.deepEqual(spec.errors, [])
  assert.deepEqual(validatePanelSpec({ ...spec.value, layout: 'diagonal' }).errors.map(e => e.path), ['layout'])
})

const FACES: ChoiceSpec = {
  kind: 'choice',
  name: 'facing',
  seed: 'f1',
  question: 'Which colour is the block?',
  labels: ['red', 'blue', 'green'],
  scale: 2,
  background: '#c8c8c8',
  items: [
    { id: 'a', image: 'red', label: 'red' },
    { id: 'b', image: 'blue', label: 'blue' },
    { id: 'c', image: 'green', label: 'green' },
    { id: 'd', image: 'red', label: 'red' }
  ]
}

test('a labelled packet hides the answers behind neutral names and a key', () => {
  const packet = buildChoicePacket(FACES, name => IMAGES[name])
  assert.deepEqual(Object.keys(packet.images), ['item-01.png', 'item-02.png', 'item-03.png', 'item-04.png'])
  const shown = Object.entries(packet.key.items).map(([item, entry]) => {
    const image = packet.images[`${item}.png`]
    const colours = new Set<number>()
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) colours.add(getPixel(image, x, y))
    return `${entry.label}:${colours.has(RED)}${colours.has(BLUE)}${colours.has(GREEN)}`
  }).sort()
  assert.deepEqual(shown, ['blue:falsetruefalse', 'green:falsefalsetrue', 'red:truefalsefalse', 'red:truefalsefalse'])
  assert.match(packet.questions, /Choose one of: red, blue, green, cant_tell/)
  assert.doesNotMatch(packet.questions, /facing/)
})

test('a spec routes to labelled panels only by its kind', () => {
  assert.equal(isChoiceSpec(FACES), true)
  assert.equal(isChoiceSpec({ ...FACES, kind: undefined }), false)
  assert.ok(validateChoiceSpec({ ...FACES, kind: undefined }).errors.some(e => e.path === 'kind'))
})

test('a labelled spec needs known labels and unique ids', () => {
  const bad = { ...FACES, items: [{ id: 'a', image: 'red', label: 'purple' }, { id: 'a', image: 'red', label: 'red' }] }
  const messages = validateChoiceSpec(bad).errors.map(e => e.message)
  assert.ok(messages.some(m => m.includes("'purple' is not one of the labels")))
  assert.ok(messages.some(m => m.includes("id 'a' is used twice")))
  assert.ok(validateChoiceSpec({ ...FACES, labels: ['red', 'cant_tell'] }).errors.length > 0)
})

test('labelled answers are scored per label with what was named instead, and cant_tell counts as wrong', () => {
  const key = buildChoicePacket(FACES, name => IMAGES[name]).key
  const itemOf = (id: string): string => Object.keys(key.items).find(item => key.items[item].id === id) as string
  const judge: ChoiceAnswers = {
    [itemOf('a')]: { choice: 'red' }, [itemOf('d')]: { choice: 'blue' },
    [itemOf('b')]: { choice: 'blue' }, [itemOf('c')]: { choice: 'cant_tell' }
  }
  const score = scoreChoices(key, [judge])
  assert.equal(score.right, 2)
  assert.equal(score.asked, 4)
  assert.deepEqual(score.labels.find(l => l.label === 'red')?.named, { blue: 1 })
  assert.deepEqual(score.labels.find(l => l.label === 'green')?.named, { cant_tell: 1 })
  const missing = scoreChoices(key, [{ [itemOf('a')]: { choice: 'red' } }])
  assert.equal(missing.asked, 4)
  assert.equal(missing.right, 1)
  assert.equal(missing.missing.length, 3)
  assert.deepEqual(choiceProblems({ ...judge, [itemOf('a')]: { choice: 'purple' } }, key).length, 1)
  assert.equal(choiceProblems({}, key).length, 4)
})
