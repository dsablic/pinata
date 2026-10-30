import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readArtifact } from '../src/runtime/artifact.ts'

const cli = new URL('../src/cli/artifact.ts', import.meta.url).pathname
const unicorn = new URL('../examples/unicorn', import.meta.url).pathname

test('the unicorn builds into a small live artifact that reads back as a character', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pinata-artifact-'))
  try {
    const out = join(dir, 'unicorn.json')
    const run = spawnSync(process.execPath, [cli, unicorn, out], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    const text = readFileSync(out, 'utf8')
    assert.ok(text.length < 16 * 1024, `${text.length} bytes`)
    const read = readArtifact(JSON.parse(text))
    assert.deepEqual(read.errors, [])
    assert.equal(read.value?.name, 'unicorn')
    assert.ok(read.value?.rig.limbs.some(limb => limb.kind === 'appendage'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a broken artifact names the part of the file that is wrong', () => {
  const artifact = JSON.parse(readFileSync(join(unicorn, 'behaviours.json'), 'utf8'))
  assert.match(readArtifact({}).errors[0].message, /pinata-live/)
  const errors = readArtifact({
    format: 'pinata-live', version: 1, name: 'x', mannequin: {}, style: {}, rig: {}, behaviours: artifact
  }).errors.map(e => e.path)
  assert.ok(errors.some(p => p.startsWith('mannequin')))
  assert.ok(errors.some(p => p.startsWith('rig')))
  assert.ok(!errors.some(p => p.startsWith('behaviours')))
})
