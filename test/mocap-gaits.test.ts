import { test } from 'node:test'
import assert from 'node:assert/strict'
import { legsOf } from '../src/formats/rig.ts'
import { closedCycle, cycleOf, mirrorOf, symmetricCycle } from '../src/mocap/cycle.ts'
import { buildDatabase, wholeLapSpeed } from '../src/mocap/database.ts'
import type { MotionDatabase } from '../src/mocap/database.ts'
import { createPlayer } from '../src/mocap/player.ts'
import type { Player } from '../src/mocap/player.ts'
import { aimedDirections, legLength, retargetRotations } from '../src/mocap/retarget.ts'
import { rawSamples, retargetedSamples, seriesReport } from '../src/export/measure.ts'
import { gapsOf, steadySamples, stepsOf, weightShift } from '../src/motion/measure.ts'
import type { Sample } from '../src/motion/measure.ts'
import { sub } from '../src/math/vec.ts'
import { assertClose } from './helpers.ts'
import { character, HUMANOIDS, loadClip, loadClips, retargetOptions } from './mocap-fixtures.ts'

const FPS = 24
const EAST = Math.PI / 2
const clips = loadClips()
const databases = new Map<string, MotionDatabase>()

function database (name: string): MotionDatabase {
  const known = databases.get(name) ?? buildDatabase(clips, retargetOptions(name))
  databases.set(name, known)
  return known
}

function player (name: string, idleLayer = true): Player {
  return createPlayer({ database: database(name), fps: FPS, ground: () => 0, idleLayer },
    { position: [0, 0, 0], yaw: EAST })
}

function gaitOf (name: string, clip: string): string | undefined {
  return database(name).entries.find(entry => entry.name === clip)?.gait
}

test('the chest follows the take\'s spine: the run leans the torso as the raw neck does, not the pelvis alone', () => {
  const clip = loadClip('run')
  const { rig } = character('knight')
  const raw = seriesReport(rawSamples(clip, { rig }), { rig }, FPS).chest
  const options = retargetOptions('knight')
  const spanned = seriesReport(retargetedSamples(clip, options), { rig }, FPS).chest
  const rigid = seriesReport(retargetedSamples(clip, { ...options, map: { ...options.map, span: {} } }), { rig }, FPS)
  assert.ok(Math.abs(spanned - raw) < 3, `chest ${spanned} against the raw neck ${raw}`)
  assert.ok(spanned - rigid.chest > 5, `the span adds the spine's bend: ${spanned} against ${rigid.chest}`)
})

test('a looping take is cut at one stride, closed, and its two steps mirror each other', () => {
  const options = retargetOptions('knight')
  const frames = retargetRotations(loadClip('run'), { ...options, style: undefined })
  const cycle = cycleOf(frames, FPS)
  const closed = closedCycle(frames, cycle, FPS)
  const last = closed.frames.length - 1
  for (const joint of Object.keys(closed.frames[0].rotations)) {
    closed.frames[0].rotations[joint].flat().forEach((v, i) => {
      assertClose(closed.frames[last].rotations[joint].flat()[i], v, 1e-9)
    })
  }
  const mirror = mirrorOf(options.rig, aimedDirections(options))
  assert.ok(mirror !== undefined)
  const even = symmetricCycle(closed, mirror, FPS).frames
  const half = (even.length - 1) / 2
  assert.ok(Number.isInteger(half))
  for (let k = 0; k < half; k++) assert.deepEqual(even[k].contact, [...even[k + half].contact].reverse(), `frame ${k}`)
  const samples: Sample[] = [...even, ...even.slice(1), ...even.slice(1)].map((frame, k) => ({
    joints: {}, yaw: frame.root.yaw, planted: frame.contact
  }))
  const steady = steadySamples(samples, 3)
  const durations = gapsOf(stepsOf(steady.map(s => ({ ...s, joints: { a: [0, 0, 0], b: [0, 0, 0] } })), ['a', 'b'],
    FPS)).map(gap => gap.duration)
  assert.ok(durations.length > 0 && durations.every(d => d === 0), `step durations differ: ${durations}`)
})

