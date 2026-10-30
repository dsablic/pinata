import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Scenario, SimMaterial } from '../src/formats/sim.ts'
import type { Vec3 } from '../src/math/vec.ts'
import { simulateCharacter } from '../src/motion/character.ts'
import { toWorld } from '../src/sim/body.ts'
import { frameHashes } from '../src/sim/metrics.ts'
import { assertClose } from './helpers.ts'
import { mannequin, rig } from './locomotion-fixtures.ts'

const silk: SimMaterial = {
  name: 'silk', particleMass: 0.01, stretchCompliance: 1e-6, bendCompliance: 1e-3, damping: 0.3, drag: 0.02
}

const scenario: Scenario = {
  name: 'walk',
  body: 'unused.json',
  bodyExcludeParts: [],
  script: {
    accelSeconds: 0.3,
    segments: [{ action: 'move', speed: 1.2, duration: 2 }, { action: 'hold', duration: 0.5 }]
  },
  cape: { anchorLeft: 'shoulderL', anchorRight: 'shoulderR', columns: 4, rows: 5, length: 0.6, material: 'silk' },
  chains: [{ anchor: 'head', links: 3, linkLength: 0.05, direction: [0, 1, 0], material: 'silk' }],
  gravity: [0, -9.81, 0],
  fps: 24,
  substeps: 8,
  particleRadius: 0.02,
  durationSeconds: 3
}

const options = { mannequin, rig, scenario, materials: [silk] }

test('simulateCharacter is deterministic and records one frame per gait frame', () => {
  const a = simulateCharacter(options)
  const b = simulateCharacter(options)
  assert.equal(a.recording.frames.length, a.frames.length)
  assert.equal(a.poses.length, a.frames.length)
  assert.equal(a.frames.length, 3 * 24 + 1)
  assert.deepEqual(frameHashes(a.recording), frameHashes(b.recording))
})

test('the cape pins follow the posed shoulder and the cape travels with the walking body', () => {
  const run = simulateCharacter(options)
  const last = run.recording.frames.length - 1
  for (const i of [0, 20, last]) {
    const frame = run.recording.frames[i]
    const root = run.frames[i].root
    const shoulder = run.poses[i].shoulderL
    const pin = run.system.pins[0]
    const local: Vec3 = [shoulder[0] + pin.offset[0], shoulder[1] + pin.offset[1], shoulder[2] + pin.offset[2]]
    const expected = toWorld(local, root)
    for (let k = 0; k < 3; k++) assertClose(frame.positions[3 * pin.particle + k], expected[k], 1e-9)
  }
  const final = run.recording.frames[last]
  let meanZ = 0
  for (let i = 0; i < 20; i++) meanZ += final.positions[3 * i + 2] / 20
  assert.ok(meanZ > 2, `mean cape z ${meanZ}`)
  assertClose(meanZ, run.frames[last].root.position[2], 0.6)
})

test('a walking simulation has no non-finite coordinates and reports timing', () => {
  const run = simulateCharacter(options)
  assert.ok(run.recording.frames.every(f => f.positions.every(Number.isFinite)))
  assert.ok(run.timing.simulateSeconds > 0 && run.timing.planSeconds >= 0)
})

test('an unknown cape material is reported', () => {
  assert.throws(() => simulateCharacter({ ...options, materials: [] }), /unknown material 'silk'/)
})
