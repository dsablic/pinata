import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createImage, setPixel } from '../src/image.ts'
import type { Image } from '../src/image.ts'
import { lintPanel } from '../src/judge/lint.ts'
import {
  buildRubricPacket, DIMENSIONS, rubricProblems, scoreRubric, usableAnswers, validateRubricSpec
} from '../src/judge/rubric.ts'
import type { RubricAnswers, RubricKey, RubricSpec } from '../src/judge/rubric.ts'
import { problemsWithAnswers } from '../src/judge/answers.ts'
import { runJudge } from '../src/judge/runner.ts'
import type { Ask } from '../src/judge/runner.ts'
import { failed, validate } from '../src/benchmark/gate.ts'

const solid = (): Image => {
  const image = createImage(4, 4)
  setPixel(image, 1, 1, 0xff0000)
  return image
}
const SPEC: RubricSpec = {
  kind: 'rubric', name: 'Craft round', seed: 's', scale: 2, gap: 1, background: '#c8c8c8',
  items: [
    { id: 'fluidity--one', a: 'x.png', b: 'y.png' },
    { id: 'control--one', a: 'x.png', b: 'x.png', control: true },
    { id: 'lone', a: 'x.png' }
  ]
}
const { key, questions } = buildRubricPacket(SPEC, solid)
const sideOf = (name: string): string | undefined => key.items[name].aSide
const namesOf = (item: string): string[] => Object.keys(key.items).filter(name => key.items[name].item === item)

function ratings (top: number, bottom: number): RubricAnswers[string] {
  const each = Object.fromEntries(DIMENSIONS.map(d => [d.id, { top, bottom }]))
  return { ratings: each, ship: 'top' }
}

function judgedByContent (rate: (item: string, role: 'a' | 'b') => number): RubricAnswers {
  return Object.fromEntries(Object.entries(key.items).map(([name, entry]) => {
    if (entry.aSide === undefined) {
      return [name, { ratings: Object.fromEntries(DIMENSIONS.map(d => [d.id, rate(entry.item, 'a')])) }]
    }
    const [a, b] = [rate(entry.item, 'a'), rate(entry.item, 'b')]
    const [top, bottom] = entry.aSide === 'top' ? [a, b] : [b, a]
    return [name, ratings(top, bottom)]
  }))
}

test('a pair is shown twice with a and b swapped, a single animation once', () => {
  assert.deepEqual(namesOf('fluidity--one').map(sideOf).sort(), ['bottom', 'top'])
  assert.equal(namesOf('lone').length, 1)
  assert.equal(sideOf(namesOf('lone')[0]), undefined)
  assert.match(questions, /Images [^.]*show two animations/)
  assert.match(questions, new RegExp(`${namesOf('lone')[0]} show one animation`))
})

test('a spec refuses a control without a second animation, a control of two animations, and a repeated id', () => {
  const bad = { ...SPEC, items: [{ id: 'a', a: 'x.png', control: true }, { id: 'a', a: 'x.png' }] }
  const messages = validateRubricSpec(bad).errors.map(e => e.message).join('\n')
  assert.match(messages, /only on an item with a and b/)
  assert.match(messages, /used twice/)
  const different = { ...SPEC, items: [{ id: 'c', a: 'x.png', b: 'y.png', control: true }] }
  assert.match(validateRubricSpec(different).errors.map(e => e.message).join('\n'), /b must equal a/)
  assert.equal(validateRubricSpec(SPEC).errors.length, 0)
})

test('the lint asks for a control and for a name that does not match the items', () => {
  const noControl = { ...SPEC, items: [SPEC.items[0]] }
  assert.match(lintPanel(noControl, {}).join('\n'), /needs at least one control/)
  assert.match(lintPanel({ ...SPEC, name: 'Fluidity round' }, {}).join('\n'), /fluidity/)
  assert.deepEqual(lintPanel(SPEC, {}), [])
})

test('answers are checked per image: dimensions, whole 1-5 numbers, the ship choice, unknown images', () => {
  const [pair] = namesOf('fluidity--one')
  const [lone] = namesOf('lone')
  const good = judgedByContent(() => 3)
  assert.deepEqual(rubricProblems(good, key), [])
  assert.deepEqual(problemsWithAnswers(good, key), [])
  const broken = {
    ...good,
    [pair]: {
      ratings: { ...ratings(3, 3).ratings, fluidity: { top: 6, bottom: 3 }, weight: undefined },
      ship: 'middle'
    },
    [lone]: { ratings: { ...(good[lone].ratings), appeal: 2.5 }, ship: 'top' },
    extra: ratings(3, 3)
  }
  const problems = rubricProblems(broken, key).join('\n')
  assert.match(problems, new RegExp(`${pair}: fluidity should be`))
  assert.match(problems, new RegExp(`${pair}: weight should be`))
  assert.match(problems, new RegExp(`${pair}: ship should be`))
  assert.match(problems, new RegExp(`${lone}: appeal should be a whole number`))
  assert.match(problems, new RegExp(`${lone}: a single animation takes no ship`))
  assert.match(problems, /extra: not in the panel/)
  assert.match(rubricProblems({}, key).join('\n'), /: missing/)
})

