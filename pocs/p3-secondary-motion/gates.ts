import type { Gate } from '../../src/diagnostics/report.ts'

export const MATERIALS = ['silk', 'wool', 'leather']

export const P3_GATES = {
  nonFinite: {
    op: '<=',
    threshold: 0,
    rationale: 'Any NaN or Infinity is a blow-up.'
  },
  maxSpeed: {
    op: '<=',
    threshold: 15,
    rationale: 'A cape tip faster than about 3x a sprint means the solver is injecting energy. ' +
      'Measured on the soak run.'
  },
  maxStrain: {
    op: '<=',
    threshold: 0.1,
    rationale: 'Cloth stretched more than 10% beyond rest length reads as rubber.'
  },
  penetratingFrames: {
    op: '<=',
    threshold: 0.01,
    rationale: 'Fraction of frames with any particle deeper than 0.5 px (at 48px scale) inside the body.'
  },
  settleSecondsMin: {
    op: '>=',
    threshold: 0.2,
    rationale: 'Time after the stop until max particle speed < 0.05 m/s; faster than 0.2 s is a rigid cape.'
  },
  settleSecondsMax: {
    op: '<=',
    threshold: 3,
    rationale: 'Real capes settle in about a second; beyond 3 s the cape never rests.'
  },
  settleOrder: {
    op: '>=',
    threshold: 1,
    rationale: 'Heavier, stiffer materials settle faster: silk > wool > leather (1 if ordered, 0 otherwise).'
  },
  overshootDegrees: {
    op: '>=',
    threshold: 5,
    rationale: 'After the stop the forward swing passes its final rest value by at least 5 degrees: ' +
      'visible follow-through. Silk and wool only.'
  },
  lagFrames: {
    op: '>=',
    threshold: 1,
    rationale: 'The peak sideways swing comes at least one frame after the peak of the body turn rate.'
  },
  windAlignment: {
    op: '>=',
    threshold: 0.7,
    rationale: 'Mean cosine between the horizontal hem displacement from windless rest and the wind direction.'
  },
  nondeterministicFrames: {
    op: '<=',
    threshold: 0,
    rationale: 'Particle positions hashed per frame must match a re-run in a child process.'
  }
} as const

export function gate (name: keyof typeof P3_GATES, value: number, material?: string): Gate {
  const label = material === undefined ? name : `${name}.${material}`
  return { name: label, value, ...P3_GATES[name] }
}
