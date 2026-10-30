import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DistanceConstraint } from '../src/sim/cloth.ts'
import type { Recording } from '../src/sim/metrics.ts'
import {
  createRecording, frameHashes, lagFrames, maxSpeed, maxStrain, nonFinite, overshootDegrees,
  penetratingFrames, recordFrame, settleSeconds, swingAngles, windAlignment, windDriftMetres
} from '../src/sim/metrics.ts'
import { assertClose } from './helpers.ts'

type FrameSpec = {
  time: number
  positions: number[]
  yaw?: number
  angularVelocity?: number
  penetration?: number[]
  linkPenetration?: number[]
}

function recording (specs: FrameSpec[], constraints: DistanceConstraint[] = []): Recording {
  return {
    constraints,
    frames: specs.map(s => ({
      time: s.time,
      root: { position: [0, 0, 0], yaw: s.yaw ?? 0, velocity: [0, 0, 0], angularVelocity: s.angularVelocity ?? 0 },
      positions: Float64Array.from(s.positions),
      penetration: Float64Array.from(s.penetration ?? new Array(s.positions.length / 3).fill(0)),
      linkPenetration: Float64Array.from(s.linkPenetration ?? new Array(constraints.length).fill(0))
    }))
  }
}

const swing = { hem: [0], anchorLocal: [0, 0, 0] as [number, number, number] }

function hemAt (forward: number, sideways = 0): number[] {
  return [sideways, -1, forward]
}

test('nonFinite counts NaN and Infinity coordinates', () => {
  const rec = recording([{ time: 0, positions: [0, 0, 0] }, { time: 1, positions: [NaN, Infinity, 0] }])
  assert.equal(nonFinite(rec), 2)
  assert.equal(nonFinite(recording([{ time: 0, positions: [0, 0, 0] }])), 0)
})

test('maxSpeed is the largest per-particle displacement per second between frames', () => {
  const rec = recording([
    { time: 0, positions: [0, 0, 0, 0, 0, 0] },
    { time: 0.5, positions: [0, 0, 0, 3, 4, 0] },
    { time: 1, positions: [0, 0, 0, 3, 4, 0.5] }
  ])
  assertClose(maxSpeed(rec), 10)
})

test('maxStrain is the largest (length - rest) / rest', () => {
  const constraints = [{ a: 0, b: 1, rest: 1, compliance: 0 }, { a: 1, b: 2, rest: 2, compliance: 0 }]
  const rec = recording([
    { time: 0, positions: [0, 0, 0, 1, 0, 0, 3, 0, 0] },
    { time: 1, positions: [0, 0, 0, 1.2, 0, 0, 3.2, 0, 0] }
  ], constraints)
  assertClose(maxStrain(rec), 0.2)
})

test('penetratingFrames is the fraction of frames with any depth above the threshold', () => {
  const rec = recording([
    { time: 0, positions: [0, 0, 0], penetration: [0.0001] },
    { time: 1, positions: [0, 0, 0], penetration: [0.01] },
    { time: 2, positions: [0, 0, 0], penetration: [0] },
    { time: 3, positions: [0, 0, 0], penetration: [0.02] }
  ])
  assertClose(penetratingFrames(rec, 0.005), 0.5)
})

test('penetratingFrames also counts constraint midpoints inside the body', () => {
  const constraints = [{ a: 0, b: 1, rest: 1, compliance: 0 }]
  const rec = recording([
    { time: 0, positions: [0, 0, 0, 1, 0, 0], linkPenetration: [0.0001] },
    { time: 1, positions: [0, 0, 0, 1, 0, 0], linkPenetration: [0.01] }
  ], constraints)
  assertClose(penetratingFrames(rec, 0.005), 0.5)
})

