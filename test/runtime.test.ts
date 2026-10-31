import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadCharacter } from '../src/formats/character.ts'
import { length, sub } from '../src/math/vec.ts'
import { parentsOf } from '../src/motion/skeleton.ts'
import { validateBehaviours } from '../src/runtime/behaviours.ts'
import type { Behaviours } from '../src/runtime/behaviours.ts'
import { createLive, maskJoints } from '../src/runtime/character.ts'
import type { Live, LiveFrame, LiveOptions } from '../src/runtime/character.ts'
import { createDirector } from '../src/runtime/director.ts'
import { createView, DEFAULT_VIEW, frameHash } from '../src/runtime/render.ts'

const FPS = 24
const dir = new URL('../examples/unicorn', import.meta.url).pathname
const unicorn = loadCharacter(dir).value!
const spec = validateBehaviours(JSON.parse(readFileSync(`${dir}/behaviours.json`, 'utf8'))).value!
const OPTIONS: LiveOptions = {
  fps: FPS, substeps: 8, reduced: false, anchor: [0, 2, 0], gravity: 9.81, wind: [0, 0, 0]
}

function live (options: Partial<LiveOptions> = {}, behaviours: Behaviours = spec): Live {
  return createLive(unicorn, behaviours, { ...OPTIONS, ...options })
}

function run (character: Live, frames: number, plan: Record<number, (l: Live) => void> = {}): LiveFrame[] {
  return Array.from({ length: frames }, (_, i) => {
    plan[i]?.(character)
    return character.step()
  })
}

function limbMotion (frames: LiveFrame[], joints: string[]): number {
  let most = 0
  for (let i = 1; i < frames.length; i++) {
    for (const joint of joints) {
      const moved = length(sub(frames[i].joints[joint], frames[i - 1].joints[joint]))
      const body = length(sub(frames[i].hook, frames[i - 1].hook))
      most = Math.max(most, moved - body)
    }
  }
  return most
}

test('the unicorn behaviours file validates, and mistakes are load errors with paths', () => {
  assert.ok(spec !== undefined)
  const broken = structuredClone(spec) as unknown as Record<string, any>
  broken.behaviours.idle.additive[0].do = 'wobble'
  broken.behaviours.fail.then = 'nowhere'
  broken.states.transitions[0].to = 'think2'
  delete broken.hang.rope
  const paths = validateBehaviours(broken).errors.map(e => e.path)
  assert.deepEqual(paths.sort(), [
    'behaviours.fail.then', 'behaviours.idle.additive[0].do', 'hang.rope', 'states.transitions[0].to'
  ])
})

test('a hit swings the body past 10 degrees within 0.5 s, moves the limbs, and settles below 2 degrees in 6 s', () => {
  const frames = run(live(), 24 * 7, { 0: l => l.hit() })
  assert.ok(Math.max(...frames.slice(0, 12).map(f => f.swing)) > 10)
  assert.ok(frames[24 * 6].swing < 2, `swing at 6 s: ${frames[24 * 6].swing}`)
  assert.ok(limbMotion(frames.slice(0, 24), ['toeLF', 'toeRH', 'maneB3', 'tailA3']) > 0.01)
})

test('the same calls give the same frames, down to the pixels', () => {
  const plan = {
    5: (l: Live) => l.hit(), 20: (l: Live) => { l.dispatch('toolStart') }, 40: (l: Live) => l.play('celebrate')
  }
  const view = (): ReturnType<typeof createView> => createView(unicorn, { ...DEFAULT_VIEW, samples: 1 })
  const hashes = (): string[] => {
    const v = view()
    return run(live(), 60, plan).map(f => frameHash(v.render(f)))
  }
  assert.deepEqual(hashes(), hashes())
})

