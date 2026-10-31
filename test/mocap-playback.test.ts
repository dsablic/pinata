import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Character } from '../src/formats/character.ts'
import { legsOf } from '../src/formats/rig.ts'
import { toAxisAngle, multiply, transpose } from '../src/math/matrix.ts'
import type { Clip } from '../src/mocap/clip.ts'
import { buildDatabase } from '../src/mocap/database.ts'
import { createPlayer } from '../src/mocap/player.ts'
import type { Command, PlayerFrame } from '../src/mocap/player.ts'
import { retargetRotations } from '../src/mocap/retarget.ts'
import type { MotionStyle } from '../src/mocap/style.ts'
import * as metrics from '../src/motion/metrics.ts'
import type { LocomotionRecording } from '../src/motion/metrics.ts'
import { chainLength, legLabels, restPose } from '../src/motion/pose.ts'
import type { Pose } from '../src/motion/pose.ts'
import { toWorld } from '../src/sim/body.ts'
import { generateTerrain, random } from '../src/world/terrain.ts'
import type { Terrain } from '../src/world/terrain.ts'
import { character, HUMANOIDS, loadClips, retargetOptions } from './mocap-fixtures.ts'
import { aboveGround, assertFeetStay } from './world-fixtures.ts'

const FPS = 24
const METRES_PER_PIXEL = 1 / 34
const EAST = Math.PI / 2

const clips = loadClips()

function legLength (body: Character): number {
  const rest = restPose(body.mannequin)
  return Math.min(...legsOf(body.rig).map(leg => chainLength(leg.chain, rest)))
}

function footLength (body: Character): number {
  const rest = restPose(body.mannequin)
  const lengthOf = (leg: { toe: string, ankle: string }): number => {
    return Math.hypot(...[0, 1, 2].map(i => rest[leg.toe][i] - rest[leg.ankle][i]))
  }
  return Math.max(...legsOf(body.rig).map(lengthOf))
}

function course (seed: number): Terrain {
  const cast = HUMANOIDS.map(character)
  return generateTerrain(seed, {
    length: 16,
    maxSlopeDegrees: 14,
    maxHeight: 1,
    heightStep: 0.2,
    maxRise: 0.3 * Math.min(...cast.map(legLength)),
    minTread: 1.15 * Math.max(...cast.map(footLength))
  })
}

type Run = { world: LocomotionRecording, relative: LocomotionRecording, frames: PlayerFrame[] }

function play (
  name: string,
  terrain: Pick<Terrain, 'ground'>,
  seconds: number,
  steer: (frame: number, x: number) => Command,
  setup?: (player: ReturnType<typeof createPlayer>, frame: number) => void
): Run {
  const { rig } = character(name)
  const settings = retargetOptions(name)
  const player = createPlayer({ database: buildDatabase(clips, settings), fps: FPS, ground: terrain.ground }, {
    position: [2, 0, 0], yaw: EAST
  })
  const labels = legLabels(rig, settings.rest)
  const world: LocomotionRecording = { fps: FPS, frames: [] }
  const frames: PlayerFrame[] = []
  let x = 2
  for (let i = 0; i < seconds * FPS; i++) {
    setup?.(player, i)
    player.command(steer(i, x))
    const frame = player.step()
    x = frame.root.position[0]
    const joints: Pose = {}
    for (const [joint, local] of Object.entries({ ...settings.rest, ...frame.pose })) {
      joints[joint] = toWorld(local, frame.root)
    }
    const planted = Object.fromEntries(labels.map((label, k) => [label, frame.planted[k]]))
    world.frames.push({ time: i / FPS, root: frame.root, clamped: frame.clamped, planted, joints })
    frames.push(frame)
  }
  return { world, relative: aboveGround(world, terrain.ground), frames }
}

