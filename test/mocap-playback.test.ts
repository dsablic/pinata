import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadCharacter } from '../src/formats/character.ts'
import type { Character } from '../src/formats/character.ts'
import { legsOf } from '../src/formats/rig.ts'
import { toAxisAngle, multiply, transpose } from '../src/math/matrix.ts'
import { validateClip } from '../src/mocap/clip.ts'
import type { Clip } from '../src/mocap/clip.ts'
import { buildDatabase } from '../src/mocap/database.ts'
import { createPlayer } from '../src/mocap/player.ts'
import type { Command, PlayerFrame } from '../src/mocap/player.ts'
import { mergeRetargeting, retargetRotations } from '../src/mocap/retarget.ts'
import type { RetargetOptions } from '../src/mocap/retarget.ts'
import type { MotionStyle } from '../src/mocap/style.ts'
import * as metrics from '../src/motion/metrics.ts'
import type { LocomotionRecording } from '../src/motion/metrics.ts'
import { chainLength, legLabels, restPose } from '../src/motion/pose.ts'
import type { Pose } from '../src/motion/pose.ts'
import { toWorld } from '../src/sim/body.ts'
import { generateTerrain, random } from '../src/world/terrain.ts'
import type { Terrain } from '../src/world/terrain.ts'

const FPS = 24
const HUMANOIDS = ['knight', 'rogue', 'dwarf', 'wizard']
const METRES_PER_PIXEL = 1 / 34
const EAST = Math.PI / 2

const clips: Clip[] = readdirSync('motion/clips').filter(f => f.endsWith('.json')).sort().map(file => {
  return validateClip(JSON.parse(readFileSync(join('motion/clips', file), 'utf8'))).value as Clip
})
const characters = new Map(HUMANOIDS.map(name => [name, loadCharacter(join('examples', name)).value as Character]))
const base = JSON.parse(readFileSync('motion/humanoid.json', 'utf8'))

function options (name: string, style?: MotionStyle): RetargetOptions {
  const { rig, mannequin } = characters.get(name) as Character
  const own = JSON.parse(readFileSync(join('examples', name, 'retarget.json'), 'utf8'))
  return { rig, rest: restPose(mannequin), mannequin, map: mergeRetargeting(base, own), style }
}

function legLength (character: Character): number {
  const rest = restPose(character.mannequin)
  return Math.min(...legsOf(character.rig).map(leg => chainLength(leg.chain, rest)))
}

function footLength (character: Character): number {
  const rest = restPose(character.mannequin)
  const lengthOf = (leg: { toe: string, ankle: string }): number => {
    return Math.hypot(...[0, 1, 2].map(i => rest[leg.toe][i] - rest[leg.ankle][i]))
  }
  return Math.max(...legsOf(character.rig).map(lengthOf))
}

/** A course like the world's, with stairs as high as the shortest humanoid's legs allow. */
function course (seed: number): Terrain {
  const cast = [...characters.values()]
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

/** Plays a character for a while under commands, recording joints in the world and above the ground under them. */
function play (
  name: string,
  terrain: Pick<Terrain, 'ground'>,
  seconds: number,
  steer: (frame: number, x: number) => Command,
  setup?: (player: ReturnType<typeof createPlayer>, frame: number) => void
): Run {
  const character = characters.get(name) as Character
  const settings = options(name)
  const player = createPlayer({ database: buildDatabase(clips, settings), fps: FPS, ground: terrain.ground }, {
    position: [2, 0, 0], yaw: EAST
  })
  const labels = legLabels(character.rig, settings.rest)
  const run: Run = { world: { fps: FPS, frames: [] }, relative: { fps: FPS, frames: [] }, frames: [] }
  let x = 2
  for (let i = 0; i < seconds * FPS; i++) {
    setup?.(player, i)
    player.command(steer(i, x))
    const frame = player.step()
    x = frame.root.position[0]
    const world: Pose = {}
    const relative: Pose = {}
    for (const [joint, local] of Object.entries({ ...settings.rest, ...frame.pose })) {
      const p = toWorld(local, frame.root)
      world[joint] = p
      relative[joint] = [p[0], p[1] - terrain.ground(p[0], p[2]), p[2]]
    }
    const planted = Object.fromEntries(labels.map((label, k) => [label, frame.planted[k]]))
    const common = { time: i / FPS, root: frame.root, clamped: frame.clamped, planted }
    run.world.frames.push({ ...common, joints: world })
    run.relative.frames.push({ ...common, joints: relative })
    run.frames.push(frame)
  }
  return run
}

/** Wanders the course: walks at varied speeds scaled to the legs, turns at the ends, stops now and then. */
function wander (name: string, terrain: Terrain, seed: number): (frame: number, x: number) => Command {
  const next = random(seed)
  const scaleToLegs = legLength(characters.get(name) as Character) / 0.75
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
    const character = characters.get(name) as Character
    const geometry = { rig: character.rig, mannequin: character.mannequin }
    for (const seed of [3, 11]) {
      const terrain = course(seed)
      const run = play(name, terrain, 60, wander(name, terrain, seed + 7))
      const where = `seed ${seed}`
      assert.ok(metrics.footSlidePx(run.relative, geometry, METRES_PER_PIXEL) <= 0.25, `${where}: slide`)
      assert.ok(metrics.groundPenetrationPx(run.relative, geometry, METRES_PER_PIXEL) <= 0.5, `${where}: penetration`)
      assert.equal(metrics.reachViolations(run.world), 0, `${where}: reach`)
      assert.equal(metrics.kneeLimitViolations(run.world, geometry), 0, `${where}: knees`)
      assert.ok(metrics.boneLengthError(run.world, geometry, restPose(character.mannequin)) <= 1e-9, `${where}: bones`)
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
  const plain = retargetRotations(walk, options('rogue'))
  const neutral = retargetRotations(walk, options('rogue', {}))
  assert.deepEqual(neutral, plain)
  const swagger: MotionStyle = {
    amplitude: { shoulderL: 1.5, shoulderR: 1.5 }, offset: { chest: [-6, 0, 0] }, variation: 2, seed: 4
  }
  const stiff: MotionStyle = {
    amplitude: { shoulderL: 0.5, shoulderR: 0.5 }, offset: { chest: [8, 0, 0] }, variation: 2, seed: 9
  }
  const a = retargetRotations(walk, options('rogue', swagger))
  const b = retargetRotations(walk, options('rogue', stiff))
  for (const joint of ['shoulderL', 'shoulderR', 'chest']) {
    const squares = a.map((frame, i) => {
      const angle = toAxisAngle(multiply(frame.rotations[joint], transpose(b[i].rotations[joint]))).angle
      return (angle * 180 / Math.PI) ** 2
    })
    const rms = Math.sqrt(squares.reduce((sum, v) => sum + v, 0) / squares.length)
    assert.ok(rms >= 5, `${joint}: ${rms.toFixed(1)} degrees RMS`)
  }
})
