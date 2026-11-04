import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  climbs, countCastJumps, countJumps, crouches, deepestInJump, strayTakeFrames, tripArrived
} from '../src/diagnostics/jumps.ts'
import type { JumpPose, TripFrame } from '../src/diagnostics/jumps.ts'
import type { Sample } from '../src/page/cast.ts'
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

function sample (name: string, jumpTo: number | undefined, surface: number, gaps: Array<number | null>): Sample {
  return { name, falling: false, surface, jumpTo, feet: gaps.map(gap => ({ planted: false, gap })) }
}

test('a jump in flight when the frames end is planned and not landed', () => {
  assert.deepEqual(countJumps([floor, aloft, aloft]), { planned: 1, landed: 0 })
})

test('a cast is counted per character, and a jump planned before the end is followed to its landing', () => {
  const frames = [
    sample('a', undefined, 0, [0]), sample('a', 3, 0, [0]), sample('a', 3, 0, [0]), sample('a', undefined, 3, [0]),
    sample('a', 5, 3, [0]), sample('a', undefined, 5, [0]),
    sample('b', undefined, 0, [0]), sample('b', undefined, 0, [0]), sample('b', 3, 0, [0]), sample('b', 3, 0, [0])
  ]
  const named = (ends?: Map<string, number>): string => JSON.stringify(countCastJumps(frames, ends).map(c => c.jumps))
  assert.equal(named(), JSON.stringify([{ planned: 2, landed: 2 }, { planned: 1, landed: 0 }]))
  const ends = new Map([['a', 3], ['b', 2]])
  const first = [{ planned: 1, landed: 1 }, { planned: 0, landed: 0 }]
  assert.equal(named(ends), JSON.stringify(first), 'none planned after the end')
  const second = [{ planned: 1, landed: 1 }, { planned: 1, landed: 0 }]
  assert.equal(named(new Map([['a', 2], ['b', 4]])), JSON.stringify(second))
})

test('the deepest sole is read on the jump frames and one frame either side, and unknown gaps are not depth', () => {
  const frames = [
    sample('a', undefined, 0, [-5]), sample('a', undefined, 0, [-3]), sample('a', 3, 0, [null, 4]),
    sample('a', 3, 0, [-2]), sample('a', undefined, 3, [-4]), sample('a', undefined, 3, [-9])
  ]
  assert.equal(deepestInJump(frames), 4)
  assert.equal(deepestInJump(frames.slice(0, 1)), 0, 'no jump')
  assert.equal(deepestInJump([sample('a', 3, 0, [null])]), 0, 'a sole over nothing is not under a surface')
})

test('a take frame is stray unless it plays from a jump command to the end of its landing', () => {
  const landings = new Map([['jump', 2]])
  const at = (clip: string, jumpTo?: number): { clip: string, jumpTo: number | undefined } => ({ clip, jumpTo })
  const clean = [at('walk'), at('jump', 3), at('jump', 3), at('jump'), at('jump'), at('walk')]
  assert.equal(strayTakeFrames(clean, landings), 0)
  const picked = [at('walk'), at('jump'), at('jump'), at('walk'), at('jump', 3)]
  assert.equal(strayTakeFrames(picked, landings), 2, 'a take run that starts without a command')
  const stuck = [at('jump', 3), at('jump'), at('jump'), at('jump'), at('jump')]
  assert.equal(strayTakeFrames(stuck, landings), 2, 'a take that does not hand back after its landing')
})

test('a crouch is the pelvis drop before lift-off and the wrist travel between the lowest point and lift-off', () => {
  const pose = (jumpTo: number | undefined, falling: boolean, pelvis: number, wrist: number): JumpPose => {
    return { jumpTo, falling, pelvis, wrists: [[0, wrist, 0]] }
  }
  const frames = [
    pose(undefined, false, 0, 0), pose(3, false, -0.05, 0), pose(3, false, -0.2, 0.1), pose(3, false, -0.1, 0.3),
    pose(3, true, 0, 0.5), pose(3, true, 0, 0.9), pose(undefined, false, 0, 0)
  ]
  const [found] = crouches(frames)
  assert.deepEqual([found.drop, found.wrist], [0.2, 0.4], 'later flight does not count')
  assert.deepEqual(crouches([pose(3, false, -0.1, 0), pose(undefined, false, 0, 0)]), [], 'never left the ground')
})
