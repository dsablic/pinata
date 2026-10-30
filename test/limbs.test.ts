import { test } from 'node:test'
import assert from 'node:assert/strict'
import { armsOf, checkRig, legsOf, validateRig } from '../src/formats/rig.ts'
import { validateMannequin } from '../src/formats/mannequin.ts'

type Input = Record<string, any>

const GAIT = {
  strideLength: 1.4, referenceSpeed: 1.2, stanceFraction: 0.6, stepHeight: 0.1, bobAmplitude: 0.03,
  armSwingDegrees: 25, footSpacing: 0.2
}

function leg (side: string, tag: string, count = 4, extra: Input = {}): Input {
  const names = ['hip', 'knee', 'hock', 'fetlock', 'pastern', 'toe']
  const joints = [...names.slice(0, count - 1), 'toe'].map(n => `${n}${tag}`)
  return { name: `leg${tag}`, kind: 'leg', joints, side, ...extra }
}

function limbsRig (limbs: Input[], extra: Input = {}): Input {
  return { limbs, pelvis: 'pelvis', upperBody: ['chest'], gait: { ...GAIT }, ...extra }
}

function errorsOf (input: unknown): Array<[string, string]> {
  return validateRig(input).errors.map(e => [e.path, e.message])
}

function pathsOf (input: unknown): string[] {
  return validateRig(input).errors.map(e => e.path)
}

const twoLegs = (): Input[] => [leg('left', 'L', 4, { phase: 0 }), leg('right', 'R', 4, { phase: 0.5 })]

test('a rig with limbs validates and keeps joints, names and kinds', () => {
  const input = limbsRig([
    ...twoLegs(),
    { name: 'armL', kind: 'arm', joints: ['shL', 'elL', 'wrL', 'haL'], side: 'left', carried: ['sword'] },
    { name: 'tail', kind: 'appendage', joints: ['t1', 't2', 't3'], stiffness: 0.5, damping: 0.3 }
  ])
  const result = validateRig(input)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.value!.limbs.map(l => [l.kind, l.name, l.joints.length]), [
    ['leg', 'legL', 4], ['leg', 'legR', 4], ['arm', 'armL', 4], ['appendage', 'tail', 3]
  ])
  result.value!.limbs[0].joints.push('x')
  assert.equal(input.limbs[0].joints.length, 4)
})

test('legs may have four joints or more and arms and appendages two or more', () => {
  const input = limbsRig([
    leg('left', 'L', 4, { phase: 0 }), leg('right', 'R', 6, { phase: 0.5 }),
    { kind: 'arm', joints: ['a', 'b'], side: 'left' },
    { kind: 'appendage', joints: ['c', 'd'] }
  ])
  assert.deepEqual(errorsOf(input), [])
})

test('joint counts below the minimum name the kind and the count found', () => {
  const input = limbsRig([
    leg('left', 'L', 2), leg('right', 'R', 3, { phase: 0.5 }),
    { kind: 'arm', joints: ['a'], side: 'left' },
    { kind: 'appendage', joints: [] },
    { kind: 'appendage', joints: 'tail' }
  ])
  const errors = errorsOf(input)
  assert.deepEqual(errors.map(e => e[0]), [0, 1, 2, 3, 4].map(i => `limbs[${i}].joints`))
  assert.match(errors[0][1], /4 or more joint names from the hip to the toe; found 2/)
  assert.match(errors[1][1], /found 3: a leg needs a hip, at least one bending joint, an ankle and a toe/)
  assert.match(errors[2][1], /2 or more joint names from the shoulder outward; found 1/)
  assert.match(errors[4][1], /from the root outward$/)
})

test('joint names must be non-empty strings', () => {
  const input = limbsRig([{ kind: 'arm', joints: ['a', 3, ''], side: 'left' }, ...twoLegs()])
  assert.deepEqual(pathsOf(input), ['limbs[0].joints[1]', 'limbs[0].joints[2]'])
})

test('kind is required and one of leg, arm or appendage', () => {
  assert.deepEqual(pathsOf(limbsRig([{ joints: ['a', 'b'] }, { kind: 'wing', joints: ['a', 'b'] }])), [
    'limbs[0].kind', 'limbs[1].kind'
  ])
  assert.deepEqual(pathsOf(limbsRig('legs' as never)), ['limbs'])
  assert.deepEqual(pathsOf(limbsRig([7 as never])), ['limbs[0]'])
})

