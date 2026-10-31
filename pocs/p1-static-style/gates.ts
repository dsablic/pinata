import { gateFrom } from '../../src/diagnostics/report.ts'
import type { Gate } from '../../src/diagnostics/report.ts'

export const MIN_PIXELS_FOR_THIN = 4

export const P1_GATES = {
  outlineGaps: {
    op: '<=',
    threshold: 0,
    rationale: 'The outline is closed by construction; a gap means the silhouette was clipped at the frame edge.'
  },
  maxThinFraction: {
    op: '<=',
    threshold: 0.25,
    rationale: 'Parts mostly 1px thick vanish or flicker at 32px; a quarter allows tapered ends. ' +
      'Covered sides are not edges.'
  },
  paletteSize: {
    op: '<=',
    threshold: 16,
    rationale: 'A common budget for 32-64px characters; more colours start to read as a downscaled render.'
  },
  maxStrayPixels: {
    op: '<=',
    threshold: 2,
    rationale: 'Isolated pixels read as noise. Decal pixels are excluded because single-pixel features are intended.'
  },
  nondeterministicFrames: {
    op: '<=',
    threshold: 0,
    rationale: 'Design requirement R9: identical inputs must produce identical bytes.'
  }
} as const

export function gate (name: keyof typeof P1_GATES, value: number): Gate {
  return gateFrom(P1_GATES, name, value)
}
