import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paintStrip } from '../src/style/strip.ts'
import type { Lay, StripSprite } from '../src/style/strip.ts'

type Point = [number, number]

type Painted = { cells: Map<string, string>, length: number }

function paintAll (sprite: StripSprite, points: Point[], lay?: Lay): Painted {
  const cells = new Map<string, string>()
  const length = paintStrip(sprite, points, (x, y, cell) => cells.set(`${x},${y}`, cell), lay)
  return { cells, length }
}

function picture (cells: Map<string, string>): string[] {
  const spots = [...cells.keys()].map(key => key.split(',').map(Number))
  const xs = spots.map(s => s[0])
  const ys = spots.map(s => s[1])
  const rows: string[] = []
  for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
    let row = ''
    for (let x = Math.min(...xs); x <= Math.max(...xs); x++) row += cells.get(`${x},${y}`) ?? '.'
    rows.push(row)
  }
  return rows
}

const marked: StripSprite = { rows: ['abcd', 'efgh'], pivotA: [1, 0], pivotB: [2, 0] }

test('two points one span apart reproduce the sprite and the quarter turns turn it exactly', () => {
  const turns: Array<[Point, Point, string[]]> = [
    [[5, 5], [6, 5], ['abcd', 'efgh']],
    [[5, 5], [5, 6], ['ea', 'fb', 'gc', 'hd']],
    [[5, 5], [4, 5], ['hgfe', 'dcba']],
    [[5, 5], [5, 4], ['dh', 'cg', 'bf', 'ae']]
  ]
  for (const [from, to, expected] of turns) {
    const { cells, length } = paintAll(marked, [from, to])
    assert.deepEqual(picture(cells), expected)
    assert.equal(length, 1)
  }
})

test('a longer bone stretches the middle columns up to 1.25 of the span, and the caps not at all', () => {
  const sprite: StripSprite = { rows: ['xABCDy'], pivotA: [1, 0], pivotB: [5, 0] }
  const stretched = paintAll(sprite, [[0, 0], [5, 0]])
  assert.deepEqual(picture(stretched.cells), ['xABCCDy'])
  assert.equal(stretched.length, 5)
  const held = paintAll(sprite, [[0, 0], [8, 0]])
  assert.deepEqual(picture(held.cells), picture(stretched.cells))
  assert.equal(held.length, 5)
})

test('a polyline shorter than the floor draws the floor length along the last direction', () => {
  const sprite: StripSprite = { rows: ['xABCDEFy'], pivotA: [1, 0], pivotB: [6, 0] }
  const { cells, length } = paintAll(sprite, [[0, 0], [1, 0]])
  assert.deepEqual(picture(cells), ['xACDFy'])
  assert.equal(length, 3)
})

const solid: StripSprite = { rows: ['######', '######', '######'], pivotA: [1, 1], pivotB: [4, 1] }

function distanceToPath (x: number, y: number, path: Point[]): number {
  return Math.min(...path.slice(1).map((end, i) => {
    const [ax, ay] = path[i]
    const [dx, dy] = [end[0] - ax, end[1] - ay]
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    return Math.hypot(x - ax - t * dx, y - ay - t * dy)
  }))
}

function floodFill (start: Point, open: (x: number, y: number) => boolean): Set<string> {
  const seen = new Set<string>([start.join(',')])
  const queue = [start]
  while (queue.length > 0) {
    const [x, y] = queue.pop() as Point
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const key = `${x + dx},${y + dy}`
        if (seen.has(key) || !open(x + dx, y + dy)) continue
        seen.add(key)
        queue.push([x + dx, y + dy])
      }
    }
  }
  return seen
}

for (const [name, path] of [
  ['a right-angle bend', [[0, 0], [10, 0], [10, 10]]],
  ['a hairpin', [[0, 0], [12, 0], [0, 0]]]
] as Array<[string, Point[]]>) {
  test(`${name} stays one solid piece close to the polyline`, () => {
    const { cells } = paintAll(solid, path)
    const filled = (x: number, y: number): boolean => cells.has(`${x},${y}`)
    const spots = [...cells.keys()].map(key => key.split(',').map(Number))
    assert.equal(floodFill(spots[0] as Point, filled).size, cells.size)
    const [x0, x1] = [Math.min(...spots.map(s => s[0])) - 1, Math.max(...spots.map(s => s[0])) + 1]
    const [y0, y1] = [Math.min(...spots.map(s => s[1])) - 1, Math.max(...spots.map(s => s[1])) + 1]
    const outside = floodFill([x0, y0], (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && !filled(x, y))
    assert.equal(outside.size + cells.size, (x1 - x0 + 1) * (y1 - y0 + 1))
    for (const [x, y] of spots) assert.ok(distanceToPath(x, y, path) <= 2.5, `${x},${y} is too far`)
  })
}

test('transparent cells are never plotted, even in a fold', () => {
  const holey: StripSprite = { rows: ['#.#.#.', '.#.#.#', '#.#.#.'], pivotA: [1, 1], pivotB: [4, 1] }
  for (const path of [[[0, 0], [10, 0], [10, 10]], [[0, 0], [12, 0], [0, 0]], [[0, 0], [8, 0], [8, 2], [0, 2]]]) {
    const { cells } = paintAll(holey, path as Point[])
    assert.ok(cells.size > 0)
    assert.ok(![...cells.values()].includes('.'))
  }
})

const long: StripSprite = { rows: ['xABCDEFGHy'], pivotA: [1, 0], pivotB: [9, 0] }

function capAt (cells: Map<string, string>): string {
  return [...cells].filter(([, cell]) => cell === 'y').map(([key]) => key).join()
}

test('a length shorter than a straight bone stops short, caps at native size', () => {
  const { cells, length } = paintAll(long, [[0, 0], [20, 0]], { length: 6 })
  assert.equal(length, 6)
  assert.deepEqual(picture(cells), ['xABDEFHy'])
  assert.equal(capAt(cells), '6,0')
})

test('a bent polyline given a shorter length is cut on the first segment below it, on the second otherwise', () => {
  const bent: Point[] = [[0, 0], [6, 0], [6, 8]]
  const first = paintAll(long, bent, { length: 5 })
  assert.equal(first.cells.size, 5 + 2)
  assert.equal(capAt(first.cells), '5,0')
  const second = paintAll(long, bent, { length: 7 })
  assert.equal(second.cells.size, 7 + 2)
  assert.equal(capAt(second.cells), '6,1')
  const onJoint = paintAll(long, bent, { length: 6 })
  assert.equal(capAt(onJoint.cells), '6,0')
})

test('a longer length runs on past the end of a multi-segment polyline along its last segment', () => {
  const { cells, length } = paintAll(long, [[0, 0], [4, 0], [4, 3]], { length: 10 })
  assert.equal(length, 10)
  assert.equal(cells.size, 10 + 2)
  assert.equal(capAt(cells), '4,6')
})

test('coincident points lie along the heading when there is one, along +x otherwise', () => {
  const down = paintAll(marked, [[5, 5], [5, 6]])
  const turned = paintAll(marked, [[5, 5], [5, 5]], { heading: [0, 1] })
  assert.deepEqual(picture(turned.cells), ['ea', 'fb', 'gc', 'hd'])
  assert.deepEqual(turned.cells, down.cells)
  const plain = paintAll(marked, [[5, 5], [5, 5]])
  assert.deepEqual(plain.cells, paintAll(marked, [[5, 5], [6, 5]]).cells)
  assert.deepEqual(picture(plain.cells), ['abcd', 'efgh'])
})