test('unknown keys are rejected per kind', () => {
  const input = limbsRig([
    leg('left', 'L', 4, { phase: 0, stiffness: 0.5, extra: 1 }),
    { kind: 'arm', joints: ['a', 'b'], side: 'left', bend: 'forward' },
    { kind: 'appendage', joints: ['c', 'd'], phase: 0.5 }
  ])
  assert.deepEqual(pathsOf(input), ['limbs[0].stiffness', 'limbs[0].extra', 'limbs[1].bend', 'limbs[2].phase'])
  assert.match(errorsOf(input)[0][1], /unknown field 'stiffness'; known fields: name, kind, joints, side, phase/)
})

test('legs and arms need a side, appendages may have one', () => {
  const input = limbsRig([
    { kind: 'leg', joints: ['a', 'b', 'c', 'x'], side: 'middle', phase: 0 },
    { kind: 'arm', joints: ['a', 'b'] },
    { kind: 'appendage', joints: ['a', 'b'], side: 'up' },
    { kind: 'appendage', joints: ['c', 'd'], side: 'left' },
    { kind: 'appendage', joints: ['e', 'f'] }
  ])
  assert.deepEqual(pathsOf(input), ['limbs[0].side', 'limbs[1].side', 'limbs[2].side'])
})

test('names must be unique non-empty strings and default to the kind and its count', () => {
  const dup = limbsRig([leg('left', 'L', 4, { phase: 0, name: 'x' }), leg('right', 'R', 4, { phase: 0.5, name: 'x' })])
  assert.deepEqual(pathsOf(dup), ['limbs[1].name'])
  assert.match(errorsOf(dup)[0][1], /name 'x' is already used by limbs\[0\]/)
  assert.deepEqual(pathsOf(limbsRig([{ kind: 'arm', joints: ['a', 'b'], side: 'left', name: '' }])), ['limbs[0].name'])
  const unnamed = limbsRig([
    { kind: 'leg', joints: ['a', 'b', 'c', 'x'], side: 'left', phase: 0 },
    { kind: 'leg', joints: ['d', 'e', 'f', 'y'], side: 'right', phase: 0.5 },
    { kind: 'appendage', joints: ['g', 'h'] }
  ])
  assert.deepEqual(validateRig(unnamed).value!.limbs.map(l => l.name), ['leg1', 'leg2', 'appendage1'])
})

test('phase must be from 0 up to 1 and is required with more than two legs and no template', () => {
  const bad = limbsRig([leg('left', 'L', 4, { phase: 1 }), leg('right', 'R', 4, { phase: -0.1 })])
  assert.deepEqual(pathsOf(bad), ['limbs[0].phase', 'limbs[1].phase'])
  const three = limbsRig([leg('left', 'A', 4, { phase: 0 }), leg('left', 'B'), leg('right', 'C', 4, { phase: 0.5 })])
  assert.deepEqual(pathsOf(three), ['limbs[1].phase'])
  assert.match(errorsOf(three)[0][1], /3 legs need a phase each/)
  assert.deepEqual(pathsOf(limbsRig([leg('left', 'L'), leg('right', 'R')])), [])
})

test('bend is one value or one value per bending joint, those strictly between the hip and the ankle', () => {
  const two = ['forward', 'backward']
  const ok = limbsRig([leg('left', 'L', 5, { bend: 'backward' }), leg('right', 'R', 5, { bend: two })])
  assert.deepEqual(errorsOf(ok), [])
  const bends = validateRig(ok).value!.limbs.map(l => l.kind === 'leg' && l.bend)
  assert.deepEqual(bends, ['backward', two])
  const bad = limbsRig([
    leg('left', 'L', 5, { bend: ['forward', 'backward', 'forward'], phase: 0.1 }),
    leg('right', 'R', 5, { bend: 'sideways', phase: 0.6 }),
    leg('left', 'S', 4, { bend: ['forward', 'sideways'], phase: 0 }),
    leg('right', 'T', 4, { bend: 3, phase: 0.5 })
  ])
  assert.deepEqual(pathsOf(bad), ['limbs[0].bend', 'limbs[1].bend', 'limbs[2].bend', 'limbs[3].bend'])
  assert.match(errorsOf(bad)[0][1], /expected 2 values of 'forward', 'backward' or 'up'.*found 3/)
  assert.equal(validateRig(limbsRig([leg('left', 'S', 4, { bend: ['forward'], phase: 0 })])).errors.length, 0)
})

