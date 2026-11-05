import { declareGate } from '../src/checks/gate-spec.ts'
import type { Verdict } from '../src/checks/gate-spec.ts'
import { expectedSector } from '../src/export/directions.ts'
import type { Direction } from '../src/export/directions.ts'
import type { Cell, Foot, Frame, Track } from '../src/export/record.ts'
import type { Gate } from '../src/export/report.ts'
import {
  bar, CELL, feetFrame, frameOf, LIFTED, markedAt, mixedGroundFrames, planted, recordingOf, soleAt, soleDown,
  trackOf, verdictOf
} from './export-fixtures.ts'

const via = (gate: Gate) => (track: Track): Verdict => verdictOf(recordingOf([track]), gate)
const feet = via('feet')
const facing = via('facing')
const border = via('border')
const ground = via('ground')
const drawn = via('drawn')
const loop = via('loop')
const anchor = (root: [number, number]): Verdict => verdictOf(recordingOf([], { ...CELL, root } as Cell), 'anchor')

const walking = (frames: Frame[]): Track => trackOf(frames)
const idling = (frames: Frame[]): Track => trackOf(frames, { behaviour: 'idle', loop: true })
const looping = (images: number[], options: Partial<Track> = {}): Track => {
  return trackOf(images.map(length => frameOf(bar(length))), { loop: true, ...options })
}
const facingFrames = (direction: Direction, sector: Direction): Frame[] => {
  return [0, 1].map(() => ({ ...frameOf(bar(1), direction), sector: expectedSector(sector) }))
}
const grounded = (rows: number[]): Track => idling(rows.map(row => feetFrame([planted(row)])))
const withOff = (off: number): Track => grounded(Array.from({ length: 20 }, (_, k) => k < off ? 2 : -1))
const turning = (sector: Direction): Track => {
  return trackOf(facingFrames('right', sector), { behaviour: 'turn' })
}

declareGate({
  gate: 'feet',
  observes: 'drawn pixels',
  frame: 'cell pixels of the lowest row of each planted foot part, root travel added between frames',
  threshold: 'worst slide of a planted sole between two frames is at most 1 px',
  bad: [
    {
      name: 'a sole that slides 2 px a frame while the root does not move',
      run: () => feet(walking([soleAt(5, 0), soleAt(3, 0), soleAt(1, 0)]))
    },
    { name: 'a slide just over 1 px', run: () => feet(walking([soleAt(5, 0), soleAt(3.99, 0)])) },
    {
      name: 'a sole that is still while the root travels 1.5 px a frame',
      run: () => feet(walking([soleAt(5, 0), soleAt(5, 1.5), soleAt(5, 1.5)]))
    },
    {
      name: 'a loop whose last frame is far from the first by the first frame\'s travel',
      run: () => feet(trackOf([soleAt(5, 3), soleAt(5, 0), soleAt(5, 0)], { loop: true }))
    }
  ],
  good: [
    { name: 'a slide of exactly 1 px', run: () => feet(walking([soleAt(5, 0), soleAt(4, 0)])) },
    {
      name: 'a sole that moves 1.5 px a frame against a root travelling 1.5 px a frame',
      run: () => feet(walking([soleAt(5, 0), soleAt(3.5, 1.5), soleAt(2, 1.5)]))
    },
    {
      name: 'the same on the vertical axis',
      run: () => feet(walking([soleDown(5, 0), soleDown(3.5, 1.5), soleDown(2, 1.5)]))
    },
    {
      name: 'a loop whose wrap-around pair is held',
      run: () => feet(trackOf([soleAt(5, 0), soleAt(5, 0), soleAt(5, 0)], { loop: true }))
    }
  ]
})

