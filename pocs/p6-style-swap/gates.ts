import type { Gate } from '../../src/diagnostics/report.ts'
import { P1_GATES } from '../p1-static-style/gates.ts'
import { P2_GATES } from '../p2-pixel-stability/gates.ts'

export const P6_GATES = {
  motionIdentical: {
    op: '>=',
    threshold: 1,
    rationale: 'Fraction of characters whose pose and cloth frame hashes are identical in all three style runs. ' +
      'Style is a render-time choice; any difference means it leaked into the motion.'
  },
  outlineGaps: P1_GATES.outlineGaps,
  maxThinFraction: P1_GATES.maxThinFraction,
  paletteSize: P1_GATES.paletteSize,
  maxStrayPixels: P1_GATES.maxStrayPixels,
  flickerFraction: P2_GATES.flickerFraction,
  nondeterministicFrames: {
    op: '<=',
    threshold: 0,
    rationale: 'Still and motion hashes must match a re-run in a child process.'
  }
} as const

export function gate (name: keyof typeof P6_GATES, value: number, label?: string): Gate {
  const full = label === undefined ? name : `${name}.${label}`
  return { name: full, value, ...P6_GATES[name] }
}
