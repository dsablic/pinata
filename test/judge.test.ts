import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createImage, getPixel, setPixel, TRANSPARENT } from '../src/image.ts'
import type { Image } from '../src/image.ts'
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
  const packet = buildPacket(spec, name => IMAGES[name])
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
  assert.notDeepEqual(buildPacket({ ...spec, seed: 'two' }, name => IMAGES[name]).key, packet.key)
  assert.deepEqual(buildPacket(spec, name => IMAGES[name]).key, packet.key)
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
  const { key } = buildPacket(spec, name => IMAGES[name])
  return Object.fromEntries(Object.entries(key.items).map(([item, e]) => [item, { choice: pick(e.pair, e.aSide) }]))
}

test('scoring resolves left and right back to a and b and measures position bias and controls', () => {
  const { key } = buildPacket(spec, name => IMAGES[name])
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

test('answerProblems lists missing, malformed and unknown items', () => {
  const { key } = buildPacket(spec, name => IMAGES[name])
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
  assert.equal(existsSync(packet), false)
  const built = judge('build', join(scratch, 'panel.json'), packet, join(scratch, 'key.json'))
  assert.equal(built.status, 0, built.stderr)
  const files = ['item-01.png', 'item-02.png', 'item-03.png', 'item-04.png', 'questions.md']
  assert.deepEqual(readdirSync(packet).sort(), files)
  writeFileSync(join(scratch, 'judge1.json'), JSON.stringify(answersFor(() => 'cant_tell')))
  const scored = judge('score', join(scratch, 'key.json'), join(scratch, 'judge1.json'))
  assert.equal(scored.status, 0, scored.stderr)
  assert.match(scored.stdout, /controls answered neutrally .* in 100%/)
})