test('bend up is valid on its own or for every joint, and cannot be mixed with forward or backward', () => {
  const ok = limbsRig([leg('left', 'L', 5, { bend: 'up' }), leg('right', 'R', 5, { bend: ['up', 'up'] })])
  assert.deepEqual(errorsOf(ok), [])
  const mixed = limbsRig([leg('left', 'L', 5, { bend: ['up', 'forward'] }), leg('right', 'R', 5)])
  assert.deepEqual(pathsOf(mixed), ['limbs[0].bend'])
  assert.match(errorsOf(mixed)[0][1], /'up' cannot be mixed/)
})

test('limits need a min below a max within 180 degrees', () => {
  const ok = limbsRig([leg('left', 'L', 4, { limits: { min: 0, max: 150 } }), leg('right', 'R')])
  assert.deepEqual(errorsOf(ok), [])
  const bad = limbsRig([
    leg('left', 'A', 4, { limits: { min: 150, max: 10 } }),
    leg('right', 'B', 4, { limits: { min: 'low', max: 200, step: 1 } }),
    leg('left', 'C', 4, { limits: 5 })
  ].map((l, i) => ({ ...l, phase: i * 0.25 })))
  assert.deepEqual(pathsOf(bad), [
    'limbs[0].limits', 'limbs[1].limits.step', 'limbs[1].limits.min', 'limbs[1].limits.max', 'limbs[2].limits'
  ])
})

test('appendage stiffness and damping are from 0 to 1 and default when omitted', () => {
  const ok = limbsRig([...twoLegs(), { kind: 'appendage', joints: ['a', 'b'] }])
  const appendage = validateRig(ok).value!.limbs[2]
  assert.deepEqual(appendage.kind === 'appendage' && [appendage.stiffness, appendage.damping], [0.6, 0.4])
  const bad = limbsRig([
    ...twoLegs(),
    { kind: 'appendage', joints: ['a', 'b'], stiffness: 1.5, damping: -0.1 },
    { kind: 'appendage', joints: ['c', 'd'], stiffness: 'stiff', damping: Number.NaN }
  ])
  assert.deepEqual(pathsOf(bad), [
    'limbs[2].stiffness', 'limbs[2].damping', 'limbs[3].stiffness', 'limbs[3].damping'
  ])
})

test('oscillate needs a non-zero axis, degrees and a period when it swings, and its phase defaults to 0', () => {
  const oscillate = { axis: [1, 0, 0], degrees: 20, period: 0.8 }
  const ok = limbsRig([...twoLegs(), { kind: 'appendage', joints: ['a', 'b'], oscillate }])
  const appendage = validateRig(ok).value!.limbs[2]
  assert.deepEqual(appendage.kind === 'appendage' && appendage.oscillate, {
    axis: [1, 0, 0], degrees: 20, period: 0.8, phase: 0
  })
  assert.equal((oscillate as Input).phase, undefined)
  const bad = limbsRig([
    ...twoLegs(),
    { kind: 'appendage', joints: ['a', 'b'], oscillate: { axis: [0, 0, 0], degrees: 200, phase: 1, rate: 2 } },
    { kind: 'appendage', joints: ['c', 'd'], oscillate: { axis: [1, 0], degrees: -1 } },
    { kind: 'appendage', joints: ['e', 'f'], oscillate: 'wag' },
    { kind: 'appendage', joints: ['g', 'h'], oscillate: { axis: [1, 0, 0], degrees: 10, period: 0 } },
    { kind: 'appendage', joints: ['i', 'j'], oscillate: { axis: [1, 0, 0], degrees: 0 } }
  ])
  assert.deepEqual(pathsOf(bad), [
    'limbs[2].oscillate.rate', 'limbs[2].oscillate.axis', 'limbs[2].oscillate.degrees', 'limbs[2].oscillate.period',
    'limbs[2].oscillate.phase', 'limbs[3].oscillate.axis', 'limbs[3].oscillate.degrees', 'limbs[4].oscillate',
    'limbs[5].oscillate.period'
  ])
  assert.match(errorsOf(bad).find(([path]) => path === 'limbs[2].oscillate.period')![1], /degrees above 0/)
})

test('arm carried joints are validated', () => {
  const bad = limbsRig([...twoLegs(), { kind: 'arm', joints: ['a', 'b'], side: 'left', carried: 'sword' }])
  assert.deepEqual(pathsOf(bad), ['limbs[2].carried'])
})

