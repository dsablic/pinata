import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkRig, legBend, legPhases, legsOf, resolveRig, validateRig } from '../src/formats/rig.ts'
import type { Rig } from '../src/formats/rig.ts'
import { listTemplates } from '../src/formats/templates.ts'
import { validateMannequin } from '../src/formats/mannequin.ts'
import type { Vec3 } from '../src/math/vec.ts'

type Input = Record<string, any>

const GAIT = { strideLength: 1, referenceSpeed: 1, stepHeight: 0.1, bobAmplitude: 0.02, footSpacing: 0.2 }

function leg (side: string, tag: string, extra: Input = {}): Input {
  return { kind: 'leg', side, joints: [`hip${tag}`, `knee${tag}`, `ankle${tag}`, `toe${tag}`], ...extra }
}

function templated (template: string, legs: Input[], gait: Input = GAIT, extra: Input = {}): Input {
  return { template, limbs: legs, pelvis: 'pelvis', upperBody: ['chest'], gait, ...extra }
}

function expand (input: Input, joints: Record<string, Vec3> = {}): Rig {
  const result = validateRig(input)
  assert.deepEqual(result.errors, [])
  return resolveRig(result.value!, { joints })
}

const BIPED = (): Input[] => [leg('left', 'L'), leg('right', 'R')]
const QUAD = (): Input[] => [leg('left', 'LH'), leg('left', 'LF'), leg('right', 'RH'), leg('right', 'RF')]
const HEXAPOD_ZIGZAG = (): Input[] => [
  leg('left', 'L1'), leg('right', 'R1'), leg('left', 'L2'), leg('right', 'R2'), leg('left', 'L3'), leg('right', 'R3')
]

test('listTemplates names the four templates with their defaults', () => {
  const list = listTemplates()
  assert.deepEqual(list.map(t => t.name), ['biped', 'quadruped', 'hexapod', 'octopod'])
  assert.deepEqual(list.map(t => t.legCount), [2, 4, 6, 8])
  assert.deepEqual(list.map(t => t.armSwingDegrees > 0), [true, false, false, false])
  for (const t of list) {
    assert.ok(t.stanceFraction >= 0.5 && t.stanceFraction <= 0.8)
    assert.ok(t.description.length > 0)
    assert.deepEqual(Object.keys(t.gaitPerLegLength).sort(), [
      'bobAmplitude', 'footSpacing', 'referenceSpeed', 'stepHeight', 'strideLength'
    ])
  }
  list[0].bends.push('backward')
  assert.deepEqual(listTemplates()[0].bends, ['forward'])
})

test('a biped template gives alternating phases, forward bends, stance and arm swing', () => {
  const rig = expand(templated('biped', BIPED()))
  assert.deepEqual(legPhases(rig), [0, 0.5])
  assert.deepEqual(legsOf(rig).map(legBend), ['forward', 'forward'])
  assert.equal(rig.gait.stanceFraction, 0.6)
  assert.equal(rig.gait.armSwingDegrees, 20)
  assert.equal(rig.template, 'biped')
})

test('a quadruped template walks LH 0, LF 0.25, RH 0.5, RF 0.75 with hind legs bending backward', () => {
  const rig = expand(templated('quadruped', QUAD()))
  assert.deepEqual(legPhases(rig), [0, 0.25, 0.5, 0.75])
  assert.deepEqual(legsOf(rig).map(legBend), ['backward', 'forward', 'backward', 'forward'])
  assert.equal(rig.gait.stanceFraction, 0.75)
  assert.equal(rig.gait.armSwingDegrees, 0)
})

test('a hexapod template alternates tripods whatever the order of the two sides in the file', () => {
  const rig = expand(templated('hexapod', HEXAPOD_ZIGZAG()))
  assert.deepEqual(legPhases(rig), [0, 0.5, 0.5, 0, 0, 0.5])
  const sorted = expand(templated('hexapod', [
    leg('left', 'L1'), leg('left', 'L2'), leg('left', 'L3'), leg('right', 'R1'), leg('right', 'R2'), leg('right', 'R3')
  ]))
  assert.deepEqual(legPhases(sorted), [0, 0.5, 0, 0.5, 0, 0.5])
})

test('an octopod template alternates two tetrapods', () => {
  const legs = ['L1', 'L2', 'L3', 'L4', 'R1', 'R2', 'R3', 'R4'].map(t => leg(t[0] === 'L' ? 'left' : 'right', t))
  assert.deepEqual(legPhases(expand(templated('octopod', legs))), [0, 0.5, 0, 0.5, 0.5, 0, 0.5, 0])
})