for (const name of HUMANOIDS) {
  test(`${name}: a steady run loops on the run take, and a stop then brakes into a stopping take`, () => {
    const p = player(name)
    p.command({ speed: database(name).speeds.run, heading: EAST })
    const running = Array.from({ length: 240 }, () => p.step().clip).slice(48)
    assert.deepEqual([...new Set(running)], ['run'])
    p.command({ speed: 0, heading: EAST })
    const stopping = Array.from({ length: 72 }, () => p.step().clip)
    assert.ok(stopping.some(clip => clip.endsWith('-stop')), stopping.join(' '))
  })

  test(`${name}: at its Froude walking speed the walk plays walk takes in at least 90% of frames`, () => {
    const p = player(name)
    p.command({ speed: database(name).speeds.walk, heading: EAST })
    const walking = Array.from({ length: 240 }, () => p.step().clip).slice(48)
    const share = walking.filter(clip => gaitOf(name, clip) === 'walk').length / walking.length
    assert.ok(share >= 0.9, `${share}: ${[...new Set(walking)].join(', ')}`)
  })
}

test('walk and run speeds scale with the square root of leg length, and the takes play dynamically similar', () => {
  const [knight, dwarf] = ['knight', 'dwarf'].map(database)
  const legs = ['knight', 'dwarf'].map(name => legLength(retargetOptions(name)))
  for (const gait of ['walk', 'run'] as const) {
    assertClose(knight.speeds[gait] / dwarf.speeds[gait], Math.sqrt(legs[0] / legs[1]), 1e-9)
  }
  assertClose(knight.pace / dwarf.pace, Math.sqrt(legs[1] / legs[0]), 1e-9)
  assert.ok(knight.speeds.walk < knight.speeds.run / 2)
})

function idleSeries (name: string, idleLayer: boolean): { spine: number[], share: number } {
  const options = retargetOptions(name)
  const p = player(name, idleLayer)
  p.perform('idle')
  const frames = Array.from({ length: 400 }, () => p.step()).slice(240)
  const ankles = legsOf(options.rig).map(leg => leg.ankle) as [string, string]
  const samples = frames.map(frame => ({ joints: frame.pose, yaw: 0, planted: frame.planted }))
  assert.ok(frames.every(frame => frame.planted.every(Boolean)), 'both feet stay planted')
  return {
    spine: frames.map(frame => Math.hypot(...sub(frame.pose.chest, frame.pose[options.rig.pelvis]))),
    share: weightShift(samples, options.rig.pelvis, ankles, 1).range
  }
}

test('an idle breathes and shifts its weight, feet planted; with the layer off it does neither', () => {
  const height = character('rogue').mannequin.height
  const alive = idleSeries('rogue', true)
  const still = idleSeries('rogue', false)
  const travel = (values: number[]): number => (Math.max(...values) - Math.min(...values)) / height
  assert.ok(travel(alive.spine) >= 0.003 && travel(alive.spine) <= 0.015, `breath ${travel(alive.spine)}`)
  assert.ok(travel(still.spine) < 0.001, `still ${travel(still.spine)}`)
  assert.ok(alive.share >= 0.2, `weight share range ${alive.share}`)
  assert.ok(still.share < 0.05, `still weight share range ${still.share}`)
})

test('a lap takes whole frames at the whole-lap speed, and a shift adds or removes whole frames', () => {
  const walkers = database('dwarf')
  for (const gait of ['walk', 'run'] as const) {
    const laps = walkers.entries.flatMap(entry => {
      return entry.gait === gait && entry.travel !== undefined ? [Math.hypot(entry.travel[0], entry.travel[2])] : []
    })
    const framesAt = (shift: number): number[] => laps.map(lap => lap * FPS / wholeLapSpeed(walkers, gait, FPS, shift))
    const whole = framesAt(0).filter(frames => Math.abs(frames - Math.round(frames)) < 1e-9)
    assert.ok(whole.length > 0, `${gait}: some loop's lap takes whole frames`)
    for (const shift of [-2, -1, 1, 2]) {
      const shifted = framesAt(shift).some(frames => whole.some(base => Math.abs(frames - base - shift) < 1e-9))
      assert.ok(shifted, `${gait}: shift ${shift}`)
    }
  }
})