test('limbs cannot be mixed with legs or arms', () => {
  const mixed = limbsRig(twoLegs(), { legs: [], arms: [] })
  const errors = errorsOf(mixed)
  assert.deepEqual(errors.map(e => e[0]), ['limbs'])
  assert.match(errors[0][1], /'limbs' cannot be combined with 'legs' or 'arms'/)
  assert.deepEqual(pathsOf(limbsRig(twoLegs(), { arms: [] })), ['limbs'])
})

function legacy (): Input {
  return {
    legs: [
      { side: 'left', hip: 'hipL', knee: 'kneeL', ankle: 'ankleL', toe: 'toeL', phase: 0.1, bend: 'backward' },
      { side: 'right', hip: 'hipR', knee: 'kneeR', ankle: 'ankleR', toe: 'toeR' }
    ],
    arms: [{ side: 'left', shoulder: 'shL', elbow: 'elL', wrist: 'wrL', hand: 'haL', carried: ['sword'] }],
    pelvis: 'pelvis',
    upperBody: ['chest'],
    gait: { ...GAIT }
  }
}

test('legs and arms translate to limbs with four joints each', () => {
  const rig = validateRig(legacy()).value!
  assert.deepEqual(rig.limbs, [
    {
      kind: 'leg', name: 'leg1', joints: ['hipL', 'kneeL', 'ankleL', 'toeL'], side: 'left', phase: 0.1, bend: 'backward'
    },
    { kind: 'leg', name: 'leg2', joints: ['hipR', 'kneeR', 'ankleR', 'toeR'], side: 'right' },
    { kind: 'arm', name: 'arm1', joints: ['shL', 'elL', 'wrL', 'haL'], side: 'left', carried: ['sword'] }
  ])
  assert.equal('legs' in rig, false)
  assert.equal('arms' in rig, false)
})

test('legsOf and armsOf name the hip, knee, ankle and toe and the shoulder to the hand', () => {
  const rig = validateRig(legacy()).value!
  const [left, right] = legsOf(rig)
  assert.deepEqual([left.hip, left.knee, left.ankle, left.toe, left.side, left.phase, left.bend, left.index],
    ['hipL', 'kneeL', 'ankleL', 'toeL', 'left', 0.1, 'backward', 0])
  assert.equal(right.bend, undefined)
  const [arm] = armsOf(rig)
  assert.deepEqual([arm.shoulder, arm.joints, arm.carried, arm.index],
    ['shL', ['shL', 'elL', 'wrL', 'haL'], ['sword'], 2])
})

