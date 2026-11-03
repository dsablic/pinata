import { test } from 'node:test'
import assert from 'node:assert/strict'
import { drawOrder, ORDER_HYSTERESIS } from '../src/style/order.ts'

const part = (name: string, depth: number, layer = 0): { name: string, layer: number, depth: number } => {
  return { name, layer, depth }
}

const names = (parts: { name: string }[]): string[] => parts.map(p => p.name)

test('without a previous order parts sort by layer then depth, level parts keep mannequin order', () => {
  const parts = [part('head', 1), part('hair', 1.01), part('arm', 2), part('sword', 0, 1), part('belt', 0.5)]
  assert.deepEqual(names(drawOrder(parts)), ['arm', 'head', 'hair', 'belt', 'sword'])
})

test('depths crossing by less than the band keep last frame order, by more than the band they swap', () => {
  const small = ORDER_HYSTERESIS / 2
  const big = ORDER_HYSTERESIS * 2
  assert.deepEqual(names(drawOrder([part('a', 1), part('b', 1 + small)], ['a', 'b'])), ['a', 'b'])
  assert.deepEqual(names(drawOrder([part('a', 1), part('b', 1 + small)], ['b', 'a'])), ['b', 'a'])
  assert.deepEqual(names(drawOrder([part('a', 1), part('b', 1 + big)], ['a', 'b'])), ['b', 'a'])
})

test('a lower layer draws first however deep the higher layer is', () => {
  const parts = [part('front', 5, 1), part('back', 0, 0)]
  assert.deepEqual(names(drawOrder(parts, ['front', 'back'])), ['back', 'front'])
})

test('a new part is placed by the rules and a removed part does not disturb the rest', () => {
  const parts = [part('a', 1), part('fresh', 3), part('c', 1), part('d', 1)]
  assert.deepEqual(names(drawOrder(parts, ['d', 'gone', 'c', 'a'])), ['fresh', 'd', 'c', 'a'])
  const level = [part('a', 1), part('fresh', 1), part('c', 1)]
  assert.deepEqual(names(drawOrder(level, ['c', 'a'])), ['fresh', 'c', 'a'])
})

test('a far part moves behind a much nearer one even when a part within the band sits between them', () => {
  const parts = [part('a', 0), part('b', 0.02), part('c', 0.06)]
  assert.deepEqual(names(drawOrder(parts, ['a', 'b', 'c'])), ['c', 'a', 'b'])
})

test('the previous order and the parts are not modified', () => {
  const parts = [part('a', 0), part('b', 0.02), part('c', 0.06)]
  const previous = ['a', 'b', 'c']
  drawOrder(parts, previous)
  assert.deepEqual(names(parts), ['a', 'b', 'c'])
  assert.deepEqual(previous, ['a', 'b', 'c'])
})
