import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Mannequin } from '../src/formats/mannequin.ts'
import type { RootState } from '../src/motion/script.ts'
import { anchorWorld, bodyCollider } from '../src/sim/body.ts'
import { assertClose } from './helpers.ts'

function ball (name: string, radius: number): Mannequin['parts'][number] {
  return { name, shape: 'capsule', a: 'origin', b: 'origin', radiusA: radius, radiusB: radius, material: 'm' }
}

function mannequin (): Mannequin {
  return {
    name: 'test',
    height: 2,
    joints: { origin: [0, 0, 0], side: [1, 2, 0] },
    parts: [ball('ball', 0.25), ball('far', 0.1)],
    decals: []
  }
}

function root (position: [number, number, number], yaw: number): RootState {
  return { position, yaw, velocity: [0, 0, 0], angularVelocity: 0 }
}

test('a point in front of a sphere part has distance 1 - r and a +Z normal', () => {
  const collider = bodyCollider(mannequin(), ['far'], root([0, 0, 0], 0))
  assertClose(collider.distance([0, 0, 1]), 0.75, 1e-9)
  const n = collider.normal([0, 0, 1])
  assertClose(n[0], 0, 1e-6)
  assertClose(n[1], 0, 1e-6)
  assertClose(n[2], 1, 1e-6)
})

test('yaw of pi/2 turns the front toward +X', () => {
  const collider = bodyCollider(mannequin(), [], root([0, 0, 0], Math.PI / 2))
  assertClose(collider.distance([1, 0, 0]), 0.75, 1e-9)
  const n = collider.normal([1, 0, 0])
  assertClose(n[0], 1, 1e-6)
  assertClose(n[2], 0, 1e-6)
})

test('the collider follows the root position', () => {
  const collider = bodyCollider(mannequin(), [], root([3, 0, 0], 0))
  assertClose(collider.distance([3, 0, 1]), 0.75, 1e-9)
})

test('excluded parts do not collide', () => {
  const m = mannequin()
  m.parts = [ball('ball', 0.25)]
  const all = bodyCollider(m, [], root([0, 0, 0], 0))
  const none = bodyCollider(m, ['ball'], root([0, 0, 0], 0))
  assertClose(all.distance([0, 0, 0]), -0.25, 1e-9)
  assert.equal(none.distance([0, 0, 0]), Infinity)
})

test('the distance is the minimum over parts, including culled ones', () => {
  const m = mannequin()
  m.parts.push({ name: 'high', shape: 'capsule', a: 'side', b: 'side', radiusA: 0.5, radiusB: 0.5, material: 'm' })
  const collider = bodyCollider(m, [], root([0, 0, 0], 0))
  assertClose(collider.distance([1, 2, 0.6]), 0.1, 1e-9)
  assertClose(collider.distance([0, 0, 5]), 4.75, 1e-9)
})

test('anchorWorld rotates and translates joints', () => {
  const p = anchorWorld(mannequin(), 'side', root([10, 0, 5], Math.PI / 2))
  assertClose(p[0], 10 + 0, 1e-9)
  assertClose(p[1], 2, 1e-9)
  assertClose(p[2], 5 - 1, 1e-9)
})
