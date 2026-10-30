import type { Gate } from '../../src/diagnostics/report.ts'

export const SCENARIOS = ['walk-turn-stop', 'slow-fast', 'pivot']

export const P4_GATES = {
  footSlidePx: {
    op: '<=',
    threshold: 0.25,
    rationale: 'Horizontal movement of a planted sole point (ankle or toe lowered by the foot capsule radius, within ' +
      '2 cm of the ground for two consecutive frames), at 48px scale. Sliding feet are the classic tell of broken ' +
      'locomotion. Measured from geometry, not from the planner\'s stance flags.'
  },
  groundPenetrationPx: {
    op: '<=',
    threshold: 0.5,
    rationale: 'Lowest sole point below y = 0 at 48px scale, worst frame.'
  },
  partGroundPenetrationPx: {
    op: '<=',
    threshold: 0.5,
    rationale: 'Lowest point of any part other than the feet below y = 0 at 48px scale, worst frame: capsule end ' +
      'spheres and box corners. Catches a dragged sword or a limb through the floor that the foot gate cannot see.'
  },
  reachViolations: {
    op: '<=',
    threshold: 0,
    rationale: 'Frames where an IK target was farther than the leg\'s length and had to be clamped: a straight, ' +
      'locked leg reaching for the floor.'
  },
  kneeLimitViolations: {
    op: '<=',
    threshold: 0,
    rationale: 'Knee flexion outside [0, 150] degrees, or the knee bending backwards (on the opposite side of the ' +
      'hip-ankle line from the body\'s front).'
  },
  kneeSpeedDegPerSec: {
    op: '<=',
    threshold: 600,
    rationale: 'Peak knee flexion speed. Human walking peaks around 350-450 degrees/s; above 600 at 24 fps reads ' +
      'as a pop.'
  },
  boneLengthError: {
    op: '<=',
    threshold: 0.01,
    rationale: 'Max relative change of thigh, shin, foot, upper-arm and forearm lengths from the rest pose.'
  },
  rootSpeedError: {
    op: '<=',
    threshold: 0.05,
    rationale: 'During steady move segments (after the first accelSeconds, clear of turns), relative difference ' +
      'between the root\'s distance per second and the script speed.'
  },
  alternationViolations: {
    op: '<=',
    threshold: 0,
    rationale: 'During steady walking, the same foot planting twice in a row.'
  },
  skatingControlFails: {
    op: '>=',
    threshold: 1,
    rationale: '1 if the skating control (legs cycle with phase, feet are never planted in world space) fails ' +
      'footSlidePx on walk-turn-stop; a gate set the control passes proves nothing.'
  },
  nondeterministicFrames: {
    op: '<=',
    threshold: 0,
    rationale: 'Joint positions hashed per frame must match a re-run in a child process.'
  }
} as const

export function gate (name: keyof typeof P4_GATES, value: number, scenario?: string): Gate {
  const label = scenario === undefined ? name : `${name}.${scenario}`
  return { name: label, value, ...P4_GATES[name] }
}
