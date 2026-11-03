import { test } from 'node:test'
import assert from 'node:assert/strict'
import { landingFrame } from '../src/diagnostics/landings.ts'
import { buildDatabase } from '../src/mocap/database.ts'
import { createWalker } from '../src/page/walker.ts'
import type { WalkerFrame } from '../src/page/walker.ts'
import type { Ground } from '../src/page/surfaces.ts'
import { random } from '../src/world/terrain.ts'
import { loadClips, retargetOptions } from './mocap-fixtures.ts'

const FPS = 24
const DROP = 2
const database = buildDatabase(loadClips(), retargetOptions('knight'))
const pelvis = (f: WalkerFrame): number => f.joints[database.options.rig.pelvis][1]
const floorOf = (half: number): Ground => ({ surfaces: [{ id: 0, from: -half, to: half, height: 0 }], walls: [] })

function dipsAfterLanding (ground: Ground): number[] {
  const walker = createWalker({
    database, fps: FPS, random: random(1), ground, place: { x: 0, height: 0 }, yaw: Math.PI / 2
  })
  const standing = pelvis(Array.from({ length: 12 }, () => walker.step()).at(-1) as WalkerFrame)
  walker.dropIn({ x: 0, height: 0 }, DROP)
  const frames = Array.from({ length: 60 }, () => walker.step())
  return frames.slice(landingFrame(frames)).map(f => standing - pelvis(f))
}

test('a character walking on from a drop-in rises out of the dip sooner than one standing', () => {
  const walking = dipsAfterLanding(floorOf(10))
  const standing = dipsAfterLanding(floorOf(0.3))
  assert.ok(Math.abs(walking[3] - standing[3]) < 0.01, 'the first 0.2 s are the dip\'s own')
  assert.ok(walking[7] < 0.03, `${walking[7]} m down 7 ticks after landing, walking`)
  assert.ok(standing[7] > 0.045, `${standing[7]} m down 7 ticks after landing, standing`)
})
