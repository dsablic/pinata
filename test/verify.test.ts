import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changeOf, describeFiles, hashLines, isUnchanged } from '../src/checks/baseline.ts'
import { parseArgs, selected, shouldRetry, summaryOf } from '../src/checks/verify.ts'

const STEPS = ['typecheck', 'test', 'rendering-panel', 'gates']
const BASELINED = ['rendering-panel', 'gates']

test('hashes name every file, and a changed byte changes only that file', () => {
  const before = hashLines({ 'a.png': Buffer.from([1, 2]), 'b.png': Buffer.from([3]) })
  const after = hashLines({ 'a.png': Buffer.from([1, 2]), 'b.png': Buffer.from([4]), 'c.png': Buffer.from([5]) })
  const change = changeOf(before, after)
  assert.equal(isUnchanged(changeOf(before, before)), true)
  assert.equal(describeFiles(change), 'changed b.png; added c.png')
  assert.equal(describeFiles(changeOf(after, before)), 'changed b.png; removed c.png')
})

test('arguments: only, skip and accept choose steps; mistakes are reported', () => {
  const choose = (...argv: string[]): string[] => selected(STEPS, parseArgs(argv, STEPS, BASELINED))
  assert.deepEqual(choose(), STEPS)
  assert.deepEqual(choose('--only', 'test,gates'), ['test', 'gates'])
  assert.deepEqual(choose('--skip', 'rendering-panel,gates'), ['typecheck', 'test'])
  assert.deepEqual(choose('--accept', 'all'), BASELINED)
  assert.equal(parseArgs(['--accept', 'test'], STEPS, BASELINED).problems.length, 1)
  assert.equal(parseArgs(['--only', 'nope'], STEPS, BASELINED).problems.length, 1)
  assert.equal(parseArgs(['--fast'], STEPS, BASELINED).problems.length, 1)
})

test('summary names the failed and changed steps', () => {
  const lines = summaryOf([
    ['test', { status: 'fail', headline: '', detail: [] }],
    ['gates', { status: 'changed', headline: '', detail: [] }],
    ['lint', { status: 'pass', headline: '', detail: [] }]
  ], 3)
  assert.match(lines.join('\n'), /1 passed, 1 failed, 1 changed[^]*failed: test[^]*changed: gates/)
})

test('only a busy debugging port or a lost mouse event is retried', () => {
  assert.equal(shouldRetry('Error: listen EADDRINUSE 9222'), true)
  assert.equal(shouldRetry('dispatchMouseEvent timed out'), true)
  assert.equal(shouldRetry('assertion failed'), false)
})