test('switching behaviours keeps the body continuous: no jump above 3x the median frame movement', () => {
  const order = ['think', 'busy', 'celebrate', 'idle']
  const plan: Record<number, (l: Live) => void> = {}
  order.forEach((name, i) => { plan[48 * (i + 1)] = l => l.play(name, 0) })
  const frames = run(live(), 48 * 6, plan)
  const moves = frames.slice(1).map((f, i) => length(sub(f.joints.head, frames[i].joints.head)))
  for (const at of Object.keys(plan).map(Number)) {
    const around = moves.slice(at - 12, at + 12).sort((a, b) => a - b)
    const median = around[Math.floor(around.length / 2)]
    assert.ok(moves[at - 1] <= 3 * Math.max(median, 1e-4), `switch at frame ${at}: ${moves[at - 1]} vs ${median}`)
  }
  assert.ok(frames.every(f => Object.values(f.joints).every(p => p.every(Number.isFinite))))
  assert.equal(frames[frames.length - 1].behaviour, 'idle')
})

test('celebrate spins about the rope and hands over to idle after its duration', () => {
  const frames = run(live(), 24 * 3, { 0: l => l.dispatch('success') })
  assert.ok(Math.max(...frames.map(f => Math.abs(f.twist))) > 2, 'a full turn twists the body')
  assert.equal(frames[24 * 3 - 1].behaviour, 'idle')
})

test('additive overlays stay within their amplitude', () => {
  const director = createDirector(spec, { reduced: false })
  director.play('busy', 0.3, 0)
  for (let t = 0; t < 10; t += 1 / FPS) assert.ok(Math.abs(director.update(t).bounce) <= 0.03 + 1e-12)
  director.play('idle', 0.5, 10)
  for (let t = 10; t < 20; t += 1 / FPS) {
    for (const b of director.update(t).breathe) assert.ok(Math.abs(b.offset) <= 0.006 + 1e-12)
  }
})

test('events in a behaviour fire once, and the fail behaviour hits the body', () => {
  const director = createDirector(spec, { reduced: false })
  director.dispatch('error', 1)
  const fired = Array.from({ length: 48 }, (_, i) => director.update(1 + i / FPS).events.length)
  assert.equal(fired.reduce((a, b) => a + b, 0), 1)
  const frames = run(live(), 24, { 0: l => l.dispatch('error') })
  assert.ok(Math.max(...frames.map(f => f.swing)) > 10)
})

test('reduced motion keeps peak swing and spin below half', () => {
  const peak = (reduced: boolean): { swing: number, twist: number } => {
    const frames = run(live({ reduced }), 24 * 4, { 0: l => l.hit(), 48: l => l.dispatch('success') })
    return { swing: Math.max(...frames.map(f => f.swing)), twist: Math.max(...frames.map(f => Math.abs(f.twist))) }
  }
  const normal = peak(false)
  const reduced = peak(true)
  assert.ok(reduced.swing < normal.swing / 2, `${reduced.swing} vs ${normal.swing}`)
  assert.ok(reduced.twist < normal.twist / 2, `${reduced.twist} vs ${normal.twist}`)
})

test('a dragged body swings from where it was let go', () => {
  const character = live()
  run(character, 10)
  const anchor = character.frame().anchor
  character.grab([anchor[0] + 0.4, anchor[1] - 0.57, anchor[2]])
  const held = run(character, 5)
  assert.ok(held[4].swing > 30, `held swing: ${held[4].swing}`)
  character.grab(undefined)
  const swinging = run(character, 24)
  assert.ok(swinging[0].swing > 25)
  assert.ok(Math.min(...swinging.map(f => f.swing)) < 15, 'it swings back through the bottom')
})

test('masks name the body, limbs, or a joint and everything below it', () => {
  const parents = parentsOf(unicorn.rig)
  assert.ok(maskJoints(['body'], unicorn.rig, parents).has('head'))
  assert.ok(!maskJoints(['body'], unicorn.rig, parents).has('maneA1'))
  assert.deepEqual([...maskJoints(['tailPink'], unicorn.rig, parents)].sort(), ['tailA1', 'tailA2', 'tailA3'])
  const below = maskJoints(['hipLF'], unicorn.rig, parents)
  assert.deepEqual([...below].sort(), ['ankleLF', 'hipLF', 'kneeLF', 'toeLF'])
})
