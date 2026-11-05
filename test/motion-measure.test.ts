import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rawSamples, retargetedSamples, seriesReport } from '../src/export/measure.ts'
import {
  cycleMeans, gapsOf, pitchDegrees, steadySamples, stepsOf, weightShift
} from '../src/motion/measure.ts'
import type { Sample } from '../src/motion/measure.ts'
import type { Pose } from '../src/motion/pose.ts'
import { assertClose } from './helpers.ts'
import { HUMANOIDS, character, loadClip, retargetOptions } from './mocap-fixtures.ts'

const ANKLES = ['ankleL', 'ankleR']

function sample (x: number, planted: [boolean, boolean], feet: [number, number] = [0, 0], yaw = 0): Sample {
  const joints: Pose = { pelvis: [x, 1, 0], chest: [x, 1.5, 0], ankleL: [feet[0], 0, 0], ankleR: [feet[1], 0, 0] }
  return { joints, yaw, planted }
}

function atPitch (degrees: number, yaw: number): Sample {
  const lean = Math.tan(degrees * Math.PI / 180)
  const [dx, dz] = [Math.sin(yaw) * lean, Math.cos(yaw) * lean]
  return { joints: { pelvis: [0, 1, 0], chest: [dx, 2, dz] }, yaw, planted: [] }
}

function gait (stepFrames: number[], lengths: number[]): Sample[] {
  const frames: Sample[] = []
  let at = 0
  stepFrames.forEach((count, k) => {
    const leg = k % 2
    const feet: [number, number] = [0, 0]
    feet[leg] = (at += lengths[k])
    for (let i = 0; i < count; i++) {
      const planted: [boolean, boolean] = [leg === 0 || i > 1, leg === 1 || i > 1]
      frames.push(sample(at, planted, feet))
    }
  })
  return frames
}

test('pitch is positive when the neck is ahead of the pelvis along the heading, whatever the heading', () => {
  for (const yaw of [0, Math.PI / 2, 2.5]) {
    assertClose(pitchDegrees(atPitch(12, yaw), 'pelvis', 'chest'), 12, 1e-9)
    assertClose(pitchDegrees(atPitch(-7, yaw), 'pelvis', 'chest'), -7, 1e-9)
  }
})

test('a one-frame flicker in a stance does not count as a step', () => {
  const flags = [true, true, true, false, true, true, true, true, false, false, false, false, true, true, true]
  const samples = flags.map(on => sample(0, [on, false]))
  const steady = steadySamples(samples)
  assert.deepEqual(steady.map(s => s.planted[0]), flags.map((on, i) => on || i === 3))
})

test('step length and duration are read from touchdowns and the gap is the difference over the mean', () => {
  const samples = gait([10, 10, 10, 10], [0.6, 0.6, 0.6, 0.6])
  const steps = stepsOf(samples, ANKLES, 10)
  assert.equal(steps.length, 3)
  assert.ok(steps.every(step => Math.abs(step.duration - 1) < 1e-9))
  const uneven = stepsOf(gait([10, 12, 10, 12], [0.6, 0.6, 0.6, 0.6]), ANKLES, 10)
  assertClose(gapsOf(uneven)[0].duration, 0.2 / 1.1, 1e-9)
  assertClose(gapsOf(steps)[0].duration, 0, 1e-9)
})

test('weight shift is the span of the pelvis between the feet', () => {
  const samples = [0, 0.25, 0.5, 0.25].map(x => sample(x, [true, true], [0, 1]))
  assertClose(weightShift(samples, 'pelvis', ['ankleL', 'ankleR'], 1).range, 0.5, 1e-9)
})

test('cycle means group frames between touchdowns of one leg', () => {
  const samples = gait([6, 6, 6, 6, 6], [0.5, 0.5, 0.5, 0.5, 0.5])
  const values = samples.map((_, i) => i)
  assert.equal(cycleMeans(samples, values).length, 1)
})

for (const name of HUMANOIDS) {
  test(`${name}: the run take, retargeted, leans forward between 5 and 20 degrees and the walk is even`, () => {
    const options = retargetOptions(name)
    const { rig } = character(name)
    const run = seriesReport(retargetedSamples(loadClip('run'), options), { rig }, 24)
    assert.ok(run.head > 5 && run.head < 20, `head pitch ${run.head}`)
    const walk = seriesReport(rawSamples(loadClip('walk'), { rig }), { rig }, 24)
    assert.ok(walk.length! < 0.1 && walk.duration! < 0.1, `walk gaps ${walk.length} ${walk.duration}`)
  })
}