declareGate({
  gate: 'facing',
  observes: 'painter state',
  frame: 'the view sector the painter chose for each frame, against the direction\'s own sector',
  threshold: 'no frame is drawn from another view; turns are not checked',
  bad: [
    {
      name: 'a right-facing track drawn from the front view',
      run: () => facing(trackOf(facingFrames('right', 'front')))
    },
    {
      name: 'a front-facing track drawn from the right view',
      run: () => facing(trackOf(facingFrames('front', 'right'), { direction: 'front' }))
    }
  ],
  good: [
    { name: 'every frame in the right view', run: () => facing(trackOf(facingFrames('right', 'right'))) },
    {
      name: 'every frame in the front view',
      run: () => facing(trackOf(facingFrames('front', 'front'), { direction: 'front' }))
    },
    { name: 'a turn changing view on the way', run: () => facing(turning('front')) }
  ]
})

const inside = (...at: Array<[number, number]>): Verdict => border(walking([markedAt(6, 3, ...at)]))

declareGate({
  gate: 'border',
  observes: 'drawn pixels',
  frame: 'each exported cell image, all four edge lines, whatever its size',
  threshold: 'no opaque pixel on the cell edge',
  bad: [
    { name: 'a pixel in the top-right corner of a 6x3 image', run: () => inside([5, 0]) },
    { name: 'a pixel in the bottom-left corner of a 6x3 image', run: () => inside([0, 2]) },
    { name: 'a pixel in the middle of the top edge', run: () => inside([3, 0]) },
    { name: 'a pixel in the middle of the bottom edge', run: () => inside([3, 2]) },
    { name: 'a pixel in the middle of the left edge', run: () => inside([0, 1]) },
    { name: 'a pixel in the middle of the right edge', run: () => inside([5, 1]) },
    {
      name: 'a pixel on the edge of a later frame only',
      run: () => border(walking([markedAt(6, 3, [1, 1]), markedAt(6, 3, [0, 1])]))
    }
  ],
  good: [{ name: 'pixels only inside the edge', run: () => inside([1, 1], [4, 1]) }]
})

declareGate({
  gate: 'anchor',
  observes: 'joints',
  frame: 'the root\'s exact projection in cell pixels, against the pivot',
  threshold: 'the larger axis offset is at most 0.5 px',
  bad: [
    { name: 'root 0.75 px right of the pivot', run: () => anchor([2.75, 2]) },
    { name: 'root 0.75 px left of the pivot', run: () => anchor([1.25, 2]) },
    { name: 'root 0.75 px above the pivot', run: () => anchor([2, 1.25]) }
  ],
  good: [
    { name: 'root exactly 0.5 px off on both axes', run: () => anchor([2.5, 1.5]) },
    { name: 'root 0.4 px off on both axes', run: () => anchor([1.6, 2.4]) }
  ]
})

const undrawn: Foot = { planted: true, sole: undefined, drawn: undefined, level: 0 }
const robed: Foot = { planted: true, sole: undefined, drawn: { x: 0, y: 0 }, level: 0 }
const idleIn = (direction: Direction, ...feet: Foot[][]): Track => {
  return trackOf(feet.map(own => feetFrame(own)), { behaviour: 'idle', loop: true, direction })
}
const seen = (...tracks: Track[]): Verdict => verdictOf(recordingOf(tracks), 'drawn')

