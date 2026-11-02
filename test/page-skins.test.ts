import { test } from 'node:test'
import assert from 'node:assert/strict'
import { worldBundle } from '../src/cli/world-bundle.ts'
import { readWorld, run, scenario, withoutBindings } from '../src/diagnostics/page-scenarios.ts'
import { readLayout } from '../src/page/fixture.ts'
import { toLocal } from '../src/sim/body.ts'
import { length, sub } from '../src/math/vec.ts'
import type { ReadWorld } from '../src/world/bundle.ts'
import { ROOT } from '../src/cli/paths.ts'

const world = readWorld(worldBundle())
const unbound: ReadWorld = { ...world, cast: world.cast.map(withoutBindings) }
const WARMUP_SECONDS = 4
const SECONDS = 12
const WINDOWS: Array<[string, number]> = ['demo-1200', 'demo-390']
  .flatMap(layout => [1, 2, 3].map(seed => [layout, seed] as [string, number]))
const LEAST_EXTRA_SWING_DEGREES = 10
const MOST_STRETCH = 0.1
const MOST_FRAMES_STRETCHED = 0.01
const PARTS: Array<[string, string, string]> = [
  ['knight', 'capeTopL', 'capeHemL'], ['knight', 'capeTopR', 'capeHemR'],
  ['dwarf', 'cloakTop', 'cloakBot'], ['rogue', 'scarfAnchor', 'scarfEnd'], ['wizard', 'chest', 'hem']
]

type Bone = { angles: number[], lengths: number[] }

function bones (from: ReadWorld): Map<string, Bone> {
  const found = new Map<string, Bone>(PARTS.map(([name, a, b]) => [`${name} ${a}-${b}`, { angles: [], lengths: [] }]))
  for (const [layout, seed] of WINDOWS) {
    const s = scenario(from, readLayout(ROOT, layout), seed)
    run(s, WARMUP_SECONDS)
    run(s, SECONDS, () => {
      for (const [name, a, b] of PARTS) {
        const moving = s.cast.moving().find(m => m.name === name)
        if (moving === undefined || moving.frame.falling) continue
        const { joints, root } = moving.frame
        const [start, end] = [toLocal(joints[a], root), toLocal(joints[b], root)]
        const bone = found.get(`${name} ${a}-${b}`) as Bone
        bone.angles.push(Math.atan2(end[2] - start[2], start[1] - end[1]) * 180 / Math.PI)
        const curve = moving.curves[b] ?? [joints[a], joints[b]]
        bone.lengths.push(curve.slice(1).reduce((sum, at, i) => sum + length(sub(at, curve[i])), 0))
      }
    })
  }
  return found
}

const bound = bones(world)
const rigid = bones(unbound)
const middle = (values: number[]): number => [...values].sort((p, q) => p - q)[values.length >> 1]
const range = (values: number[]): number => Math.max(...values) - Math.min(...values)

test('every part drawn on a bound joint swings with its cloth, well beyond its rigid motion', () => {
  for (const [key, bone] of bound) {
    const extra = range(bone.angles) - range((rigid.get(key) as Bone).angles)
    assert.ok(extra >= LEAST_EXTRA_SWING_DEGREES, `${key}: ${extra.toFixed(1)} degrees more swing`)
  }
})

test('bound parts keep their length along their curve within 10% in all but 1% of frames, on every window', () => {
  for (const [key, bone] of bound) {
    const drawn = middle((rigid.get(key) as Bone).lengths)
    const off = bone.lengths.filter(l => Math.abs(l / drawn - 1) > MOST_STRETCH).length / bone.lengths.length
    assert.ok(off <= MOST_FRAMES_STRETCHED, `${key}: ${(100 * off).toFixed(1)}% of frames off their length`)
  }
})
