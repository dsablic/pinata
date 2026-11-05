import { test } from 'node:test'
import assert from 'node:assert/strict'
import { caseFailures, declareGate, declaredGates } from '../src/checks/gate-spec.ts'
import { checksOf, GATES } from '../src/export/report.ts'
import { feetFrame, planted, recordingOf, trackOf } from './export-fixtures.ts'
import './export-gate-specs.ts'

test('every export gate is declared with a failing and a passing case', () => {
  assert.deepEqual(declaredGates().map(spec => spec.gate).sort(), [...GATES].sort())
  for (const spec of declaredGates()) {
    assert.ok(spec.frame !== '' && spec.threshold !== '', `${spec.gate} names its frame and threshold`)
    assert.ok(spec.bad.length > 0 && spec.good.length > 0, `${spec.gate} has both kinds of case`)
  }
})

test('a gate cannot be declared twice', () => {
  assert.throws(() => declareGate(declaredGates()[0]), /declared twice/)
})

test('the export report emits every declared gate', () => {
  const idle = trackOf([feetFrame([planted(0)]), feetFrame([planted(0)])], { behaviour: 'idle', loop: true })
  const emitted = new Set(checksOf(recordingOf([idle])).map(check => check.gate))
  assert.deepEqual([...emitted].sort(), [...GATES].sort())
})

test('every declared gate gives the expected verdict on each of its cases', () => {
  assert.deepEqual(declaredGates().flatMap(caseFailures), [])
})