test('explicit phase, bend, stance and arm swing win over the template', () => {
  const legs = QUAD()
  legs[1].phase = 0.3
  legs[2].bend = 'forward'
  legs[3].bend = ['backward']
  const rig = expand(templated('quadruped', legs, { ...GAIT, stanceFraction: 0.7, armSwingDegrees: 5 }))
  assert.deepEqual(legPhases(rig), [0, 0.3, 0.5, 0.75])
  assert.deepEqual(legsOf(rig).map(l => l.limb.bend), ['backward', 'forward', 'forward', ['backward']])
  assert.equal(rig.gait.stanceFraction, 0.7)
  assert.equal(rig.gait.armSwingDegrees, 5)
})

test('a template fills legs translated from the legs and arms format', () => {
  const rig = expand({
    template: 'quadruped',
    legs: ['left', 'left', 'right', 'right'].map((side, i) => {
      const [hip, knee, ankle, toe] = ['h', 'k', 'a', 't'].map(n => `${n}${i}`)
      return { side, hip, knee, ankle, toe }
    }),
    arms: [],
    pelvis: 'pelvis',
    upperBody: [],
    gait: GAIT
  })
  assert.deepEqual(legPhases(rig), [0, 0.25, 0.5, 0.75])
})

test('templates are not limits: any number of legs gets phases', () => {
  const three = expand(templated('biped', [leg('left', 'A'), leg('left', 'B'), leg('right', 'C')]))
  assert.deepEqual(legPhases(three), [0, 0.5, 0.5])
  const pairs = ['A', 'B', 'C'].flatMap(t => [leg('left', `L${t}`), leg('right', `R${t}`)])
  const six = expand(templated('quadruped', pairs))
  assert.deepEqual(legPhases(six), [0, 0.5, 0.25, 0.75, 0.5, 0])
})

test('stanceFraction and armSwingDegrees are required without a template and optional with one', () => {
  const none = templated('biped', BIPED())
  delete none.template
  assert.deepEqual(validateRig(none).errors.map(e => e.path), ['gait.stanceFraction', 'gait.armSwingDegrees'])
  const withTemplate = validateRig(templated('biped', BIPED()))
  assert.deepEqual(withTemplate.errors, [])
  const range = validateRig(templated('biped', BIPED(), { ...GAIT, stanceFraction: 0.2 }))
  assert.deepEqual(range.errors.map(e => e.path), ['gait.stanceFraction'])
  const strideLess = { ...GAIT } as Input
  delete strideLess.strideLength
  assert.deepEqual(validateRig(templated('biped', BIPED(), strideLess)).errors.map(e => e.path), ['gait.strideLength'])
})

test('legs need no phase when a template is named, however many there are', () => {
  assert.deepEqual(validateRig(templated('quadruped', QUAD())).errors, [])
  const plain = templated('quadruped', QUAD())
  delete plain.template
  assert.deepEqual(validateRig(plain).errors.map(e => e.path), [
    'limbs[0].phase', 'limbs[1].phase', 'limbs[2].phase', 'limbs[3].phase', 'gait.stanceFraction',
    'gait.armSwingDegrees'
  ])
})

test('an unknown template lists the known ones', () => {
  const result = validateRig(templated('centipede', BIPED()))
  assert.deepEqual(result.errors.map(e => e.path), ['template'])
  assert.match(result.errors[0].message, /expected one of biped, quadruped, hexapod, octopod/)
  assert.deepEqual(validateRig(templated(3 as never, BIPED())).errors.map(e => e.path), ['template'])
})

test('the input is not modified by expansion', () => {
  const input = templated('quadruped', QUAD())
  const before = structuredClone(input)
  expand(input)
  assert.deepEqual(input, before)
})

test('expanded templates pass checkRig stance and side rules', () => {
  const tags = (list: Input[]): string[] => list.flatMap(l => l.joints)
  for (const [name, legs] of [['biped', BIPED()], ['quadruped', QUAD()], ['hexapod', HEXAPOD_ZIGZAG()]] as const) {
    const names = ['pelvis', 'chest', ...tags(legs)]
    const joints = Object.fromEntries(names.map((n, i) => [n, [i, 0, 0]]))
    const parts = [{ name: 'p', shape: 'capsule', a: 'pelvis', b: 'chest', radiusA: 0.1, radiusB: 0.1, material: 'm' }]
    const mannequin = validateMannequin({ name: 'm', height: 2, joints, parts }).value!
    assert.deepEqual(checkRig(expand(templated(name, legs)), mannequin), [], name)
  }
})

type Spot = { tag: string, side: string, z: number }

function spots (zs: number[]): Spot[] {
  return ['left', 'right'].flatMap(side => zs.map((z, i) => ({ tag: `${side[0].toUpperCase()}${i}`, side, z })))
}

