import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase } from '../src/mocap/database.ts'
import type { JumpReach } from '../src/mocap/jump.ts'
import { arcOver, jumpOf, LAND_IN, runUp } from '../src/mocap/jump.ts'
import { createPlayer } from '../src/mocap/player.ts'
import type { Player, PlayerFrame } from '../src/mocap/player.ts'
import { loadClips, retargetOptions } from './mocap-fixtures.ts'

const FPS = 24
const EAST = Math.PI / 2
const EDGE = 5
const database = buildDatabase(loadClips(), retargetOptions('knight'))

function standing (height: number, from: number): { player: Player, frames: PlayerFrame[] } {
  const ground = (x: number): number => x >= EDGE ? height : 0
  const player = createPlayer({ database, fps: FPS, ground }, { position: [from, 0, 0], yaw: EAST })
  const frames = Array.from({ length: FPS }, () => player.step())
  return { player, frames }
}

function jumpOnto (height: number, from = EDGE - runUp(height)): { accepted: boolean, bases: number[], x: number } {
  const { player } = standing(height, from)
  const accepted = player.jump({ x: EDGE + LAND_IN, height })
  const bases: number[] = []
  let frame: PlayerFrame | undefined
  for (let i = 0; i < 3 * FPS; i++) {
    frame = player.step()
    bases.push(player.height())
  }
  return { accepted, bases, x: (frame as PlayerFrame).root.position[0] }
}

test('a jump rises over the ledge and lands on it at the target, for several heights', () => {
  for (const height of [0.3, 0.45, 0.6]) {
    const { accepted, bases, x } = jumpOnto(height)
    assert.ok(accepted, `${height} m accepted`)
    assert.ok(Math.max(...bases) > height + 0.05, `${height} m: apex ${Math.max(...bases).toFixed(2)}`)
    assert.ok(Math.abs(bases.at(-1)! - height) < 0.02, `${height} m: ended at ${bases.at(-1)!.toFixed(2)}`)
    assert.ok(Math.abs(x - (EDGE + LAND_IN)) < 0.15, `${height} m: landed at ${x.toFixed(2)}`)
  }
})

test('the body only goes up on the way up and down on the way down', () => {
  const { bases } = jumpOnto(0.45)
  const apex = bases.indexOf(Math.max(...bases))
  const rising = bases.slice(0, apex + 1).every((b, i, all) => i === 0 || b >= all[i - 1] - 1e-9)
  const falling = bases.slice(apex).every((b, i, all) => i === 0 || b <= all[i - 1] + 1e-9)
  assert.ok(rising && falling)
})

test('a jump that would miss is refused and leaves the player standing', () => {
  const { player } = standing(0.45, EDGE - runUp(0.45))
  assert.equal(player.jump({ x: EDGE + LAND_IN, height: 1.4 }), false, 'too high')
  assert.equal(player.jump({ x: EDGE + 4, height: 0.45 }), false, 'too far')
  assert.equal(player.jump({ x: 2, height: 0.45 }), false, 'nothing to land on')
  assert.equal(player.jumping(), false)
})

test('a jump from right against the ledge is refused: the body would go through its edge', () => {
  assert.equal(jumpOnto(0.45, EDGE - 0.05).accepted, false)
})

function pelvisThroughJump (height: number): number[] {
  const { player, frames } = standing(height, EDGE - runUp(height))
  const pelvis = database.options.rig.pelvis
  player.jump({ x: EDGE + LAND_IN, height })
  const run = Array.from({ length: 3 * FPS }, () => player.step().pose[pelvis][1])
  return [frames.at(-1)!.pose[pelvis][1], ...run]
}

test('the pelvis never moves between two frames by more than the launch speed gives, crouch to landing', () => {
  for (const height of [0.3, 0.45]) {
    const heights = pelvisThroughJump(height)
    const most = Math.max(...heights.slice(1).map((y, i) => Math.abs(y - heights[i])))
    const bound = arcOver(height, 0).launch / FPS + 0.005
    assert.ok(most <= bound, `${height} m: moved ${most.toFixed(3)} m in a frame, bound ${bound.toFixed(3)}`)
  }
})

test('a jump crouches first: the pelvis sinks with the feet down and the body still, then it launches', () => {
  const { player, frames } = standing(0.45, EDGE - runUp(0.45))
  const pelvis = database.options.rig.pelvis
  const stood = frames.at(-1)!.pose[pelvis][1]
  player.jump({ x: EDGE + LAND_IN, height: 0.45 })
  const crouch = Array.from({ length: 3 }, () => player.step())
  assert.ok(crouch.every(f => !player.falling() && f.root.velocity[0] === 0))
  assert.ok(stood - crouch.at(-1)!.pose[pelvis][1] > 0.01, 'the pelvis sank')
  assert.equal(player.height(), 0, 'the body is still on the floor')
  for (let i = 0; i < FPS / 2 && !player.falling(); i++) player.step()
  assert.ok(player.falling(), 'it launched')
})

test('the body lands standing still: no horizontal speed is carried out of the landing', () => {
  const { player } = standing(0.45, EDGE - runUp(0.45))
  player.jump({ x: EDGE + LAND_IN, height: 0.45 })
  while (!player.falling()) player.step()
  let frame = player.step()
  while (player.falling()) frame = player.step()
  assert.deepEqual(frame.root.velocity, [0, 0, 0])
})

test('a jump is refused while falling or already jumping', () => {
  const ground = (): number => 0
  const dropped = createPlayer({ database, fps: FPS, ground }, { position: [1, 0, 0], yaw: EAST, height: 3 })
  for (let i = 0; i < 3; i++) dropped.step()
  assert.ok(dropped.falling())
  assert.equal(dropped.jump({ x: 1.3, height: 0 }), false)
  const { player } = standing(0.45, EDGE - runUp(0.45))
  assert.equal(player.jump({ x: EDGE + LAND_IN, height: 0.45 }), true)
  assert.equal(player.jump({ x: EDGE + LAND_IN, height: 0.45 }), false)
})

test('a jump cancelled in the crouch leaves the player standing where it was', () => {
  const { player } = standing(0.45, EDGE - runUp(0.45))
  player.jump({ x: EDGE + LAND_IN, height: 0.45 })
  player.step()
  player.cancelJump()
  for (let i = 0; i < FPS; i++) player.step()
  assert.deepEqual([player.jumping(), player.falling(), player.height()], [false, false, 0])
})

test('a character with a super jump height gets up a 4 m rise and one without is refused', () => {
  const rise = 4
  const attempt = (jump?: JumpReach): boolean => {
    const ground = (x: number): number => x >= EDGE ? rise : 0
    const options = { database, fps: FPS, ground, ...(jump === undefined ? {} : { jump }) }
    const player = createPlayer(options, { position: [EDGE - runUp(rise), 0, 0], yaw: EAST })
    for (let i = 0; i < FPS; i++) player.step()
    return player.jump({ x: EDGE + LAND_IN, height: rise })
  }
  assert.deepEqual([attempt(), attempt(jumpOf(database.options.rig, database.options.rest, 'super'))], [false, true])
})
