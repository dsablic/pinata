import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ok = new URL('./fixtures/character-ok', import.meta.url).pathname
const invalid = new URL('./fixtures/character-invalid', import.meta.url).pathname
const cli = new URL('../src/cli/check.ts', import.meta.url).pathname

type Run = { status: number | null, stdout: string, stderr: string, out: string }

function check (dir: string, out = mkdtempSync(join(tmpdir(), 'pinata-report-'))): Run {
  const run = spawnSync(process.execPath, [cli, dir, '--out', out], { encoding: 'utf8' })
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, out }
}

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

test('a valid character passes every gate and writes the summary and stills', () => {
  const run = check(ok)
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const summary = readFileSync(join(run.out, 'summary.txt'), 'utf8')
  assert.match(summary, /^PASS {2}footSlidePx: /m)
  assert.match(summary, /^PASS {2}maxStrain: /m)
  assert.match(summary, /automated gates: PASS/)
  for (const file of ['sheet.png', 'walk.png', 'footprints.png', 'cloth.png', 'metrics.json']) {
    assert.ok(existsSync(join(run.out, file)), file)
  }
  rmSync(run.out, { recursive: true })
})

test('an invalid package exits 2 and lists every error with its file name', () => {
  const run = check(invalid)
  assert.equal(run.status, 2)
  assert.match(run.stderr, /^mannequin\.json: parts\[0\]\.radiusA: /m)
  assert.match(run.stderr, /^motion\.json: name: unknown field/m)
  assert.match(run.stderr, /^motion\.json: fps: /m)
  assert.match(readFileSync(join(run.out, 'summary.txt'), 'utf8'), /automated gates: ERROR/)
  rmSync(run.out, { recursive: true })
})

test('a missing directory and missing arguments exit 2', () => {
  assert.equal(check('/nonexistent/character').status, 2)
  assert.equal(spawnSync(process.execPath, [cli], { encoding: 'utf8' }).status, 2)
})

test('a thin part fails maxThinFraction with a hint naming the part and the width to use', () => {
  const dir = variant(d => {
    patch(d, 'mannequin.json', j => {
      for (const part of j.parts) if (part.name === 'forearmL') Object.assign(part, { radiusA: 0.012, radiusB: 0.012 })
    })
  })
  const run = check(dir)
  assert.equal(run.status, 1, run.stdout + run.stderr)
  const summary = readFileSync(join(run.out, 'summary.txt'), 'utf8')
  assert.match(summary, /^FAIL {2}maxThinFraction: /m)
  assert.match(summary, /hint: thin parts at \d+px.*'forearmL'.*at least 0\.\d\d m across.*allowThin/)
  rmSync(dir, { recursive: true })
  rmSync(run.out, { recursive: true })
})

test('a window with too few plants makes rootSpeedError non-finite and the hint says why', () => {
  const dir = variant(d => {
    patch(d, 'motion.json', j => { j.script.segments[0].duration = 0.8 })
  })
  const run = check(dir)
  const summary = readFileSync(join(run.out, 'summary.txt'), 'utf8')
  assert.match(summary, /^FAIL {2}rootSpeedError: Infinity /m)
  assert.match(summary, /hint: the metric is not finite.*neither foot has two plants.*longer/)
  rmSync(dir, { recursive: true })
  rmSync(run.out, { recursive: true })
})

test('a character without cloth skips the cloth gates and the cloth still', () => {
  const dir = variant(d => { patch(d, 'motion.json', j => { delete j.cape }) })
  const run = check(dir)
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const summary = readFileSync(join(run.out, 'summary.txt'), 'utf8')
  assert.doesNotMatch(summary, /nonFinite/)
  assert.ok(!existsSync(join(run.out, 'cloth.png')))
  rmSync(dir, { recursive: true })
  rmSync(run.out, { recursive: true })
})
