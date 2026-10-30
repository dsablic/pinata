import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateMannequin } from '../src/formats/mannequin.ts'
import { validateStyle } from '../src/formats/style.ts'
import { checkReferences } from '../src/formats/references.ts'

function load (file: string): unknown {
  return JSON.parse(readFileSync(new URL(`../pocs/p1-static-style/${file}`, import.meta.url), 'utf8'))
}

test('P1 assets are valid and consistent', () => {
  const mannequin = validateMannequin(load('knight.json'))
  const style = validateStyle(load('style.json'))
  assert.deepEqual(mannequin.errors, [])
  assert.deepEqual(style.errors, [])
  if (mannequin.value === undefined || style.value === undefined) return
  assert.deepEqual(checkReferences(mannequin.value, style.value), [])
})
