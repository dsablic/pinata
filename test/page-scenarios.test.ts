import { test } from 'node:test'
import assert from 'node:assert/strict'
import { worldBundle } from '../src/cli/world-bundle.ts'
import {
  canReach, falls, marksOf, placeOfTarget, readWorld, run, scenario, standing
} from '../src/diagnostics/page-scenarios.ts'
import type { Scenario } from '../src/diagnostics/page-scenarios.ts'
import { FPS } from '../src/page/cast.ts'
import type { CharacterState } from '../src/page/cast.ts'
import { readLayout } from '../src/page/fixture.ts'
import type { LayoutFixture } from '../src/page/fixture.ts'
import { surfaceGraph, path } from '../src/page/graph.ts'
import { DROP_LIMIT, STEP_HEIGHT } from '../src/page/walker.ts'
import type { Place } from '../src/page/walker.ts'
import type { Surface } from '../src/page/surfaces.ts'
import { ROOT } from '../src/cli/paths.ts'

const world = readWorld(worldBundle())
const layout = (name: string): LayoutFixture => readLayout(ROOT, name)
const LIVELY = ['perception', 'demo-1200', 'demo-390']
const EVERY = ['page-test', ...LIVELY]
const ARRIVAL_SECONDS = 8
const NEAR_METRES = 1
const MOST_MID_AIR_SHARE = 0.015
const CLEAR_SECONDS = 20
const REACH = { step: STEP_HEIGHT, drop: DROP_LIMIT, body: 2 }
const NONE = { attract: 0 }

function near (s: Scenario, c: CharacterState<string>, place: Place): boolean {
  const ppm = s.fixture.pixelsPerMetre
  return !c.falling && Math.abs(c.x / ppm - place.x) <= NEAR_METRES && Math.abs(-c.y / ppm - place.height) < 1e-3
}

test('on every recorded layout, a minute of wandering puts no sole through a surface and every fall lands', () => {
  for (const name of EVERY) {
    const s = scenario(world, layout(name))
    run(s, 60)
    const samples = s.cast.samples()
    assert.deepEqual(falls(samples).faults, [], name)
    const replaced = s.cast.characters().filter(c => c.placedAgain > 0).map(c => c.name)
    assert.deepEqual(replaced, [], `${name}: nobody ran out of ground and had to be placed again`)
    const m = standing(samples)
    assert.ok(m.midAir <= MOST_MID_AIR_SHARE * m.frames, `${name}: ${m.midAir} of ${m.frames} frames in mid-air`)
  }
})

test('on the perception page and the demo at both widths, every standing place leads down to the floor', () => {
  for (const name of LIVELY) {
    const s = scenario(world, layout(name))
    const graph = surfaceGraph(s.cast.ground(), REACH)
    const lowest = Math.min(...graph.nodes.map(n => n.height))
    const floor = graph.nodes.filter(n => n.height === lowest).map(n => n.id)
    const leadsDown = (id: number): boolean => floor.includes(id) || floor.some(f => path(graph, id, f) !== undefined)
    const stranded = graph.nodes.filter(n => !leadsDown(n.id))
    assert.deepEqual(stranded.map(n => s.fixture.marks[n.surface].id), [], name)
  }
})

test('on a recorded layout with a rise taller than a step added, nobody climbs onto it', () => {
  const fixture = layout('perception')
  const rise = { id: 'rise', box: { id: 9, mark: 'ground' as const, left: 520, top: 684, width: 120, height: 16 } }
  const s = scenario(world, { ...fixture, marks: [...fixture.marks, { ...rise, hints: { attract: 3 } }] })
  const climbed = new Set<string>()
  const left = new Set<string>()
  run(s, 60, () => {
    for (const c of s.cast.characters()) {
      if (c.on !== 'rise') left.add(c.name)
      else if (left.has(c.name)) climbed.add(c.name)
    }
  })
  assert.deepEqual([...climbed], [])
})

test('on the perception page and the demo at both widths, every character keeps busy over a minute', () => {
  for (const name of LIVELY) {
    const s = scenario(world, layout(name))
    run(s, 60)
    const dull = s.cast.characters().filter(c => c.started < 4 || c.elements < 2)
    assert.deepEqual(dull.map(c => `${c.name}: ${c.started} activities, ${c.elements} elements`), [], name)
  }
})

test('the same layout and seed give the same world, drop-ins included', () => {
  const states = [1, 2].map(() => {
    const s = scenario(world, layout('demo-390'))
    const seen: string[] = []
    run(s, 45, () => { seen.push(JSON.stringify(s.cast.characters())) })
    return JSON.stringify([seen, s.cast.samples(), s.cast.visits()])
  })
  assert.equal(states[0], states[1])
})

