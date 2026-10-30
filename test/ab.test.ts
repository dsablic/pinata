import { test } from 'node:test'
import assert from 'node:assert/strict'
import { frameFor, planAb, pngHeight } from '../pocs/p1-static-style/ab.ts'

const refs = [
  { name: 'a-32.png', height: 30 },
  { name: 'b-48.png', height: 63 },
  { name: 'c-48.png', height: 45 },
  { name: 'd-32.png', height: 39 }
]

test('frameFor picks size by reference height and rotates directions', () => {
  assert.equal(frameFor(30, 0), '32px-el30-d0')
  assert.equal(frameFor(40, 1), '48px-el30-d1')
  assert.equal(frameFor(63, 2), '48px-el30-d7')
  assert.equal(frameFor(63, 3), '48px-el30-d0')
})

test('planAb alternates sides and is independent of input order', () => {
  const plan = planAb(refs)
  assert.deepEqual(plan.map(p => p.ours), ['left', 'right', 'left', 'right'])
  assert.deepEqual(plan.map(p => p.pair), [1, 2, 3, 4])
  assert.deepEqual(planAb([...refs].reverse()), plan)
})

test('planAb uses distinct frames for three or fewer pairs', () => {
  const frames = planAb(refs.slice(0, 3)).map(p => p.frame)
  assert.equal(new Set(frames).size, 3)
})

test('pngHeight reads the IHDR height', () => {
  const bytes = new Uint8Array(33)
  new DataView(bytes.buffer).setUint32(20, 63)
  assert.equal(pngHeight(bytes), 63)
})