function orders (all: Spot[]): Array<[string, Spot[]]> {
  const side = (name: string): Spot[] => all.filter(spot => spot.side === name)
  const [left, right] = [side('left'), side('right')]
  return [
    ['hind first', [...left, ...right]],
    ['front first', [...left].reverse().concat([...right].reverse())],
    ['mixed', [...left, ...[...right].reverse()]],
    ['interleaved', left.flatMap((spot, i) => [[...right].reverse()[i], spot]).reverse()]
  ]
}

function resolved (template: string, order: Spot[], all: Spot[]): Map<string, [number | undefined, string]> {
  const joints: Record<string, Vec3> = {}
  for (const { tag, z } of all) {
    joints[`hip${tag}`] = [0.1, 1, z]
    joints[`knee${tag}`] = [0.1, 0.5, z]
    joints[`ankle${tag}`] = [0.1, 0.1, z]
    joints[`toe${tag}`] = [0.1, 0, z]
  }
  const rig = expand(templated(template, order.map(spot => leg(spot.side, spot.tag))), joints)
  return new Map(legsOf(rig).map(l => [l.joints[0].slice(3), [l.phase, legBend(l)]]))
}

const EXPECTED: Record<string, { zs: number[], phases: Record<string, number>, bends?: Record<string, string> }> = {
  quadruped: {
    zs: [-0.3, 0.3],
    phases: { L0: 0, L1: 0.25, R0: 0.5, R1: 0.75 },
    bends: { L0: 'backward', L1: 'forward', R0: 'backward', R1: 'forward' }
  },
  hexapod: { zs: [-0.3, 0, 0.3], phases: { L0: 0, L1: 0.5, L2: 0, R0: 0.5, R1: 0, R2: 0.5 } },
  octopod: {
    zs: [-0.3, -0.1, 0.1, 0.3],
    phases: { L0: 0, L1: 0.5, L2: 0, L3: 0.5, R0: 0.5, R1: 0, R2: 0.5, R3: 0 }
  }
}

test('template phases and bends follow the rest hip positions, not the order of legs in the file', () => {
  for (const [template, { zs, phases, bends }] of Object.entries(EXPECTED)) {
    const all = spots(zs)
    for (const [name, order] of orders(all)) {
      const found = resolved(template, order, all)
      for (const { tag } of all) {
        assert.equal(found.get(tag)![0], phases[tag], `${template} ${name} ${tag} phase`)
        assert.equal(found.get(tag)![1], bends?.[tag] ?? 'forward', `${template} ${name} ${tag} bend`)
      }
    }
  }
})

test('without rest hip positions a template falls back to the file order', () => {
  const rig = expand(templated('quadruped', QUAD()))
  assert.deepEqual(legPhases(rig), [0, 0.25, 0.5, 0.75])
})

test('resolveRig leaves a rig without a template as it is', () => {
  const plain = validateRig(templated('quadruped', QUAD().map((l, i) => ({ ...l, phase: i / 4 })), {
    ...GAIT, stanceFraction: 0.75, armSwingDegrees: 0
  })).value!
  delete plain.template
  assert.deepEqual(resolveRig(plain, { joints: {} }), plain)
})

test('lateral is rest for hexapod and octopod templates, spacing otherwise, and an explicit value wins', () => {
  const legsFor = (zs: string[]): Input[] => zs.flatMap(t => [leg('left', `L${t}`), leg('right', `R${t}`)])
  assert.equal(expand(templated('hexapod', legsFor(['1', '2', '3']))).gait.lateral, 'rest')
  assert.equal(expand(templated('octopod', legsFor(['1', '2', '3', '4']))).gait.lateral, 'rest')
  assert.equal(expand(templated('quadruped', QUAD())).gait.lateral, 'spacing')
  assert.equal(expand(templated('biped', BIPED())).gait.lateral, 'spacing')
  const spaced = templated('hexapod', legsFor(['1', '2', '3']), { ...GAIT, lateral: 'spacing' })
  assert.equal(expand(spaced).gait.lateral, 'spacing')
})

test('gait lateral is optional and must be rest or spacing', () => {
  const plain = templated('biped', BIPED(), { ...GAIT, stanceFraction: 0.6, armSwingDegrees: 10, lateral: 'rest' })
  delete plain.template
  assert.deepEqual(validateRig(plain).errors, [])
  const bad = templated('biped', BIPED(), { ...GAIT, lateral: 'wide' })
  const errors = validateRig(bad).errors
  assert.deepEqual(errors.map(e => e.path), ['gait.lateral'])
  assert.match(errors[0].message, /expected 'rest' or 'spacing'/)
})
