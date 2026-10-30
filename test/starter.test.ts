import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkRig, validateRig } from '../src/formats/rig.ts'
import { starterPackage } from '../src/formats/starter.ts'
import { TEMPLATE_NAMES } from '../src/formats/templates.ts'

const newCli = new URL('../src/cli/new.ts', import.meta.url).pathname
const checkCli = new URL('../src/cli/check.ts', import.meta.url).pathname
const scratch = mkdtempSync(join(tmpdir(), 'pinata-starter-'))

after(() => { rmSync(scratch, { recursive: true, force: true }) })

function run (cli: string, args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
}

for (const template of TEMPLATE_NAMES) {
  test(`the ${template} starter passes check`, () => {
    const dir = join(scratch, template)
    const made = run(newCli, ['--template', template, dir])
    assert.equal(made.status, 0, made.stderr)
    assert.deepEqual(readdirSync(dir).sort(), [
      'character.json', 'mannequin.json', 'materials.json', 'motion.json', 'rig.json', 'style.json'
    ])
    const checked = run(checkCli, [dir, '--out', join(dir, 'report')])
    assert.equal(checked.status, 0, checked.stdout + checked.stderr)
  })
}

test('new writes into an existing empty directory exactly what starterPackage returns', () => {
  const dir = mkdtempSync(join(scratch, 'empty-'))
  assert.equal(run(newCli, ['--template', 'octopod', dir]).status, 0)
  for (const [name, value] of Object.entries(starterPackage('octopod'))) {
    assert.deepEqual(JSON.parse(readFileSync(join(dir, name), 'utf8')), value, name)
  }
})

test('starter rigs name their template and validate', () => {
  for (const template of TEMPLATE_NAMES) {
    const files = starterPackage(template)
    const rig = validateRig(structuredClone(files['rig.json']))
    assert.deepEqual(rig.errors, [], template)
    assert.equal(rig.value?.template, template)
    const mannequin = files['mannequin.json'] as Parameters<typeof checkRig>[1]
    assert.deepEqual(checkRig(rig.value!, mannequin), [], template)
  }
})

test('new refuses an unknown template, a missing directory argument and a non-empty directory', () => {
  const unknown = run(newCli, ['--template', 'centipede', join(scratch, 'x')])
  assert.equal(unknown.status, 2)
  assert.match(unknown.stderr, /unknown template 'centipede'; choose one of:\n {2}biped: /)
  const missing = run(newCli, ['--template', 'biped'])
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /^usage: npm run new -- --template <biped\|/)
  assert.match(run(newCli, ['--template', 'biped', '--template', 'hexapod', 'x']).stderr, /--template given twice/)
  assert.match(run(newCli, ['--template', 'biped', '-x']).stderr, /unknown option '-x'/)
  const file = join(scratch, 'a-file')
  writeFileSync(file, '')
  const blocked = run(newCli, ['--template', 'biped', join(file, 'starter')])
  assert.equal(blocked.status, 2)
  assert.match(blocked.stderr, /^could not write the starter to '.*a-file\/starter': /)
  const full = mkdtempSync(join(scratch, 'full-'))
  writeFileSync(join(full, 'keep.txt'), 'mine')
  const refused = run(newCli, ['--template', 'biped', full])
  assert.equal(refused.status, 2)
  assert.match(refused.stderr, /already exists and is not an empty directory/)
  assert.deepEqual(readdirSync(full), ['keep.txt'])
})

for (const example of ['beetle', 'spider', 'horse']) {
  test(`examples/${example} passes check`, () => {
    const dir = new URL(`../examples/${example}`, import.meta.url).pathname
    const checked = run(checkCli, [dir, '--out', join(scratch, `${example}-report`)])
    assert.equal(checked.status, 0, checked.stdout + checked.stderr)
  })
}
