import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pivotMoves, responseOf, withSprite } from '../src/export/pivots.ts'
import type { Move } from '../src/export/pivots.ts'
import { takeOf } from '../src/export/record.ts'
import type { Moment, Subject } from '../src/export/record.ts'
import { VIEWS } from '../src/formats/skin.ts'
import { footNames } from '../src/style/feet.ts'
import { subjectFor } from '../src/tool/subject.ts'

const FRAMES = 6
const KNIGHT = new URL('../examples/knight', import.meta.url).pathname
const idle = (subject: Subject, frames: number): Moment[] => takeOf(subject, 'idle').frames.slice(0, frames)

const describe = (move: Move): string => {
  return `${move.view} ${move.part} ${move.delta > 0 ? '+1' : '-1'} ${move.direction}: ${JSON.stringify(move.shifts)}`
}

for (const name of ['knight', 'rogue', 'dwarf', 'wizard']) {
  test(`${name}: moving a foot sprite's pivot rows by one moves its sole by one pixel in every view`, () => {
    const subject = subjectFor(new URL(`../examples/${name}`, import.meta.url).pathname)
    const { moves, blocked } = pivotMoves(subject, idle(subject, FRAMES))
    const feet = footNames(subject.member.mannequin, subject.member.rig)
    assert.equal(new Set(moves.map(move => `${move.view} ${move.part}`)).size, VIEWS.length * feet.length)
    assert.deepEqual(blocked, [])
    const missed = moves.filter(move => !responseOf(move).pass).map(describe)
    assert.deepEqual(missed, [])
  })
}

test('a foot with no room to move its pivot rows by one is reported, not skipped', () => {
  const knight = subjectFor(KNIGHT)
  const foot = knight.look.skin.skin.views!.side.parts.footL
  const top = (pivot: [number, number]): [number, number] => [pivot[0], 0]
  const edge = { ...foot, pivotA: top(foot.pivotA!), pivotB: top(foot.pivotB!) }
  const { blocked } = pivotMoves(withSprite(knight, 'side', 'footL', edge), idle(knight, 2))
  assert.deepEqual(blocked, [{ view: 'side', part: 'footL', delta: -1 }])
})

test('measuring leaves the skin as it was, and feet sharing pivot arrays are measured one at a time', () => {
  const knight = subjectFor(KNIGHT)
  const { footL, footR } = knight.look.skin.skin.views!.side.parts
  const shared = withSprite(knight, 'side', 'footR', { ...footR, pivotA: footL.pivotA, pivotB: footL.pivotB })
  const before = JSON.stringify(shared.look.skin.skin)
  const { moves } = pivotMoves(shared, idle(shared, 2))
  assert.equal(JSON.stringify(shared.look.skin.skin), before)
  assert.deepEqual(moves.filter(move => !responseOf(move).pass).map(describe), [])
})