function wander (name: string, terrain: Terrain, seed: number): (frame: number, x: number) => Command {
  const next = random(seed)
  const scaleToLegs = legLength(character(name)) / 0.75
  let direction = 1
  let until = 0
  let speed = 0
  return (frame, x) => {
    const time = frame / FPS
    if (x > terrain.to - 2) direction = -1
    if (x < terrain.from + 2) direction = 1
    if (time >= until) {
      const stopped = next() < 0.25
      speed = stopped ? 0 : (0.8 + 0.8 * next()) * scaleToLegs
      until = time + (stopped ? 1.5 + 2 * next() : 3 + 4 * next())
    }
    return { speed, heading: direction > 0 ? EAST : -EAST }
  }
}

for (const name of HUMANOIDS) {
  test(`${name}: a minute of motion-matched walking on generated terrain keeps the locomotion gates`, () => {
    const { rig, mannequin } = character(name)
    const geometry = { rig, mannequin }
    for (const seed of [3, 11]) {
      const terrain = course(seed)
      const run = play(name, terrain, 60, wander(name, terrain, seed + 7))
      const where = `seed ${seed}`
      assertFeetStay(run.relative, geometry, METRES_PER_PIXEL, where)
      assert.equal(metrics.reachViolations(run.world), 0, `${where}: reach`)
      assert.equal(metrics.kneeLimitViolations(run.world, geometry), 0, `${where}: knees`)
      assert.ok(metrics.boneLengthError(run.world, geometry, restPose(mannequin)) <= 1e-9, `${where}: bones`)
      assert.ok(run.frames.filter(f => f.switched).length > 20, `${where}: matching switches between clips`)
    }
  })
}

test('a 4 m/s headwind slows the walk by at least 10%, and a shove moves the body at least 0.1 m', () => {
  const flat = { ground: () => 0 }
  const distance = (run: Run): number => {
    return run.frames[run.frames.length - 1].root.position[0] - run.frames[0].root.position[0]
  }
  const walk = (): Command => ({ speed: 1.2, heading: EAST })
  const calm = play('knight', flat, 12, walk)
  const windy = play('knight', flat, 12, walk, player => { player.wind[0] = -4 })
  assert.ok(distance(windy) <= 0.9 * distance(calm), `calm ${distance(calm)} m, headwind ${distance(windy)} m`)
  const still = (): Command => ({ speed: 0, heading: EAST })
  const shoved = play('knight', flat, 4, still, (player, frame) => { if (frame === 24) player.push([0, 0, 1.5]) })
  const z = shoved.frames.map(f => f.root.position[2])
  assert.ok(Math.max(...z) - z[0] >= 0.1, `moved ${Math.max(...z) - z[0]} m`)
})

test('style: the neutral style changes nothing; two styles on one clip differ by at least 5 degrees RMS', () => {
  const walk = clips.find(c => c.name === 'walk') as Clip
  const plain = retargetRotations(walk, { ...retargetOptions('rogue'), style: undefined })
  const neutral = retargetRotations(walk, retargetOptions('rogue', {}))
  assert.deepEqual(neutral, plain)
  const swagger: MotionStyle = {
    amplitude: { shoulderL: 1.5, shoulderR: 1.5 }, offset: { chest: [-6, 0, 0] }, variation: 2, seed: 4
  }
  const stiff: MotionStyle = {
    amplitude: { shoulderL: 0.5, shoulderR: 0.5 }, offset: { chest: [8, 0, 0] }, variation: 2, seed: 9
  }
  const a = retargetRotations(walk, retargetOptions('rogue', swagger))
  const b = retargetRotations(walk, retargetOptions('rogue', stiff))
  for (const joint of ['shoulderL', 'shoulderR', 'chest']) {
    const squares = a.map((frame, i) => {
      const angle = toAxisAngle(multiply(frame.rotations[joint], transpose(b[i].rotations[joint]))).angle
      return (angle * 180 / Math.PI) ** 2
    })
    const rms = Math.sqrt(squares.reduce((sum, v) => sum + v, 0) / squares.length)
    assert.ok(rms >= 5, `${joint}: ${rms.toFixed(1)} degrees RMS`)
  }
})

