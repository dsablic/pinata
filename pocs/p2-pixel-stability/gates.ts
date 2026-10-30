import type { Gate } from '../../src/diagnostics/report.ts'

export const FLICKER_LIMIT = 0.01

export const P2_GATES = {
  flickerFraction: {
    op: '<=',
    threshold: FLICKER_LIMIT,
    rationale: 'Pixels that change colour for one frame and change back, over the silhouette area, worst frame of ' +
      'the turntable. A slow rigid rotation should move edges once and leave; flicker is crawl. A percent allows ' +
      'the odd band boundary to flip twice.'
  },
  partAreaJump: {
    op: '<=',
    threshold: 0.15,
    rationale: 'Worst relative change in a part\'s pixel count between consecutive turntable frames, skipping parts ' +
      'under 8 pixels and frames where the part\'s bounding box moves by a pixel or more. A part that pops in size ' +
      'while still reads as a different shape.'
  },
  outlineGaps: {
    op: '<=',
    threshold: 0,
    rationale: 'As P1, on every frame of both sequences: fill pixels touching transparency. The fixed camera must ' +
      'contain the whole motion.'
  },
  controlFails: {
    op: '>=',
    threshold: 1,
    rationale: 'Number of sizes at which the control (the same turntable, camera shifted by a sub-pixel offset ' +
      'each frame, as an unsnapped follow camera does) exceeds the flicker limit; a gate set the control passes ' +
      'proves nothing.'
  },
  nondeterministicFrames: {
    op: '<=',
    threshold: 0,
    rationale: 'Frame images hashed must match a re-run in a child process.'
  }
} as const

export function gate (name: keyof typeof P2_GATES, value: number, label?: string): Gate {
  const full = label === undefined ? name : `${name}.${label}`
  return { name: full, value, ...P2_GATES[name] }
}
