import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDatabase, jumpPhases } from '../src/mocap/database.ts'
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

test('the pelvis never moves between two frames by more than 1.25 times the launch speed gives, crouch to landing', () => {
  for (const height of [0.3, 0.45]) {
    const heights = pelvisThroughJump(height)
    const most = Math.max(...heights.slice(1).map((y, i) => Math.abs(y - heights[i])))
    const bound = 1.25 * arcOver(height, 0).launch / FPS + 0.005
    assert.ok(most <= bound, `${height} m: moved ${most.toFixed(3)} m in a frame, bound ${bound.toFixed(3)}`)
  }
})

test('a jump crouches first: the pelvis sinks with the feet down and the body still, then it launches', () => {
  const { player, frames } = standing(0.45, EDGE - runUp(0.45))
  const pelvis = database.options.rig.pelvis
  const stood = frames.at(-1)!.pose[pelvis][1]
  player.jump({ x: EDGE + LAND_IN, height: 0.45 })
  const crouch: PlayerFrame[] = []
  while (!player.falling() && crouch.length < 2 * FPS) crouch.push(player.step())
  assert.ok(player.falling(), 'it launched')
  assert.ok(crouch.length > 0.3 * FPS, `a take's own crouch takes longer than a dip: ${crouch.length} frames`)
  assert.ok(crouch.slice(0, -1).every(f => f.root.velocity[0] === 0), 'the body is still while it crouches')
  assert.ok(stood - Math.min(...crouch.map(f => f.pose[pelvis][1])) > 0.1, 'the pelvis sank')
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

test('a super jump reaches a 6 m rise over its 1 m clearance, refuses above it, and a leg jump refuses both', () => {
  const super_ = jumpOf(database.options.rig, database.options.rest, 'super')
  const attempt = (rise: number, jump?: JumpReach): boolean => {
    const ground = (x: number): number => x >= EDGE ? rise : 0
    const options = { database, fps: FPS, ground, ...(jump === undefined ? {} : { jump }) }
    const player = createPlayer(options, { position: [EDGE - runUp(rise, jump?.clearance), 0, 0], yaw: EAST })
    for (let i = 0; i < FPS; i++) player.step()
    return player.jump({ x: EDGE + LAND_IN, height: rise })
  }
  assert.deepEqual([attempt(6, super_), attempt(6.1, super_), attempt(4), attempt(6)], [true, false, false, false])
})

test('a super jump flies to its 1 m apex and lands on the 6 m ledge', () => {
  const super_ = jumpOf(database.options.rig, database.options.rest, 'super')
  const ground = (x: number): number => x >= EDGE ? 6 : 0
  const start = { position: [EDGE - runUp(6, 1), 0, 0] as [number, number, number], yaw: EAST }
  const player = createPlayer({ database, fps: FPS, ground, jump: super_ }, start)
  for (let i = 0; i < FPS; i++) player.step()
  assert.equal(player.jump({ x: EDGE + LAND_IN, height: 6 }), true)
  const bases: number[] = []
  for (let i = 0; i < 4 * FPS; i++) {
    player.step()
    bases.push(player.height())
  }
  assert.ok(Math.abs(Math.max(...bases) - 7) < 0.1, `apex ${Math.max(...bases).toFixed(2)}`)
  assert.ok(Math.abs(bases.at(-1)! - 6) < 0.02, `ended at ${bases.at(-1)!.toFixed(2)}`)
  assert.equal(player.jumping(), false)
})

const takeNames = new Set(database.jumpTakes.map(take => take.name))

test('jump takes are never matching candidates and are not entries the player can stand on', () => {
  assert.ok(takeNames.size > 0)
  assert.ok(database.candidates.every(c => !takeNames.has(database.entries[c.entry].name)))
  assert.ok(database.entries.every(e => !takeNames.has(e.name)))
})

test('walking never plays a jump take; a jump plays one from its command to its landing, then walks on', () => {
  const { player } = standing(0.45, EDGE - runUp(0.45))
  const played: string[] = []
  const walk = (seconds: number): void => {
    for (let i = 0; i < seconds * FPS; i++) {
      player.command({ speed: player.jumping() ? 0 : 1.1, heading: EAST })
      played.push(player.step().clip)
    }
  }
  walk(2)
  assert.ok(played.every(clip => !takeNames.has(clip)), 'walking')
  const before = played.length
  player.jump({ x: EDGE + LAND_IN, height: 0.45 })
  walk(3)
  const taken = played.slice(before).map(clip => takeNames.has(clip))
  const first = taken.indexOf(true)
  const last = taken.lastIndexOf(true)
  assert.equal(first, 0, 'the take starts at the command')
  assert.ok(taken.slice(first, last + 1).every(Boolean), 'one unbroken take')
  assert.ok(last > FPS / 2 && !taken.at(-1), 'then matching again')
})

test('the take whose flight fits the jump is chosen', () => {
  const chosen = (rise: number, run: number): string => {
    const ground = (x: number): number => x >= EDGE ? rise : 0
    const player = createPlayer({ database, fps: FPS, ground }, { position: [EDGE - run, 0, 0], yaw: EAST })
    for (let i = 0; i < FPS; i++) player.step()
    assert.ok(player.jump({ x: EDGE + LAND_IN, height: rise }))
    return player.step().clip
  }
  assert.equal(chosen(0, 0.3), 'jump-forward-5', 'a flat hop')
  assert.equal(chosen(0.3, 0.5), 'jump-forward-7', 'a step up')
  assert.equal(chosen(0.5, 0.8), 'jump-forward-10', 'a long, high one')
})

test('a push during the crouch cancels the jump and hands back to matching; one in flight does not', () => {
  const { player } = standing(0.45, EDGE - runUp(0.45))
  player.jump({ x: EDGE + LAND_IN, height: 0.45 })
  for (let i = 0; i < 3; i++) player.step()
  player.push([0.5, 0, 0])
  assert.equal(player.jumping(), false)
  assert.ok(!takeNames.has(player.step().clip))
  const flying = standing(0.45, EDGE - runUp(0.45))
  flying.player.jump({ x: EDGE + LAND_IN, height: 0.45 })
  while (!flying.player.falling()) flying.player.step()
  flying.player.push([0.5, 0, 0])
  assert.equal(flying.player.jumping(), true)
})

test('a jump take is cut at its crouch, flight and landing from the feet and the root height', () => {
  const heights = [1, 1, 1, 1, 1, 0.96, 0.99, 0.99, 0.9, 0.85, 0.95, 1.1, 1.3, 1.2, 1, 0.9, 0.95, 1, 1]
  const contact = (n: number): boolean[] => [true, true].map((_, k) => k < n)
  const contacts = [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 1, 2, 2, 2].map(contact)
  const phases = { start: 4, crouch: 5, launch: 11, land: 15, settle: 17 }
  assert.deepEqual(jumpPhases(contacts, heights), phases, 'play starts 3 frames before the last descent')
  assert.throws(() => jumpPhases(contacts.map(() => contact(2)), heights), /crouch, fly and land/)
  assert.throws(() => jumpPhases(contacts, heights.map(() => 1)), /crouch, fly and land/)
})
