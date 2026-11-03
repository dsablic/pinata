import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strideOf, validateSkin } from '../src/formats/skin.ts'
import type { Walk } from '../src/formats/skin.ts'
import { mirroredWalk } from '../src/style/walk.ts'
import { ROOT } from '../src/cli/paths.ts'
import { readWalk } from '../src/diagnostics/walk-frames.ts'

const knight = JSON.parse(readFileSync(join(ROOT, 'examples', 'knight', 'skin.json'), 'utf8'))
const walk = readWalk(ROOT, 'knight-side')

function withWalk (view: string, own: unknown): ReturnType<typeof validateSkin> {
  const views = { ...knight.views, [view]: { ...knight.views[view], walk: own } }
  return validateSkin({ ...knight, views })
}

function errorPaths (own: unknown, view = 'side'): string[] {
  return [...new Set(withWalk(view, own).errors.map(e => e.path))]
}

function edited (change: (frames: Walk['frames']) => void): Walk {
  const copy = structuredClone(walk)
  change(copy.frames)
  return copy
}

test('a drawn walk on a view passes and has a stride forward', () => {
  assert.deepEqual(withWalk('side', walk).errors, [])
  assert.ok(strideOf(walk) > 0)
})

test('a walk needs four frames, all one size, with palette colours and soles inside the frame', () => {
  assert.deepEqual(errorPaths({ frames: walk.frames.slice(0, 3) }), ['views.side.walk.frames'])
  const narrow = edited(frames => { frames[2].rows = frames[2].rows.map(row => row.slice(1)) })
  assert.ok(errorPaths(narrow).includes('views.side.walk.frames'))
  const stray = edited(frames => { frames[1].rows[10] = `z${frames[1].rows[10].slice(1)}` })
  assert.deepEqual(errorPaths(stray), ['views.side.walk.frames[1].rows[10]'])
  const outside = edited(frames => { frames[0].soles[1] = [99, 3] })
  assert.deepEqual(errorPaths(outside), ['views.side.walk.frames[0].soles[1]'])
})

test('both feet must be planted somewhere, and the planted sole must move backwards', () => {
  const oneFooted = edited(frames => frames.forEach(frame => { frame.planted = 0 }))
  assert.ok(errorPaths(oneFooted).includes('views.side.walk.frames'))
  const backwards = { frames: [...walk.frames].reverse() }
  assert.ok(errorPaths(backwards).includes('views.side.walk.frames'))
})

test('walk frames belong on side views only, not on a view with no sideways stride', () => {
  assert.deepEqual(errorPaths(walk, 'front'), ['views.front.walk'])
})

test('a mirrored walk faces the other way: columns reversed, feet swapped, planted foot swapped', () => {
  const [frame] = walk.frames
  const [flipped] = mirroredWalk(walk).frames
  const width = frame.rows[0].length
  assert.equal(flipped.rows[5], [...frame.rows[5]].reverse().join(''))
  assert.deepEqual(flipped.soles[0], [width - 1 - frame.soles[1][0], frame.soles[1][1]])
  assert.deepEqual(flipped.soles[1], [width - 1 - frame.soles[0][0], frame.soles[0][1]])
  assert.equal(flipped.planted, 1 - frame.planted)
  assert.deepEqual(mirroredWalk(mirroredWalk(walk)).frames[3], walk.frames[3])
  assert.equal(strideOf(mirroredWalk(walk)), -strideOf(walk))
})
