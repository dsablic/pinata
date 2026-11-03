import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kneeFlexion, landingFrame, recoverySeconds } from '../src/diagnostics/landings.ts'
import type { Footing } from '../src/diagnostics/landings.ts'

const leg = { hip: 'hip', knee: 'knee', ankle: 'ankle' }
const REST = 0.9
const stood: Footing = {
  falling: false, pelvis: REST, feet: [{ planted: true, gap: 0 }, { planted: false, gap: 0.05 }]
}
const hovering: Footing = { ...stood, feet: [{ planted: false, gap: 0.2 }, { planted: false, gap: 0.3 }] }
const sunk: Footing = { ...stood, feet: [{ planted: true, gap: -0.1 }, { planted: false, gap: 0.05 }] }
const oneUp: Footing = { ...stood, feet: [{ planted: true, gap: 0 }, { planted: false, gap: 0.5 }] }
const crouched: Footing = { ...stood, pelvis: REST - 0.1 }

test('knee flexion is zero for a straight leg and right-angled for a shin pointing forward', () => {
  const straight = { hip: [0, 1, 0], knee: [0, 0.5, 0], ankle: [0, 0, 0] } as never
  const bent = { hip: [0, 1, 0], knee: [0, 0.5, 0], ankle: [0.5, 0.5, 0] } as never
  assert.ok(Math.abs(kneeFlexion(straight, leg)) < 1e-9)
  assert.ok(Math.abs(kneeFlexion(bent, leg) - 90) < 1e-9)
})

test('recovery counts from the landing to the last frame that is not normal', () => {
  const frames = [{ ...stood, falling: true }, stood, hovering, sunk, stood, stood, stood]
  assert.equal(landingFrame(frames), 1)
  assert.equal(recoverySeconds(frames, 1, 2, REST), 1.5)
  assert.equal(recoverySeconds([stood, stood], 0, 2, REST), 0)
})

test('a character still crouched, hovering a foot or off the ground in the last frame has not recovered', () => {
  assert.equal(recoverySeconds([stood, hovering], 0, 24, REST), Infinity)
  assert.equal(recoverySeconds([stood, oneUp], 0, 24, REST), Infinity)
  assert.equal(recoverySeconds([stood, crouched], 0, 24, REST), Infinity)
})
