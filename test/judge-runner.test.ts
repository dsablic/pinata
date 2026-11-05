import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractAnswers } from '../src/judge/answers.ts'
import { replyOf } from '../src/judge/claude.ts'
import type { ChoiceSpec } from '../src/judge/choice.ts'
import { keyInsidePacket, lintPanel, strayFiles } from '../src/judge/lint.ts'
import type { Size } from '../src/judge/lint.ts'
import { buildPacket } from '../src/judge/packet.ts'
import type { PanelKey, PanelSpec } from '../src/judge/packet.ts'
import { createImage } from '../src/image.ts'
import type { Image } from '../src/image.ts'
import { runJudge, runJudges } from '../src/judge/runner.ts'
import type { Ask, Reply } from '../src/judge/runner.ts'

const panel: PanelSpec = {
  name: 'Polish round',
  seed: 's',
  question: 'Which is better?',
  scale: 4,
  gap: 2,
  background: '#c8c8c8',
  pairs: [
    { id: 'p1', a: 'knight.png', b: 'ref.png' },
    { id: 'c1', a: 'ref.png', b: 'ref.png', control: true }
  ]
}
const SIZES: Record<string, Size> = {
  'knight.png': { width: 10, height: 10 },
  'ref.png': { width: 10, height: 10 },
  'strip.png': { width: 60, height: 10 },
  'tall.png': { width: 10, height: 40 }
}
const load = (path: string): Image => createImage(SIZES[path].width, SIZES[path].height)
const shown = (spec: PanelSpec): Record<string, Size> => buildPacket(spec, load).images
const withPairs = (pairs: PanelSpec['pairs'], more: Partial<PanelSpec> = {}): PanelSpec => {
  return { ...panel, ...more, pairs }
}

test('a clean panel passes the lint', () => {
  assert.deepEqual(lintPanel(panel, shown(panel)), [])
})

test('the lint refuses a panel name sharing a word with an id, a file name or a label', () => {
  const byId = lintPanel({ ...panel, name: 'Knight upgrade' }, {})
  assert.equal(byId.length, 1)
  assert.match(byId[0], /'knight'/)
  assert.match(lintPanel({ ...panel, name: 'REF check' }, {})[0], /'ref'/)
  const choice: ChoiceSpec = {
    kind: 'choice', name: 'Which direction', seed: 's', question: 'q', labels: ['left side', 'direction'],
    scale: 4, background: '#c8c8c8', items: [{ id: 'one', image: 'knight.png', label: 'direction' }]
  }
  assert.match(lintPanel(choice, {})[0], /'direction'/)
  assert.deepEqual(lintPanel({ ...panel, name: 'The panel of a test' }, {}), [])
})

test('the lint refuses a name that matches an id by plural or by a shared stem', () => {
  assert.match(lintPanel({ ...panel, name: 'Knights round' }, {})[0], /'knight'/)
  assert.match(lintPanel({ ...panel, name: 'Knighted' }, {})[0], /'knight'/)
  assert.deepEqual(lintPanel({ ...panel, name: 'Knit round' }, {}), [])
})

test('the lint refuses a pairwise panel without a control', () => {
  const problems = lintPanel(withPairs([{ id: 'p1', a: 'knight.png', b: 'ref.png' }]), {})
  assert.match(problems.join('\n'), /at least one control/)
})

test('the lint measures the composed images: wide strips side by side fail, stacked pass', () => {
  const strips = withPairs([{ id: 'p1', a: 'strip.png', b: 'ref.png' }, panel.pairs[1]])
  const side = lintPanel(strips, shown(strips)).join('\n')
  assert.match(side, /item-\d+/)
  assert.match(side, /"layout": "stacked"/)
  const stacked = { ...strips, layout: 'stacked' as const }
  assert.deepEqual(lintPanel(stacked, shown(stacked)), [])
  const tall = withPairs([{ id: 'p1', a: 'tall.png', b: 'ref.png' }, panel.pairs[1]])
  assert.deepEqual(lintPanel(tall, shown(tall)), [])
})

test('a key inside the packet folder is found, also by a path that climbs out and back', () => {
  const dir = process.cwd()
  assert.equal(keyInsidePacket(`${dir}/key.json`, dir), true)
  assert.equal(keyInsidePacket(`${dir}/../key.json`, dir), false)
})

test('the judges folder check names a stray file and a missing one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lint-test-'))
  try {
    writeFileSync(join(dir, 'questions.md'), '')
    assert.deepEqual(strayFiles(dir, ['questions.md']), [])
    writeFileSync(join(dir, 'key.json'), '')
    assert.deepEqual(strayFiles(dir, ['questions.md']), ['key.json'])
    assert.deepEqual(strayFiles(dir, ['questions.md', 'item-01.png']), ['key.json', 'item-01.png'])
  } finally {
    rmSync(dir, { recursive: true })
  }
})

const ANSWERS = { 'item-01': { choice: 'left' }, 'item-02': { choice: 'cant_tell' } }
const KEY: PanelKey = {
  name: 'n',
  items: {
    'item-01': { pair: 'p1', control: false, aSide: 'left' },
    'item-02': { pair: 'p1', control: false, aSide: 'right' }
  }
}