test('settleSeconds is the time after fromTime from which speed stays below the threshold', () => {
  const x = [0, 0, 0.5, 0.5, 0.5, 0.5]
  const rec = recording(x.map((v, i) => ({ time: i * 0.5, positions: [v, 0, 0] })))
  assertClose(settleSeconds(rec, { fromTime: 0.5, speedThreshold: 0.05 }), 1)
  assertClose(settleSeconds(rec, { fromTime: 1.5, speedThreshold: 0.05 }), 0)
  const never = recording([0, 1, 2, 3].map(i => ({ time: i, positions: [i, 0, 0] })))
  assert.equal(settleSeconds(never, { fromTime: 0, speedThreshold: 0.05 }), Infinity)
})

test('settleSeconds can be restricted to a particle subset', () => {
  const rec = recording([0, 1, 2, 3, 4].map(i => ({ time: i, positions: [0, 0, 0, i, 0, 0] })))
  assert.equal(settleSeconds(rec, { fromTime: 0, speedThreshold: 0.05 }), Infinity)
  assertClose(settleSeconds(rec, { fromTime: 1, speedThreshold: 0.05, particles: [0] }), 0)
})

test('swingAngles measures the hem about the anchor in body-local space', () => {
  const rec = recording([
    { time: 0, positions: hemAt(0) },
    { time: 1, positions: hemAt(1) },
    { time: 2, positions: hemAt(0, -1) },
    { time: 3, positions: [1, -1, 0], yaw: Math.PI / 2 }
  ])
  const { forward, sideways } = swingAngles(rec, swing)
  assertClose(forward[0], 0)
  assertClose(forward[1], Math.PI / 4)
  assertClose(sideways[2], -Math.PI / 4)
  assertClose(forward[3], Math.PI / 4)
  assertClose(sideways[3], 0, 1e-12)
})

test('swingAngles averages the hem particles and uses the anchor offset', () => {
  const rec = recording([{ time: 0, positions: [0, -1, 0, 0, -1, 2] }])
  const { forward } = swingAngles(rec, { hem: [0, 1], anchorLocal: [0, 0, 0] })
  assertClose(forward[0], Math.PI / 4)
  const shifted = swingAngles(rec, { hem: [0, 1], anchorLocal: [0, 0, 1] })
  assertClose(shifted.forward[0], 0)
})

test('overshootDegrees is max forward after the stop minus the final forward swing', () => {
  const tan = (deg: number): number => Math.tan(deg * Math.PI / 180)
  const rec = recording([
    { time: 0, positions: hemAt(tan(40)) },
    { time: 1, positions: hemAt(tan(0)) },
    { time: 2, positions: hemAt(tan(12)) },
    { time: 3, positions: hemAt(tan(4)) }
  ])
  assertClose(overshootDegrees(rec, { stopTime: 1, swing }), 8, 1e-9)
  assertClose(overshootDegrees(rec, { stopTime: 3, swing }), 0, 1e-9)
})

test('lagFrames is peak sideways swing frame minus peak body angular speed frame', () => {
  const side = [0, 0.1, 0.2, 0.9, 0.3, 0.1, 5]
  const omega = [0, 1, 3, 2, 0, 0, 0]
  const rec = recording(side.map((s, i) => ({
    time: i,
    positions: hemAt(0, -s),
    angularVelocity: omega[i]
  })))
  assert.equal(lagFrames(rec, { turnStart: 0, turnEnd: 4, swing }), 1)
  assert.equal(lagFrames(rec, { turnStart: 0, turnEnd: 5, swing }), 4)
})

test('lagFrames is -1 when the sideways peak is below minPeakDegrees or a window is empty', () => {
  const tan = (deg: number): number => Math.tan(deg * Math.PI / 180)
  const rec = recording([0, 0.2, 0.4, 0.1].map((deg, i) => ({
    time: i, positions: hemAt(0, tan(deg)), angularVelocity: i === 1 ? 1 : 0
  })))
  const window = { turnStart: 0, turnEnd: 3, swing }
  assert.equal(lagFrames(rec, window), 1)
  assert.equal(lagFrames(rec, { ...window, minPeakDegrees: 0.5 }), -1)
  assert.equal(lagFrames(rec, { ...window, minPeakDegrees: 0.3 }), 1)
  assert.equal(lagFrames(rec, { ...window, turnStart: 10, turnEnd: 11 }), -1)
})

