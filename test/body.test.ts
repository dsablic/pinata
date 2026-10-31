import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Mannequin } from '../src/formats/mannequin.ts'
import { anchorWorld, bodyCollider } from '../src/sim/body.ts'
import { assertClose } from './helpers.ts'
import { ball, rootAt } from './rendering-fixtures.ts'

function mannequin (): Mannequin {
  return {
    name: 'test',
    height: 2,
    joints: { origin: [0, 0, 0], side: [1, 2, 0] },
    parts: [ball('ball', 'origin', 0.25), ball('far', 'origin', 0.1)],
    decals: []
  }
}

test('a point in front of a sphere part has distance 1 - r and a +Z normal', () => {
  const collider = bodyCollider(mannequin(), ['far'], rootAt())
  assertClose(collider.distance([0, 0, 1]), 0.75, 1e-9)
  const n = collider.normal([0, 0, 1])
  assertClose(n[0], 0, 1e-6)
  assertClose(n[1], 0, 1e-6)
  assertClose(n[2], 1, 1e-6)
})

test('yaw of pi/2 turns the front toward +X', () => {
  const collider = bodyCollider(mannequin(), [], rootAt([0, 0, 0], Math.PI / 2))
  assertClose(collider.distance([1, 0, 0]), 0.75, 1e-9)
  const n = collider.normal([1, 0, 0])
  assertClose(n[0], 1, 1e-6)
  assertClose(n[2], 0, 1e-6)
})

test('the collider follows the root position', () => {
  const collider = bodyCollider(mannequin(), [], rootAt([3, 0, 0], 0))
  assertClose(collider.distance([3, 0, 1]), 0.75, 1e-9)
})

test('excluded parts do not collide', () => {
  const m = mannequin()
  m.parts = [ball('ball', 'origin', 0.25)]
  const all = bodyCollider(m, [], rootAt())
  const none = bodyCollider(m, ['ball'], rootAt())
  assertClose(all.distance([0, 0, 0]), -0.25, 1e-9)
  assert.equal(none.distance([0, 0, 0]), Infinity)
})

test('the distance is the minimum over parts, including culled ones', () => {
  const m = mannequin()
  m.parts.push(ball('high', 'side', 0.5))
  const collider = bodyCollider(m, [], rootAt())
  assertClose(collider.distance([1, 2, 0.6]), 0.1, 1e-9)
  assertClose(collider.distance([0, 0, 5]), 4.75, 1e-9)
})

test('anchorWorld rotates and translates joints', () => {
  const p = anchorWorld(mannequin(), 'side', rootAt([10, 0, 5], Math.PI / 2))
  assertClose(p[0], 10 + 0, 1e-9)
  assertClose(p[1], 2, 1e-9)
  assertClose(p[2], 5 - 1, 1e-9)
})