const ITEMS = Object.keys(KEY.items)

test('answers are found in plain, fenced and chattered replies', () => {
  const json = JSON.stringify(ANSWERS)
  assert.deepEqual(extractAnswers(json, ITEMS), ANSWERS)
  assert.deepEqual(extractAnswers(`\`\`\`json\n${json}\n\`\`\``, ITEMS), ANSWERS)
  assert.deepEqual(extractAnswers(`Here is my answer {not json} for you:\n${json}\nHope it helps {x}.`, ITEMS), ANSWERS)
  assert.deepEqual(extractAnswers(`Format: { "choice": "left" }. Mine: ${json}`, ITEMS), ANSWERS)
  assert.equal(extractAnswers('I could not open the images.', ITEMS), undefined)
  assert.equal(extractAnswers('{}', ITEMS), undefined)
})

test('a later answer corrects an earlier one, and objects with other keys are never taken', () => {
  const corrected = { ...ANSWERS, 'item-02': { choice: 'right' } }
  const reply = `First ${JSON.stringify(ANSWERS)}\nOn reflection ${JSON.stringify(corrected)}`
  assert.deepEqual(extractAnswers(reply, ITEMS), corrected)
  const bigger = `${JSON.stringify(ANSWERS)} and then ${JSON.stringify({ note: 1, other: 2, third: 3 })}`
  assert.deepEqual(extractAnswers(bigger, ITEMS), ANSWERS)
})

test('on a single-item panel the nested choice object is not taken for the answer', () => {
  assert.equal(extractAnswers('{"choice": "left"}', ['item-01']), undefined)
  assert.deepEqual(extractAnswers('{"item-01": {"choice": "left"}}', ['item-01']), { 'item-01': { choice: 'left' } })
})

test('claude output is read for its result, duration and cost, and an error is refused', () => {
  const ok = JSON.stringify({ result: 'hi', duration_ms: 1200, total_cost_usd: 0.5, is_error: false })
  assert.deepEqual(replyOf(ok), { text: 'hi', durationMs: 1200, costUsd: 0.5 })
  assert.throws(() => replyOf(JSON.stringify({ result: 'boom', is_error: true })), /boom/)
})

function scripted (...texts: string[]): { ask: Ask, calls: string[] } {
  const calls: string[] = []
  const ask: Ask = async (model): Promise<Reply> => {
    calls.push(model)
    return { text: texts[Math.min(calls.length, texts.length) - 1], durationMs: 100, costUsd: 0.25 }
  }
  return { ask, calls }
}

test('a judge with a missing item or a wrong choice is asked once more and the cost adds up', async () => {
  const missing = JSON.stringify({ 'item-01': { choice: 'left' } })
  const wrong = JSON.stringify({ ...ANSWERS, 'item-02': { choice: 'up' } })
  for (const bad of [missing, wrong, 'no JSON here']) {
    const { ask, calls } = scripted(bad, JSON.stringify(ANSWERS))
    const run = await runJudge(ask, 'haiku', '.', KEY)
    assert.deepEqual(run.answers, ANSWERS)
    assert.equal(run.attempts, 2)
    assert.equal(run.costUsd, 0.5)
    assert.equal(run.durationMs, 200)
    assert.equal(calls.length, 2)
  }
})

test('a judge that stays malformed fails clearly without sinking the others', async () => {
  const ask: Ask = async (model): Promise<Reply> => {
    const text = model === 'sonnet' ? '{"item-01": {"choice": "left"}}' : JSON.stringify(ANSWERS)
    return { text, durationMs: 1, costUsd: 0.1 }
  }
  const outcomes = await runJudges(ask, '.', KEY)
  assert.deepEqual(outcomes.map(o => o.model), ['opus', 'sonnet', 'haiku'])
  assert.deepEqual(outcomes.map(o => o.run !== undefined), [true, false, true])
  assert.match(outcomes[1].failure ?? '', /item-02: missing.*after 2 attempts/)
  assert.deepEqual(outcomes[1].spent, { durationMs: 2, costUsd: 0.2, attempts: 2 })
})

test('a judge that times out on its second attempt still reports what the first one cost', async () => {
  let calls = 0
  const ask: Ask = async (): Promise<Reply> => {
    if (++calls === 2) throw new Error('haiku did not answer')
    return { text: 'no JSON here', durationMs: 5, costUsd: 0.3 }
  }
  const [outcome] = await runJudges(ask, '.', KEY, ['haiku'])
  assert.equal(outcome.failure, 'haiku did not answer')
  assert.equal(outcome.spent?.attempts, 2)
  assert.equal(outcome.spent?.costUsd, 0.3)
})

test('a panel that asks for ratings rejects an answer without them', async () => {
  const { ask } = scripted(JSON.stringify(ANSWERS))
  await assert.rejects(runJudge(ask, 'opus', '.', { ...KEY, rating: true }), /missing rating/)
})