test('windDriftMetres is the mean horizontal distance of the hem centroid from restHem', () => {
  const rec = recording([
    { time: 0, positions: [0, -1, 0] },
    { time: 1, positions: [3, -5, 4] },
    { time: 2, positions: [0, -1, 2] }
  ])
  assertClose(windDriftMetres(rec, { hem: [0], restHem: [0, -1, 0] }), 7 / 3)
  assert.equal(windDriftMetres(recording([]), { hem: [0], restHem: [0, 0, 0] }), 0)
})

test('windAlignment is the mean cosine of horizontal hem displacement and wind direction', () => {
  const rec = recording([
    { time: 0, positions: [1, -1, 0] },
    { time: 1, positions: [0, -1, 1] },
    { time: 2, positions: [0, -2, 0] }
  ])
  const value = windAlignment(rec, { hem: [0], restHem: [0, -1, 0], windDirection: [1, 0, 0] })
  assertClose(value, 1 / 3)
  const down = windAlignment(rec, { hem: [0], restHem: [0, -1, 0], windDirection: [-1, 5, 0] })
  assertClose(down, -1 / 3)
})

test('frameHashes differ per frame and are stable', () => {
  const rec = recording([{ time: 0, positions: [0, 0, 0] }, { time: 1, positions: [0, 0, 1] }])
  const a = frameHashes(rec)
  assert.equal(a.length, 2)
  assert.match(a[0], /^[0-9a-f]{64}$/)
  assert.notEqual(a[0], a[1])
  assert.deepEqual(frameHashes(rec), a)
})

test('recordFrame records penetration for free particles and zero for pinned ones', () => {
  const particles = {
    position: Float64Array.from([0, 0, 0, 1, 0, 0]),
    previous: new Float64Array(6),
    inverseMass: Float64Array.from([0, 1]),
    materialIndex: new Uint32Array(2),
    count: 2
  }
  const system = { particles, constraints: [], pins: [], material: [] }
  const rec = createRecording(system)
  const origin: [number, number, number] = [0, 0, 0]
  const root = { position: origin, yaw: 0, velocity: origin, angularVelocity: 0 }
  recordFrame(rec, { time: 0, root, particles, distance: p => p[0] - 0.5, particleRadius: 0.75 })
  assertClose(rec.frames[0].penetration[0], 0)
  assertClose(rec.frames[0].penetration[1], 0.25)
})

test('recordFrame records constraint midpoint depth between free particles only', () => {
  const particles = {
    position: Float64Array.from([-2, 0, 0, 2, 0, 0, 5, 0, 0]),
    previous: new Float64Array(9),
    inverseMass: Float64Array.from([1, 1, 0]),
    materialIndex: new Uint32Array(3),
    count: 3
  }
  const constraints = [
    { a: 0, b: 1, rest: 4, compliance: 0 },
    { a: 1, b: 2, rest: 3, compliance: 0 }
  ]
  const rec = createRecording({ particles, constraints, pins: [], material: [] })
  const origin: [number, number, number] = [0, 0, 0]
  const root = { position: origin, yaw: 0, velocity: origin, angularVelocity: 0 }
  recordFrame(rec, { time: 0, root, particles, distance: p => Math.hypot(...p) - 1, particleRadius: 0.1 })
  assertClose(rec.frames[0].penetration[0], 0)
  assertClose(rec.frames[0].penetration[1], 0)
  assertClose(rec.frames[0].linkPenetration[0], 1.1)
  assertClose(rec.frames[0].linkPenetration[1], 0)
})