test('armsOf lists arms of any joint count', () => {
  const rig = validateRig(limbsRig([
    ...twoLegs(),
    { kind: 'arm', joints: ['a1', 'a2'], side: 'left' },
    { kind: 'arm', joints: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'], side: 'right' }
  ])).value!
  assert.deepEqual(armsOf(rig).map(arm => [arm.shoulder, arm.joints.length]), [['a1', 2], ['b1', 6]])
})

test('legsOf exposes the chain from the hip to the ankle, the bends and the limits', () => {
  const rig = validateRig(limbsRig([
    leg('left', 'L', 6, {
      phase: 0, bend: ['forward', 'backward', 'forward'], limits: { min: 0, max: 90 }
    }),
    leg('right', 'R', 5, { phase: 0.5, bend: 'backward' })
  ])).value!
  const [first, second] = legsOf(rig)
  assert.deepEqual(first.chain, ['hipL', 'kneeL', 'hockL', 'fetlockL', 'pasternL'])
  assert.deepEqual(first.bends, ['forward', 'backward', 'forward'])
  assert.deepEqual(first.limits, { min: 0, max: 90 })
  assert.deepEqual(second.bends, ['backward', 'backward'])
  assert.equal(second.limits, undefined)
})

test('legsOf bends default to forward for every intermediate joint', () => {
  const rig = validateRig(limbsRig([leg('left', 'L', 5, { phase: 0 }), leg('right', 'R', 5, { phase: 0.5 })])).value!
  assert.deepEqual(legsOf(rig)[0].bends, ['forward', 'forward'])
})

test('legsOf takes the foot from the last two joints of a longer leg', () => {
  const rig = validateRig(limbsRig([leg('left', 'L', 5, { phase: 0 }), leg('right', 'R', 5, { phase: 0.5 })])).value!
  const [first] = legsOf(rig)
  assert.deepEqual([first.hip, first.knee, first.ankle, first.toe], ['hipL', 'kneeL', 'fetlockL', 'toeL'])
})

function mannequinOf (names: string[]) {
  const joints = Object.fromEntries(names.map((n, i) => [n, [i, 0, 0]]))
  const parts = [{ name: 'p', shape: 'capsule', a: 'pelvis', b: 'chest', radiusA: 0.1, radiusB: 0.1, material: 'm' }]
  const result = validateMannequin({ name: 'm', height: 2, joints, parts })
  assert.deepEqual(result.errors, [])
  return result.value!
}

const FIVE_JOINTS = (tag: string): string[] => ['hip', 'knee', 'hock', 'fetlock', 'toe'].map(n => `${n}${tag}`)

test('checkRig counts every joint of every limb, carried joints and appendages included', () => {
  const names = [
    'pelvis', 'chest', ...FIVE_JOINTS('L'), ...FIVE_JOINTS('R'), 'sh', 'el', 'sword', 't1', 't2', 't3'
  ]
  const input = limbsRig([
    { kind: 'leg', joints: FIVE_JOINTS('L'), side: 'left' },
    { kind: 'leg', joints: FIVE_JOINTS('R'), side: 'right' },
    { kind: 'arm', joints: ['sh', 'el'], side: 'left', carried: ['sword'] },
    { kind: 'appendage', joints: ['t1', 't2', 't3'] }
  ])
  const rig = validateRig(input).value!
  assert.deepEqual(checkRig(rig, mannequinOf(names)), [])
  const missing = checkRig(rig, mannequinOf([...names, 'extra', 'fetlockX']))
  assert.deepEqual(missing.map(e => e.path), ['upperBody'])
  assert.match(missing[0].message, /'extra', 'fetlockX'/)
})

test('checkRig reports unknown, reused and zero-length limb joints with limb paths', () => {
  const names = ['pelvis', 'chest', ...FIVE_JOINTS('L'), ...FIVE_JOINTS('R'), 't1', 't2']
  const input = limbsRig([
    { kind: 'leg', joints: [...FIVE_JOINTS('L').slice(0, 4), 'ghost'], side: 'left' },
    { kind: 'leg', joints: FIVE_JOINTS('R'), side: 'right' },
    { kind: 'appendage', joints: ['t1', 'kneeR'] }
  ])
  const errors = checkRig(validateRig(input).value!, mannequinOf(names))
  assert.deepEqual(errors.slice(0, 2).map(e => e.path), ['limbs[0].joints[4]', 'limbs[2].joints[1]'])
  assert.match(errors[0].message, /unknown joint 'ghost'/)
  assert.match(errors[1].message, /already used by limbs\[1\]\.joints\[1\]/)
  const flat = mannequinOf(names)
  flat.joints.hockL = [...flat.joints.kneeL]
  const zero = checkRig(validateRig(limbsRig(twoLegsOf5())).value!, flat)
  assert.match(zero[0].message, /'kneeL' and 'hockL' of 'legL' are at the same position/)
})

function twoLegsOf5 (): Input[] {
  return [
    { name: 'legL', kind: 'leg', joints: FIVE_JOINTS('L'), side: 'left' },
    { name: 'legR', kind: 'leg', joints: FIVE_JOINTS('R'), side: 'right' }
  ]
}

test('checkRig needs a leg and as many left legs as right legs', () => {
  const names = ['pelvis', 'chest', 'sh', 'el']
  const noLegs = limbsRig([{ kind: 'arm', joints: ['sh', 'el'], side: 'left' }])
  const errors = checkRig(validateRig(noLegs).value!, mannequinOf(names))
  assert.deepEqual(errors.map(e => e.path), ['limbs'])
  assert.match(errors[0].message, /at least one limb of kind 'leg'/)
  const lopsided = limbsRig(twoLegsOf5().map(l => ({ ...l, side: 'left' })))
  const all = ['pelvis', 'chest', ...FIVE_JOINTS('L'), ...FIVE_JOINTS('R')]
  const sides = checkRig(validateRig(lopsided).value!, mannequinOf(all))
  assert.deepEqual(sides.map(e => e.path), ['limbs'])
  assert.match(sides[0].message, /one left and one right leg; found 2 left and 0 right/)
})