test('an element removed under a character drops it onto the surface below, feet down on landing', () => {
  const fixture = layout('page-test')
  const s = scenario(world, fixture)
  run(s, 3)
  const ground = s.cast.ground()
  const ppm = fixture.pixelsPerMetre
  const over = s.cast.characters().find(c => !c.falling && c.on !== undefined && ground.surfaces.some(g => {
    return g.from * ppm <= c.x && g.to * ppm >= c.x && -g.height * ppm > c.y + 50
  }))
  assert.ok(over?.on !== undefined, 'a character stands over a lower surface')
  s.cast.setLayout(marksOf(fixture, [over.on]))
  s.cast.samples()
  run(s, 4)
  const own = s.cast.samples().filter(sample => sample.name === over.name)
  const result = falls(own)
  assert.equal(result.falls, 1)
  assert.deepEqual(result.faults, [])
  assert.ok(s.cast.characters().find(c => c.name === over.name)!.y > over.y + 50, 'it ends lower down')
})

test('moved with the page, standing characters move with their elements', () => {
  const fixture = layout('demo-1200')
  const s = scenario(world, fixture)
  run(s, 3)
  const before = s.cast.characters()
  const shifted = { ...fixture, marks: fixture.marks.map(m => ({ ...m, box: { ...m.box, top: m.box.top + 40 } })) }
  s.cast.setLayout(marksOf(shifted))
  const after = s.cast.characters()
  before.filter(c => !c.falling).forEach(c => {
    const now = after.find(a => a.name === c.name)!
    assert.ok(Math.abs(now.y - c.y - 40) < 0.5, `${c.name} moved from ${c.y} to ${now.y}`)
  })
})

test('a noticed target sends the nearest character that can reach it, which arrives and says its words', () => {
  const cases: Array<[string, string]> = [
    ['perception', 'button'], ['perception', 'field'], ['perception', 'shelf'], ['demo-1200', 'pinata-link'],
    ['demo-1200', 'source-link'], ['demo-1200', 'hello'], ['demo-390', 'pinata-link'], ['demo-390', 'hello']
  ]
  let sent = 0
  let refused = 0
  for (const [name, id] of cases) {
    const s = scenario(world, layout(name))
    const target = s.fixture.targets.find(t => t.id === id)!
    run(s, 3)
    const place = placeOfTarget(s, target)
    assert.ok(place !== undefined, `${name} #${id} has a place`)
    for (let waited = 0; waited < CLEAR_SECONDS * FPS && s.cast.characters().some(c => near(s, c, place)); waited++) {
      run(s, 1 / FPS)
    }
    const before = s.cast.characters()
    assert.ok(!before.some(c => near(s, c, place)), `${name} #${id}: nobody is near before it is noticed`)
    const able = before.filter(c => canReach(s.cast.ground(), c, place, s.fixture.pixelsPerMetre))
    const accepted = s.cast.interest({ key: id, place, ...(target.say === undefined ? {} : { say: target.say }) })
    assert.equal(accepted, able.length > 0, `${name} #${id}: sent only when someone can reach it`)
    if (!accepted) {
      refused++
      continue
    }
    sent++
    const distance = (c: CharacterState<string>): number => {
      return Math.hypot(c.x / s.fixture.pixelsPerMetre - place.x, -c.y / s.fixture.pixelsPerMetre - place.height)
    }
    const nearest = [...able].sort((a, b) => distance(a) - distance(b))[0]
    const visitor = s.cast.visits().at(-1)!.name
    assert.equal(visitor, nearest.name, `${name} #${id}: the nearest was sent`)
    let arrived = false
    let said = false
    for (let step = 0; step < (ARRIVAL_SECONDS + 3) * FPS && !said; step++) {
      run(s, 1 / FPS)
      const c = s.cast.characters().find(k => k.name === visitor)!
      if (step < ARRIVAL_SECONDS * FPS && near(s, c, place)) arrived = true
      said = arrived && c.saying === target.say
    }
    assert.ok(arrived && said, `${name} #${id}: ${visitor} arrived ${String(arrived)}, said ${String(said)}`)
  }
  assert.ok(sent >= 5 && refused >= 1, `${sent} visits sent, ${refused} refused`)
})

test('a visit whose place is taken from the page ends in silence', () => {
  const fixture = layout('perception')
  const trials = [0, 1, 3, 6].flatMap(seconds => fixture.targets.map(target => ({ seconds, target })))
  const trial = trials.map(({ seconds, target }) => {
    const s = scenario(world, fixture)
    run(s, seconds)
    const place = placeOfTarget(s, target)!
    const holds = (g: Surface): boolean => g.height === place.height && g.from <= place.x && g.to >= place.x
    const surface = s.cast.ground().surfaces.find(holds)
    const floor = surface === undefined ? undefined : fixture.marks[surface.id].id
    const sent = s.cast.interest({ key: target.id, place, ...(target.say === undefined ? {} : { say: target.say }) })
    const visitor = s.cast.visits().at(-1)?.name
    const elsewhere = sent && s.cast.characters().find(c => c.name === visitor)?.on !== floor
    return { s, target, floor, visitor, elsewhere }
  }).find(t => t.elsewhere && t.floor !== undefined && t.target.say !== undefined)
  assert.ok(trial?.floor !== undefined, 'a visit sent to an element its visitor is not standing on')
  const { s, target, floor, visitor } = trial
  s.cast.setLayout(marksOf(fixture, [floor]))
  const words = new Set<string>()
  const activities = new Set<string>()
  run(s, 3, () => {
    const c = s.cast.characters().find(k => k.name === visitor)!
    words.add(c.saying)
    activities.add(c.activity)
  })
  assert.ok(activities.has('rest'), 'the visit ended')
  assert.ok(!words.has(target.say!), `#${target.id}'s words were not said`)
})

