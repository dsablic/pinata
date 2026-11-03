import { test } from 'node:test'
import assert from 'node:assert/strict'
import { climbs, countJumps, tripArrived } from '../src/diagnostics/jumps.ts'
import type { TripFrame } from '../src/diagnostics/jumps.ts'
import type { Surface } from '../src/page/surfaces.ts'

const floor = { jumpTo: undefined, surface: 0, reached: false }
const aloft = { jumpTo: 3, surface: 0, reached: false }
const onLedge = { jumpTo: undefined, surface: 3, reached: false }
const resting = { ...onLedge, reached: true }

test('a jump is planned when an aim appears and lands when the character is back on that surface', () => {
  assert.deepEqual(countJumps([floor, aloft, aloft, onLedge]), { planned: 1, landed: 1 })
  assert.deepEqual(countJumps([floor, aloft, aloft, floor]), { planned: 1, landed: 0 })
  assert.deepEqual(countJumps([floor, floor]), { planned: 0, landed: 0 })
})

test('a trip counts only when its jumps landed on the aimed surface and it ended resting there', () => {
  const landed: TripFrame[] = [floor, aloft, onLedge, resting]
  assert.equal(tripArrived(landed, 3), true)
  assert.equal(tripArrived(landed, 4), false, 'ended on another surface')
  assert.equal(tripArrived([floor, floor, floor], 3), false, 'a refusal or a time-out: no jump planned')
  assert.equal(tripArrived([floor, aloft, floor, { ...floor, reached: true }], 3), false, 'a short landing')
  assert.equal(tripArrived([floor, aloft, onLedge, onLedge], 3), false, 'never reached its spot')
})

test('a climb is a rise between standing frames over the allowed one', () => {
  const stand = (height: number): { base: number, support: Surface } => {
    return { base: height, support: { id: 0, from: 0, to: 1, height } }
  }
  assert.equal(climbs([stand(0), stand(0.6), stand(0.6)], 0.7), 0)
  assert.equal(climbs([stand(0), stand(0.9)], 0.7), 1)
  const gliding = { base: 0.5, support: stand(0.9).support }
  assert.equal(climbs([stand(0), gliding, stand(0)], 0.7), 0, 'gliding over a surface')
})