test('pushed far past its legs, the body stays finite and the locomotion gates hold', () => {
  const flat = { ground: () => 0 }
  const finite = (run: Run): boolean => {
    return run.world.frames.every(f => Object.values(f.joints).every(p => p.every(Number.isFinite)))
  }
  const cases: Array<[string, (frame: number) => Command, Parameters<typeof play>[4]]> = [
    ['dwarf', () => ({ speed: 2.2, heading: EAST }), undefined],
    ['dwarf', () => ({ speed: 0.5, heading: EAST }), (player, frame) => { if (frame === 30) player.push([4, 0, 0]) }],
    ['dwarf', () => ({ speed: 0.5, heading: EAST }), player => { player.wind[0] = 10 }],
    ['knight', () => ({ speed: 1.2, heading: EAST }), (player, frame) => { if (frame === 30) player.push([0, 0, 8]) }],
    ['wizard', () => ({ speed: 1.2, heading: EAST }), player => { player.wind[0] = -6 }]
  ]
  for (const [name, steer, setup] of cases) {
    const { rig, mannequin } = character(name)
    const geometry = { rig, mannequin }
    const run = play(name, flat, 6, steer, setup)
    assert.ok(finite(run), `${name}: every joint finite`)
    assertFeetStay(run.relative, geometry, METRES_PER_PIXEL, name)
    assert.equal(metrics.kneeLimitViolations(run.world, geometry), 0, `${name}: knees`)
  }
})

function lumpiness (run: Run, frame: number): number {
  const local = (i: number, joint: string): number[] => {
    const f = run.world.frames[i]
    const p = f.joints[joint]
    const dx = p[0] - f.root.position[0]
    const dz = p[2] - f.root.position[2]
    const c = Math.cos(f.root.yaw)
    const s = Math.sin(f.root.yaw)
    return [dx * c - dz * s, p[1], dx * s + dz * c]
  }
  const move = (i: number, joint: string): number => {
    const a = local(i - 1, joint)
    const b = local(i, joint)
    return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  }
  let worst = 0
  for (const joint of Object.keys(run.world.frames[frame].joints)) {
    const around: number[] = []
    for (let i = frame - 12; i <= frame + 12; i++) if (i !== frame) around.push(move(i, joint))
    around.sort((a, b) => a - b)
    worst = Math.max(worst, move(frame, joint) / Math.max(around[12], 1e-4))
  }
  return worst
}

test('transitions: clip switches are no lumpier than ordinary frames, within 10 points, over three courses', t => {
  const results: Array<{ message: string, pass: boolean }> = []
  for (const name of HUMANOIDS) {
    const counts = { switches: 0, switchLumps: 0, ordinary: 0, ordinaryLumps: 0 }
    for (const seed of [3, 11, 17]) {
      const terrain = course(seed)
      const run = play(name, terrain, 60, wander(name, terrain, seed + 7))
      const inside = (i: number): boolean => i >= 13 && i + 12 < run.frames.length
      const switches = run.frames.map((f, i) => f.switched && inside(i) ? i : -1).filter(i => i >= 0)
      const near = new Set(switches.flatMap(i => [i - 1, i, i + 1]))
      const ordinary = Array.from({ length: 140 }, (_, j) => 20 + 9 * j).filter(i => inside(i) && !near.has(i))
      counts.switches += switches.length
      counts.switchLumps += switches.filter(i => lumpiness(run, i) > 3).length
      counts.ordinary += ordinary.length
      counts.ordinaryLumps += ordinary.filter(i => lumpiness(run, i) > 3).length
    }
    const atSwitches = counts.switchLumps / counts.switches
    const elsewhere = counts.ordinaryLumps / counts.ordinary
    const message = `${name}: ${atSwitches.toFixed(2)} at switches, ${elsewhere.toFixed(2)} elsewhere`
    results.push({ message, pass: atSwitches <= elsewhere + 0.1 })
  }
  t.diagnostic(results.map(r => r.message).join('; '))
  assert.ok(results.every(r => r.pass), results.map(r => r.message).join('; '))
})