declareGate({
  gate: 'ground',
  observes: 'drawn pixels',
  frame: 'each planted foot\'s own ground point, in cell pixels, from the anchor its ankle is drawn at; the foot ' +
    'part\'s own pixels in the exported drawing, covered or not, and a planted foot must show a visible pixel in ' +
    'one of its planted frames; idle only',
  threshold: 'at most 5% of planted foot-frames more than 1 px from their own ground point',
  bad: [
    {
      name: 'two of seven planted foot-frames 3 rows off, one lifted foot ignored',
      run: () => ground(idling(mixedGroundFrames()))
    },
    { name: 'two of twenty foot-frames off', run: () => ground(withOff(2)) },
    { name: 'no foot planted in any frame', run: () => ground(idling([feetFrame([LIFTED]), feetFrame([LIFTED])])) },
    {
      name: 'a sole on the line under the root while its own ground point is 3 rows higher',
      run: () => ground(idling([feetFrame([planted(-1, 3)])]))
    },
    { name: 'a planted foot with no drawn pixels', run: () => ground(idling([feetFrame([undrawn])])) },
    {
      name: 'a foot hidden behind the other foot in every frame, its footprint on its ground point',
      run: () => ground(idling([feetFrame([planted(0), robed]), feetFrame([planted(0), robed])]))
    },
    {
      name: 'a foot with no visible pixel in its planted frames, only in a frame where it is lifted',
      run: () => ground(idling([feetFrame([robed]), feetFrame([LIFTED])]))
    }
  ],
  good: [
    { name: 'one of twenty foot-frames off', run: () => ground(withOff(1)) },
    { name: 'a foot exactly 1 px below its ground point', run: () => ground(grounded([0])) },
    { name: 'a foot exactly 1 px above its ground point', run: () => ground(grounded([-2])) },
    {
      name: 'a sole on the line under the root while its own ground point is 3 rows lower',
      run: () => ground(idling([feetFrame([planted(2, 2.6)])]))
    },
    {
      name: 'a foot partly covered by the other foot in one frame, drawn on its ground point',
      run: () => ground(idling([feetFrame([planted(0), robed]), feetFrame([planted(0), planted(0)])]))
    },
    {
      name: 'a walk with feet far off the line, which is not measured',
      run: () => ground(walking([feetFrame([planted(9)])]))
    }
  ]
})

declareGate({
  gate: 'drawn',
  observes: 'drawn pixels',
  frame: 'the visible pixels of each foot part in the idle frames of each view\'s directions (left and right share ' +
    'the side view, front-left and front-right the front-side view, and so on); idle only',
  threshold: 'each foot has a visible pixel in at least one frame of at least one direction of every view',
  bad: [
    {
      name: 'the second foot with no pixels in any frame of either side direction',
      run: () => seen(idleIn('right', [planted(0), undrawn]), idleIn('left', [planted(0), undrawn]))
    },
    {
      name: 'a foot covered by a robe in every frame of both side directions',
      run: () => seen(idleIn('right', [planted(0), robed], [planted(0), robed]), idleIn('left', [planted(0), robed]))
    },
    {
      name: 'a foot hidden in the only direction of the back view',
      run: () => seen(idleIn('back', [planted(0), robed]))
    }
  ],
  good: [
    {
      name: 'each foot covered in one side direction and visible in the other',
      run: () => seen(idleIn('right', [planted(0), robed]), idleIn('left', [robed, planted(0)]))
    },
    {
      name: 'a foot visible in one frame only',
      run: () => seen(idleIn('right', [planted(0), robed], [planted(0), planted(0)]))
    },
    { name: 'both feet visible in the front view', run: () => seen(idleIn('front', [planted(0), planted(0)])) },
    { name: 'a walk with a hidden foot, which is not checked', run: () => seen(trackOf([feetFrame([robed])])) }
  ]
})

declareGate({
  gate: 'loop',
  observes: 'drawn pixels',
  frame: 'the exported frames of one loop, last frame against the first, in changed pixels',
  threshold: 'seam at most the median step, not a repeated frame, and the median step above 0',
  bad: [
    { name: 'a seam jump larger than a usual step', run: () => loop(looping([1, 2, 3, 4, 5])) },
    { name: 'the first frame repeated at the end', run: () => loop(looping([1, 2, 3, 1])) },
    { name: 'a still pause in a loop that is not an idle', run: () => loop(looping([1, 2, 2, 3, 1, 1])) },
    {
      name: 'a seam jump in an idle that also pauses',
      run: () => loop(looping([1, 2, 3, 4, 5, 5, 6, 7, 8, 7, 1], { behaviour: 'idle' }))
    },
    { name: 'identical frames, which are not measured', run: () => loop(looping([2, 2, 2])), measured: false }
  ],
  good: [
    { name: 'a seam as small as a step', run: () => loop(looping([1, 2, 3, 2])) },
    {
      name: 'an idle with its still pauses and a repeated seam',
      run: () => loop(looping([1, 2, 2, 3, 1, 1], { behaviour: 'idle' }))
    },
    { name: 'a track that is not a loop is not checked', run: () => loop(looping([1, 2, 3, 4, 5], { loop: false })) }
  ]
})
