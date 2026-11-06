import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attackOf } from '../src/formats/attack.ts'
import { armsOf } from '../src/formats/rig.ts'
import { buildDatabase } from '../src/mocap/database.ts'
import { createPlayer } from '../src/mocap/player.ts'
import { sub } from '../src/math/vec.ts'
import { assertClose } from './helpers.ts'
import { character, loadClips, retargetOptions } from './mocap-fixtures.ts'

const EAST = Math.PI / 2

test('the default attack follows what the hands carry, and a named attack wins', () => {
  const knight = character('knight')
  const rogue = character('rogue')
  assert.equal(attackOf(knight.rig, knight.mannequin).attack, 'swing')
  assert.equal(attackOf(rogue.rig, rogue.mannequin).attack, 'punch')
  const staffed = {
    ...knight.mannequin,
    parts: knight.mannequin.parts.map(part => part.name === 'sword' ? { ...part, name: 'oakStaff' } : part)
  }
  const cast = { attack: 'cast', reason: "the default: it carries a staff ('oakStaff')" }
  assert.deepEqual(attackOf(knight.rig, staffed), cast)
  assert.equal(attackOf(rogue.rig, rogue.mannequin, 'cast').attack, 'cast')
})

test('the database keeps one attack: a captured one where it exists, else one composed from the idle', () => {
  const clips = loadClips()
  const attacks = (kind: 'swing' | 'cast'): string[] => buildDatabase(clips, retargetOptions('wizard'), kind)
    .performances.filter(take => take.kind === 'attack').map(take => take.name)
  assert.deepEqual(attacks('swing'), ['attack-swing'])
  assert.deepEqual(attacks('cast'), ['attack-cast'])
})

test('a composed cast draws the hands back, thrusts them forward past the shoulders and comes back', () => {
  const options = retargetOptions('wizard')
  const database = buildDatabase(loadClips(), options, 'cast')
  const player = createPlayer({ database, fps: 24, ground: () => 0 }, { position: [0, 0, 0], yaw: EAST })
  for (let i = 0; i < 24; i++) player.step()
  assert.equal(player.perform('attack'), true)
  const arms = armsOf(options.rig)
  const forward: number[] = []
  while (player.performing()) {
    const { pose } = player.step()
    forward.push(Math.min(...arms.map(arm => sub(pose[arm.joints[arm.joints.length - 1]], pose[arm.shoulder])[2])))
  }
  const most = Math.max(...forward)
  const peak = forward.indexOf(most)
  assert.ok(Math.min(...forward.slice(0, peak)) < 0, 'the hands draw back behind the shoulders first')
  const [arm] = arms
  const reach = Math.hypot(...sub(options.rest[arm.joints[arm.joints.length - 1]], options.rest[arm.shoulder]))
  assert.ok(most > 0.6 * reach, `both hands reach forward, ${most} against an arm of ${reach}`)
  assert.ok(forward[forward.length - 1] < 0.5 * most, 'and come back')
  const take = database.performances.find(own => own.kind === 'attack')!
  const idle = database.performances.find(own => own.kind === 'idle')!
  const end = take.frames.length - 1
  const base = idle.frames[end % (idle.frames.length - 1)]
  for (const [joint, rotation] of Object.entries(take.frames[end].rotations)) {
    rotation.flat().forEach((v, i) => assertClose(v, base.rotations[joint].flat()[i], 1e-9))
  }
})