test('characters stuck on one element drop back in from above, onto open places elsewhere, and land', () => {
  const fixture: LayoutFixture = {
    ...layout('demo-1200'),
    marks: [
      { id: 'island', box: { id: 0, mark: 'ground', left: 300, top: 300, width: 200, height: 20 }, hints: NONE },
      { id: 'floor', box: { id: 1, mark: 'ground', left: 0, top: 900, width: 1200, height: 40 }, hints: NONE }
    ]
  }
  const s = scenario(world, fixture)
  const ppm = fixture.pixelsPerMetre
  const island = fixture.marks[0].box
  type Drop = { name: string, from: string | undefined, x: number, startY: number, landed?: string, landedY?: number }
  const drops: Drop[] = []
  const last = new Map<string, CharacterState<string>>()
  run(s, 80, () => {
    for (const c of s.cast.characters()) {
      const before = last.get(c.name)
      if (c.activity === 'drop' && before?.activity !== 'drop') {
        drops.push({ name: c.name, from: before?.on, x: c.x, startY: c.y })
      }
      const open = drops.findLast(d => d.name === c.name && d.landed === undefined)
      if (open !== undefined && before?.falling === true && !c.falling) {
        open.landed = c.on
        open.landedY = c.y
      }
      last.set(c.name, c)
    }
  })
  assert.ok(new Set(drops.map(d => d.name)).size === s.cast.characters().length, `${drops.length} drop-ins`)
  for (const d of drops) {
    assert.ok(d.landed !== undefined && d.landed !== d.from, `${d.name} landed on ${d.landed} after leaving ${d.from}`)
    assert.ok(d.landedY! - d.startY >= 2.5 * ppm - 1, `${d.name} fell from ${d.startY} to ${d.landedY}`)
    const under = d.x >= island.left && d.x <= island.left + island.width
    assert.ok(!(d.landed === 'floor' && under && d.startY < island.top), `${d.name} fell through the island`)
  }
  assert.deepEqual(falls(s.cast.samples()).faults, [])
})

test('every character is drawn on every frame, and the dwarf never loses its helmet', () => {
  const s = scenario(world, layout('demo-1200'))
  const steel = [0x85, 0x92, 0xad]
  const empty: string[] = []
  let bareHeaded = 0
  run(s, 60, step => {
    for (const d of s.cast.drawables()) {
      const { image } = d.sprite()
      let opaque = 0
      let helmet = 0
      for (let k = 0; k < image.data.length; k += 4) {
        if (image.data[k + 3] === 0) continue
        opaque++
        if ([0, 1, 2].every(c => Math.abs(image.data[k + c] - steel[c]) < 8)) helmet++
      }
      if (opaque === 0) empty.push(`${d.name} at step ${step}`)
      if (d.name === 'dwarf' && helmet < 10) bareHeaded++
    }
  })
  assert.deepEqual(empty.slice(0, 5), [])
  assert.equal(bareHeaded, 0)
})

test('walking off an edge, the body falls from the edge height and is never posed on the lower ground first', () => {
  const MOST_STEP_METRES = 0.5
  const jumps: string[] = []
  for (const seed of [1, 2, 3]) {
    const s = scenario(world, layout('demo-390'), seed)
    const before = new Map<string, number>()
    run(s, 30, step => {
      for (const { name, frame } of s.cast.moving()) {
        const y = frame.joints.pelvis[1]
        const last = before.get(name)
        if (last !== undefined && Math.abs(y - last) > MOST_STEP_METRES) jumps.push(`${name} seed ${seed} step ${step}`)
        before.set(name, y)
      }
    })
  }
  assert.deepEqual(jumps, [])
})

test('the painter changes the sprites and never the walkers\' motion', () => {
  const frames = (painter: 'strip' | 'rotate'): string[] => {
    const s = scenario(world, layout('page-test'), 7, 0, false, painter)
    const seen: string[] = []
    run(s, 20, () => {
      s.cast.drawables().forEach(d => d.sprite())
      seen.push(JSON.stringify(s.cast.moving().map(m => [m.name, m.frame.root])))
    })
    return seen
  }
  assert.deepEqual(frames('rotate'), frames('strip'))
})
