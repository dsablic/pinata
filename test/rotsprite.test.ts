import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cleanRotation, jaggies, rotateNearest, scale2x, toGrid } from '../src/style/rotsprite.ts'
import { CLEAN_STEP, cleanStep } from '../src/style/skins.ts'

const skin = JSON.parse(readFileSync('pocs/skins-spike/artist-skin.json', 'utf8')) as {
  parts: Record<string, { rows?: string[], pivotA?: [number, number], pivotB?: [number, number] }>
}
const limbs = Object.entries(skin.parts).filter(([, p]) => p.rows !== undefined && p.pivotB !== undefined)

test('Scale2x rounds a diagonal step and the outer corners, and keeps flat areas', () => {
  const grid = toGrid(['#.', '##'])
  assert.deepEqual(scale2x(grid).map(r => r.join('')), ['##..', '###.', '####', '.###'])
  assert.deepEqual(scale2x(toGrid(['aa', 'aa'])).map(r => r.join('')), ['.aa.', 'aaaa', 'aaaa', '.aa.'])
  assert.deepEqual(scale2x(toGrid(['ab', 'ba'])).map(r => r.join('')), ['.ab.', 'abab', 'baba', '.ba.'])
})

test('clean rotation keeps each sprite\'s palette, and every colour\'s area within 15% where any offset can', () => {
  let cases = 0
  let strayed = 0
  for (const [name, part] of limbs) {
    const grid = toGrid(part.rows!)
    const palette = new Set(part.rows!.join(''))
    for (let k = 1; k < 32; k++) {
      if (k % 8 === 0) continue
      const rotated = cleanRotation(grid, part.pivotA!, k * CLEAN_STEP)
      for (const row of rotated.grid) for (const c of row) assert.ok(c === '.' || palette.has(c), `${name}: '${c}'`)
      for (const c of palette) {
        if (c === '.') continue
        const before = grid.flat().filter(x => x === c).length
        const after = rotated.grid.flat().filter(x => x === c).length
        cases++
        if (Math.abs(after - before) > 0.15 * before + 1) strayed++
        assert.ok(Math.abs(after - before) <= 0.4 * before + 1, `${name} at step ${k}: '${c}' ${before} -> ${after}`)
      }
    }
  }
  assert.ok(strayed <= 0.02 * cases, `${strayed} of ${cases} colour areas strayed past 15%`)
})

test('rotation quality gate: clean rotation has at most half the jaggies of nearest-neighbour', () => {
  let nearest = 0
  let clean = 0
  for (const [, part] of limbs) {
    const grid = toGrid(part.rows!)
    for (let k = 0; k < 32; k++) {
      nearest += jaggies(rotateNearest(grid, part.pivotA!, k * CLEAN_STEP).grid)
      clean += jaggies(cleanRotation(grid, part.pivotA!, k * CLEAN_STEP).grid)
    }
  }
  assert.ok(clean <= 0.5 * nearest, `clean ${clean}, nearest ${nearest}`)
})

test('the clean angle keeps its step until the bone is well past the middle', () => {
  assert.equal(cleanStep(0.04), 0)
  assert.equal(cleanStep(0.55 * CLEAN_STEP, 0), 0)
  assert.equal(cleanStep(0.8 * CLEAN_STEP, 0), CLEAN_STEP)
  assert.equal(cleanStep(-0.7 * CLEAN_STEP, 0), 0)
  assert.equal(cleanStep(-0.8 * CLEAN_STEP, 0), -CLEAN_STEP)
})
