import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nodeAt, path, reachable, surfaceGraph } from '../src/page/graph.ts'
import type { Graph } from '../src/page/graph.ts'
import type { Ground, Surface, Wall } from '../src/page/surfaces.ts'

const REACH = { step: 0.2, drop: 3, body: 1.8 }

function ground (surfaces: Array<[number, number, number]>, walls: Array<[number, number, number]> = []): Ground {
  return {
    surfaces: surfaces.map(([from, to, height], id): Surface => ({ id, from, to, height })),
    walls: walls.map(([x, bottom, top], id): Wall => ({ id: 100 + id, x, bottom, top }))
  }
}

function on (graph: Graph, x: number, height: number): number {
  const node = nodeAt(graph, x, height, 0.01)
  assert.ok(node !== undefined, `a node at ${x}, ${height}`)
  return node.id
}

function kinds (graph: Graph, from: number, to: number): string[] {
  return graph.edges.filter(e => e.from === from && e.to === to).map(e => e.kind)
}

test('surfaces that meet at the same height or within a step are walked between both ways', () => {
  const graph = surfaceGraph(ground([[0, 2, 0], [2, 4, 0], [4, 6, 0.15]]), REACH)
  const [a, b, c] = [on(graph, 1, 0), on(graph, 3, 0), on(graph, 5, 0.15)]
  assert.deepEqual([kinds(graph, a, b), kinds(graph, b, a)], [['walk'], ['walk']])
  assert.deepEqual([kinds(graph, b, c), kinds(graph, c, b)], [['walk'], ['walk']])
})

test('a rise taller than a step is only dropped down, and a drop past the limit is not taken', () => {
  const graph = surfaceGraph(ground([[0, 2, 0], [2, 4, 0.6], [4, 6, 4]]), REACH)
  const [low, mid, high] = [on(graph, 1, 0), on(graph, 3, 0.6), on(graph, 5, 4)]
  assert.deepEqual(kinds(graph, mid, low), ['drop'])
  assert.deepEqual(kinds(graph, low, mid), [])
  assert.deepEqual(kinds(graph, high, mid), [])
  assert.equal(path(graph, low, mid), undefined)
})

test('a platform over the floor drops off both ends onto the floor, aiming past its edge', () => {
  const graph = surfaceGraph(ground([[0, 10, 0], [4, 6, 1]]), REACH)
  const platform = on(graph, 5, 1)
  const drops = graph.edges.filter(e => e.from === platform)
  assert.deepEqual(drops.map(e => e.kind), ['drop', 'drop'])
  assert.ok(drops[0].at < 4 && drops[1].at > 6, 'each drop aims beyond the platform edge')
  assert.ok(drops.every(e => graph.nodes[e.to].height === 0))
})

test('a tall wall splits a surface into parts with no way across; a wall shorter than a step does not', () => {
  const tall = surfaceGraph(ground([[0, 10, 0]], [[5, 0, 1]]), REACH)
  assert.equal(tall.nodes.length, 2)
  assert.equal(path(tall, on(tall, 2, 0), on(tall, 8, 0)), undefined)
  const low = surfaceGraph(ground([[0, 10, 0]], [[5, 0, 0.1]]), REACH)
  assert.equal(low.nodes.length, 1)
})

test('a wall at a surface end stops walking on and dropping off there', () => {
  const graph = surfaceGraph(ground([[0, 10, 0], [4, 6, 1]], [[6, 0, 3]]), REACH)
  const platform = on(graph, 5, 1)
  assert.deepEqual(graph.edges.filter(e => e.from === platform).map(e => e.at < 5), [true])
})

test('a surface just above another hides it where they overlap, so the two join at its ends', () => {
  const graph = surfaceGraph(ground([[0, 10, 0], [4, 6, 0.1]]), REACH)
  assert.equal(graph.nodes.length, 3)
  const [left, top, right] = [on(graph, 2, 0), on(graph, 5, 0.1), on(graph, 8, 0)]
  assert.deepEqual([kinds(graph, left, top), kinds(graph, top, right)], [['walk'], ['walk']])
  assert.equal(nodeAt(graph, 5, 0, 0.01), undefined)
})

test('paths take the fewest moves and every reachable node has a path', () => {
  const graph = surfaceGraph(ground([[0, 3, 0], [3, 6, 0.1], [6, 9, 0.2], [1, 2, 1.5], [7, 8, 1]]), REACH)
  const start = on(graph, 1.5, 1.5)
  const route = path(graph, start, on(graph, 8.5, 0.2))
  assert.deepEqual(route?.map(e => e.kind), ['drop', 'walk', 'walk'])
  const ids = reachable(graph, start)
  assert.ok(ids.every(id => path(graph, start, id) !== undefined))
  assert.ok(!ids.includes(on(graph, 7.5, 1)), 'the higher shelf cannot be climbed onto')
})

test('a thick wall leaves no standing place inside it', () => {
  const thick: Ground = {
    surfaces: [{ id: 0, from: 0, to: 10, height: 0 }],
    walls: [{ id: 7, x: 4, bottom: 0, top: 2 }, { id: 7, x: 5, bottom: 0, top: 2 }]
  }
  const graph = surfaceGraph(thick, REACH)
  assert.deepEqual(graph.nodes.map(n => [n.from, n.to]), [[0, 4], [5, 10]])
})

test('of two ways off a platform, a path takes the one on the side of the goal', () => {
  const graph = surfaceGraph(ground([[0, 10, 0], [4, 6, 1]]), REACH)
  const [platform, floor] = [on(graph, 5, 1), on(graph, 1, 0)]
  assert.ok(path(graph, platform, floor, 9)![0].at > 6)
  assert.ok(path(graph, platform, floor, 1)![0].at < 4)
})