test('scores count a above b in both orders, so a position bias cancels', () => {
  const byContent = scoreRubric(key, [judgedByContent((item, role) => {
    return item.startsWith('control') ? 3 : role === 'a' ? 5 : 2
  })])
  const pair = byContent.pairs.find(p => p.pair === 'fluidity--one')!
  assert.equal(pair.dimensions[0].aAbove, 2)
  assert.equal(pair.dimensions[0].answers, 2)
  assert.equal(pair.dimensions[0].meanA, 5)
  assert.equal(pair.meanDifference, 3)
  assert.equal(byContent.controlDifference, 0)
  const topFavoured: RubricAnswers = Object.fromEntries(
    Object.entries(key.items).filter(([, e]) => e.aSide !== undefined).map(([name]) => [name, ratings(4, 2)])
  )
  const biased = scoreRubric(key, [topFavoured])
  assert.equal(biased.pairs.find(p => p.pair === 'fluidity--one')!.dimensions[0].aAbove, 1)
  const alone = byContent.singles[0]
  assert.equal(alone.item, 'lone')
  assert.equal(alone.means.fluidity, 5)
})

test('a judge that always rates the top higher makes the controls unstable', () => {
  const topFavoured: RubricAnswers = Object.fromEntries(
    Object.entries(key.items).filter(([, e]) => e.aSide !== undefined).map(([name]) => [name, ratings(4, 3)])
  )
  const score = scoreRubric(key, [topFavoured])
  assert.equal(score.controlDifference, 1)
  assert.equal(validate(score).controlPass, false)
  const steady = scoreRubric(key, [judgedByContent(() => 3)])
  assert.equal(validate(steady).controlPass, true)
})

test('answers an item lacks, or has invalid, count as wrong and not as fewer answers', () => {
  const content = (item: string, role: 'a' | 'b'): number => item.startsWith('fluidity') && role === 'b' ? 2 : 4
  const full = judgedByContent(content)
  const [first] = namesOf('fluidity--one')
  const partial = { ...full, [first]: { ratings: {} } }
  const usable = usableAnswers(partial, key)
  assert.equal(usable[first], undefined)
  assert.equal(Object.keys(usable).length, Object.keys(key.items).length - 1)
  const fluidity = validate(scoreRubric(key, [full, usable])).rows[0]
  assert.deepEqual([fluidity.above, fluidity.answers, fluidity.expected, fluidity.share], [3, 3, 4, 0.75])
  assert.equal(fluidity.pass, false)
  const controlNames = namesOf('control--one')
  const lost = usableAnswers({ ...full, ...Object.fromEntries(controlNames.map(n => [n, { ratings: {} }])) }, key)
  const noControl = validate(scoreRubric(key, [lost]))
  assert.equal(noControl.controlPass, false)
  assert.equal(Number.isNaN(noControl.controlDifference), true)
})

test('the validation gate needs the reference above its degraded copy in 80% of answers', () => {
  const judges = (reference: number, degraded: number): RubricAnswers[] => [judgedByContent((item, role) => {
    return item.startsWith('fluidity') ? (role === 'a' ? reference : degraded) : 3
  })]
  const passing = validate(scoreRubric(key, judges(4, 2)))
  assert.deepEqual(passing.rows.map(r => [r.dimension, r.share, r.pass]), [['fluidity', 1, true]])
  assert.equal(passing.controlPass, true)
  const tied = validate(scoreRubric(key, judges(3, 3)))
  assert.equal(tied.rows[0].pass, false)
  assert.ok(passing.untested.includes('weight') && !passing.untested.includes('fluidity'))
})

test('a judge that answers badly is asked again, and the rubric answers are checked by the runner', async () => {
  const good = JSON.stringify(judgedByContent(() => 3))
  const broken = JSON.stringify(Object.fromEntries(Object.keys(key.items).map(name => [name, { ratings: {} }])))
  const replies = [broken, good]
  const ask: Ask = async () => ({ text: replies.shift() as string, durationMs: 1 })
  const run = await runJudge(ask, 'haiku', '.', key as RubricKey)
  assert.equal(run.attempts, 2)
  assert.equal(Object.keys(run.answers).length, Object.keys(key.items).length)
})

test('the gate command exits 0 when kept and stable, 1 when dropped or unstable, 2 on unreadable input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pinata-gate-'))
  try {
    const write = (name: string, value: unknown): string => {
      const path = join(dir, name)
      writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value))
      return path
    }
    const keyPath = write('key.json', key)
    const content = (reference: number): RubricAnswers => judgedByContent((item, role) => {
      return item.startsWith('fluidity') ? (role === 'a' ? reference : 2) : 3
    })
    const run = (...paths: string[]): ReturnType<typeof spawnSync> => {
      return spawnSync('node', ['src/cli/benchmark.ts', 'gate', keyPath, ...paths], { encoding: 'utf8' })
    }
    const kept = run(write('good.json', content(4)))
    assert.equal(kept.status, 0)
    assert.match(String(kept.stdout), /fluidity: .*kept/)
    const dropped = run(write('flat.json', content(2)))
    assert.equal(dropped.status, 1)
    assert.match(String(dropped.stdout), /fluidity: .*dropped/)
    const bad = run(write('broken.json', '{ nope'))
    assert.equal(bad.status, 2)
    assert.match(String(bad.stderr), /broken\.json/)
    const invalid = run(write('invalid.json', { [Object.keys(key.items)[0]]: { ratings: {} } }))
    assert.equal(invalid.status, 1)
    assert.match(String(invalid.stderr), /counted as wrong/)
    assert.equal(failed(validate(scoreRubric(key, []))), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
