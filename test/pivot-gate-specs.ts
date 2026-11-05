import { declareGate } from '../src/checks/gate-spec.ts'
import type { Verdict } from '../src/checks/gate-spec.ts'
import { responseOf } from '../src/export/pivots.ts'
import type { Move } from '../src/export/pivots.ts'

const FRAMES = 3
const still = (): Array<number | undefined> => Array(FRAMES).fill(0)
const moved = (by: number): Array<number | undefined> => Array(FRAMES).fill(by)

function move (delta: 1 | -1, own: Array<number | undefined>, other = still()): Move {
  return { view: 'side', part: 'footL', delta, direction: 'right', affected: 0, shifts: [own, other] }
}

const via = (...args: Parameters<typeof move>): Verdict => responseOf(move(...args))

declareGate({
  gate: 'pivot',
  observes: 'drawn pixels',
  frame: 'the lowest drawn row of each foot part in the idle frames of a view\'s directions, before and after the ' +
    'foot sprite\'s pivotA and pivotB rows are moved by one, for each foot sprite, view, direction and sign',
  threshold: 'a move of +1 raises the moved foot\'s lowest row by exactly 1 px in every frame (-1 lowers it by 1), ' +
    'and the other foot does not move',
  bad: [
    { name: 'a +1 move that leaves the sole where it was', run: () => via(1, moved(0)) },
    { name: 'a +1 move that lowers the sole by one', run: () => via(1, moved(1)) },
    { name: 'a -1 move that raises the sole by one', run: () => via(-1, moved(-1)) },
    { name: 'a +1 move that raises the sole by two', run: () => via(1, moved(-2)) },
    { name: 'a +1 move that raises the sole in two of three frames', run: () => via(1, [-1, -1, 0]) },
    { name: 'a +1 move that also raises the other foot', run: () => via(1, moved(-1), moved(-1)) },
    {
      name: 'a move of a foot that is not drawn in every frame, which is not measured',
      run: () => via(1, [undefined, -1, -1]),
      measured: false
    }
  ],
  good: [
    { name: 'a +1 move that raises the sole by one in every frame', run: () => via(1, moved(-1)) },
    { name: 'a -1 move that lowers the sole by one in every frame', run: () => via(-1, moved(1)) }
  ]
})
