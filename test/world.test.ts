import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadCharacter } from '../src/formats/character.ts'
import { legsOf } from '../src/formats/rig.ts'
import { solePoints } from '../src/motion/metrics.ts'
import { validateActivities } from '../src/world/activities.ts'
import { createWorld } from '../src/world/world.ts'
import type { CastMember, World, WorldFrame } from '../src/world/world.ts'

const FPS = 24
const NAMES = ['knight', 'dog', 'rogue', 'beetle', 'horse', 'dwarf', 'spider', 'wizard']
const cast: CastMember[] = NAMES.map(name => {
  const character = loadCharacter(new URL(`../examples/${name}`, import.meta.url).pathname).value!
  return { name, mannequin: character.mannequin, rig: character.rig }
})
const activities = validateActivities(
  JSON.parse(readFileSync(new URL('../site/activities.json', import.meta.url), 'utf8'))
).value!

function world (seed = 3): World {
  return createWorld({ seed, cast, activities, fps: FPS, length: 16 })
}

function run (w: World, frames: number): WorldFrame[] {
  return Array.from({ length: frames }, () => w.step())
}

test('the showcase activities validate, and mistakes name their path', () => {
  assert.ok(activities !== undefined)
  const broken = structuredClone(activities) as any
  broken.activities.wander.steps[0].to = 'moon'
  broken.activities.rest.steps[1].seconds = [5, 1]
  broken.reactions.poke = []
  assert.deepEqual(validateActivities(broken).errors.map(e => e.path).sort(), [
    'activities.rest.steps[1].seconds', 'activities.wander.steps[0].to', 'reactions.poke'
  ])
})

test('over a minute every character keeps busy, covers ground for its speed, and visits happen', () => {
  const frames = run(world(), 60 * FPS)
  cast.forEach((member, k) => {
    const activities = frames.map(f => f.actors[k].activity)
    const started = activities.filter((a, i) => i === 0 || a !== activities[i - 1] || frames[i].actors[k].handover)
    const distinct = new Set(activities)
    let moved = 0
    for (let i = 1; i < frames.length; i++) {
      moved += Math.abs(frames[i].actors[k].root.position[0] - frames[i - 1].actors[k].root.position[0])
    }
    const nonStop = member.rig.gait.referenceSpeed * 60
    assert.ok(distinct.size >= 2, `${member.name}: ${[...distinct].join(', ')}`)
    assert.ok(new Set(started).size >= 2 && started.length >= 4, `${member.name} started ${started.length}`)
    assert.ok(moved >= 0.25 * nonStop, `${member.name} moved ${moved.toFixed(1)} m of ${nonStop.toFixed(1)}`)
  })
  assert.ok(frames.some(f => f.actors.some(a => a.activity === 'visit' && a.say !== undefined)), 'a visit happened')
  for (const f of frames) {
    for (const a of f.actors) assert.ok(Object.values(a.joints).every(p => p.every(Number.isFinite)))
    for (let i = 0; i < f.actors.length; i++) {
      for (let j = i + 1; j < f.actors.length; j++) {
        const [p, q] = [f.actors[i].root.position, f.actors[j].root.position]
        assert.ok(Math.hypot(p[0] - q[0], p[2] - q[2]) > 0.3, 'two characters stand in each other')
      }
    }
  }
})

test('where one plan hands over to the next, no planted foot moves more than a pixel', () => {
  const frames = run(world(5), 40 * FPS)
  let handovers = 0
  cast.forEach((member, k) => {
    const mpp = member.mannequin.height / 48
    for (let i = 1; i < frames.length; i++) {
      if (frames[i].actors[k].handover !== true) continue
      handovers++
      for (const leg of legsOf(member.rig)) {
        const before = solePoints(frames[i - 1].actors[k].joints, leg, member.mannequin)
        const after = solePoints(frames[i].actors[k].joints, leg, member.mannequin)
        before.forEach((p, s) => {
          const q = after[s]
          const moved = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) / mpp
          assert.ok(moved <= 1, `${member.name} ${leg.name} frame ${i}: ${moved.toFixed(2)} px`)
        })
      }
    }
  })
  assert.ok(handovers > 50, `${handovers} handovers`)
})

test('the same seed gives the same world, frame by frame', () => {
  const a = run(world(9), 10 * FPS)
  const b = run(world(9), 10 * FPS)
  assert.deepEqual(a, b)
  assert.notDeepEqual(run(world(10), 10 * FPS).map(f => f.actors[0].root), a.map(f => f.actors[0].root))
})

test('a poke startles a character into moving away within half a second', () => {
  const w = world(4)
  const before = run(w, 3 * FPS)
  const x = before[before.length - 1].actors[0].root.position[0]
  w.poke(0, x - 0.5)
  const after = run(w, 3 * FPS)
  const startled = after.findIndex(f => f.actors[0].activity === 'startled')
  assert.ok(startled >= 0 && startled <= FPS / 2, `startled after ${startled} frames`)
  assert.equal(after[startled].actors[0].say, '!')
  assert.ok(after[after.length - 1].actors[0].root.position[0] > x + 0.3, 'it moved away from the poke')
})
