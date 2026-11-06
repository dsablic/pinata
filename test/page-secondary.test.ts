import { test } from 'node:test'
import assert from 'node:assert/strict'
import { worldBundle } from '../src/cli/world-bundle.ts'
import { clothMotion, marksOf, readWorld, run, scenario } from '../src/diagnostics/page-scenarios.ts'
import type { ClothMotion } from '../src/diagnostics/page-scenarios.ts'
import { readLayout } from '../src/page/fixture.ts'
import type { LayoutFixture } from '../src/page/fixture.ts'
import { ROOT } from '../src/cli/paths.ts'

const world = readWorld(worldBundle())
const SECONDS = 90
const RUNS: Array<[string, number]> = [['demo-1200', 1], ['demo-1200', 3], ['demo-390', 2]]
const HEMMED = ['knight', 'dwarf', 'wizard']
const CHAINED = ['knight', 'rogue']
const WIND = 3
const NONE = { attract: 0 }

type Measured = { where: string, motion: Record<string, ClothMotion> }

function measured (wind: number): Measured[] {
  return RUNS.map(([layout, seed]) => ({
    where: `${layout} seed ${seed}${wind === 0 ? '' : ` in a ${wind} m/s wind`}`,
    motion: clothMotion(scenario(world, readLayout(ROOT, layout), seed, wind), world, SECONDS)
  }))
}

const calm = measured(0)
const windy = measured(WIND)

test('over a minute of walking on the demo layouts, capes, cloaks and the robe swing and trail further back', () => {
  for (const name of HEMMED) {
    const walked = calm.reduce((sum, { motion }) => sum + motion[name].walkingSeconds, 0)
    assert.ok(walked >= 60, `${name} walked ${walked.toFixed(1)} s`)
    const squares = calm.reduce((sum, { motion }) => sum + motion[name].hemRms ** 2 * motion[name].walkingSeconds, 0)
    const hemRms = Math.sqrt(squares / walked)
    assert.ok(hemRms >= 0.03, `${name}: hem moves ${hemRms.toFixed(3)} m RMS over the walking`)
    for (const { where, motion } of calm) {
      const m = motion[name]
      assert.ok(m.hemTrail > 0, `${where} ${name}: hem ${m.hemTrail.toFixed(3)} m further back walking than standing`)
    }
  }
})

test('plumes and scarves lag their anchors while walking', () => {
  for (const { where, motion } of calm) {
    for (const name of CHAINED) assert.ok(motion[name].tipRms >= 0.02, `${where} ${name}: ${motion[name].tipRms} m`)
  }
})

test('in a 3 m/s wind the knight\'s cape hangs at least 5 cm downwind of the pelvis', () => {
  for (const { where, motion } of windy) {
    assert.ok(motion.knight.hemDownwind >= 0.05, `${where}: ${motion.knight.hemDownwind.toFixed(3)} m downwind`)
  }
})

test('no cloth particle, pinned or free, sinks more than a centimetre into the body, in calm or wind', () => {
  for (const { where, motion } of [...calm, ...windy]) {
    for (const [name, m] of Object.entries(motion)) {
      assert.ok(m.inside <= 0.01, `${where} ${name}: ${m.inside} m inside`)
    }
  }
})

test('capes, cloaks and the robe stay behind the body: the hem is ahead of the pelvis in at most 1% of frames', () => {
  for (const { where, motion } of [...calm, ...windy]) {
    for (const name of HEMMED) {
      const ahead = motion[name].hemAhead
      assert.ok(ahead <= 0.01, `${where} ${name}: in front ${(100 * ahead).toFixed(1)}%`)
    }
  }
})

const pinGap = (s: ReturnType<typeof scenario>, name: string, joint: string): number => {
  const moving = s.cast.moving().find(m => m.name === name)!
  const anchor = moving.frame.joints[joint]
  const cloth = moving.cloth!
  return Math.hypot(cloth[0] - anchor[0], cloth[1] - anchor[1], cloth[2] - anchor[2])
}

test('cloth moves with a page element that carries its character, in the same frame', () => {
  const fixture = layout('demo-1200')
  const s = scenario(world, fixture, 1)
  run(s, 3)
  const before = pinGap(s, 'knight', 'capeAnchorL')
  const shifted = { ...fixture, marks: fixture.marks.map(m => ({ ...m, box: { ...m.box, top: m.box.top + 100 } })) }
  s.cast.setLayout(marksOf(shifted))
  assert.ok(Math.abs(pinGap(s, 'knight', 'capeAnchorL') - before) < 0.01)
})

test('a character dropped in or placed again starts its cloth afresh there, not where it was', () => {
  const fixture: LayoutFixture = {
    ...layout('demo-1200'),
    marks: [
      { id: 'island', box: { id: 0, mark: 'ground', left: 300, top: 300, width: 200, height: 20 }, hints: NONE },
      { id: 'floor', box: { id: 1, mark: 'ground', left: 0, top: 900, width: 1200, height: 40 }, hints: NONE }
    ]
  }
  const s = scenario(world, fixture, 1)
  let farthest = 0
  let drops = 0
  run(s, 75, () => {
    for (const m of s.cast.moving()) {
      if (m.cloth === undefined) continue
      if (m.frame.activity === 'drop') drops++
      const pelvis = m.frame.joints.pelvis
      farthest = Math.max(farthest, Math.hypot(m.cloth[0] - pelvis[0], m.cloth[1] - pelvis[1]))
    }
  })
  assert.ok(drops > 0, 'someone dropped in')
  assert.ok(farthest < 1.5, `cloth was ${farthest.toFixed(2)} m from its pelvis`)
})

function layout (name: string): LayoutFixture {
  return readLayout(ROOT, name)
}
