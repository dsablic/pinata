import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
  assert.match(run(newCli, ['--template', 'biped']).stderr, /^usage: npm run new -- --template <biped\|/)
  const full = mkdtempSync(join(scratch, 'full-'))
  writeFileSync(join(full, 'keep.txt'), 'mine')
  const refused = run(newCli, ['--template', 'biped', full])
  assert.equal(refused.status, 2)
  assert.match(refused.stderr, /already exists and is not an empty directory/)
  assert.deepEqual(readdirSync(full), ['keep.txt'])
})
