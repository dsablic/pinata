import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkRig, stride, validateRig } from '../src/formats/rig.ts'
import { validateMannequin } from '../src/formats/mannequin.ts'
import { assertClose } from './helpers.ts'

function rig () {
  return {
    legs: [
      { side: 'left', hip: 'hipL', knee: 'kneeL', ankle: 'ankleL', toe: 'toeL' },
      { side: 'right', hip: 'hipR', knee: 'kneeR', ankle: 'ankleR', toe: 'toeR' }
    ],
    arms: [{ side: 'left', shoulder: 'shL', elbow: 'elL', wrist: 'wrL', hand: 'haL' }],
    pelvis: 'pelvis',
    upperBody: ['chest'],
    gait: {
      strideLength: 1.4,
      referenceSpeed: 1.2,
      stanceFraction: 0.6,
      stepHeight: 0.1,
      bobAmplitude: 0.03,
      armSwingDegrees: 25,
      footSpacing: 0.2
    }
  }
}

function mannequin () {
  const names = [
    'hipL', 'kneeL', 'ankleL', 'toeL', 'hipR', 'kneeR', 'ankleR', 'toeR', 'shL', 'elL', 'wrL', 'haL', 'pelvis', 'chest'
  ]
  const joints = Object.fromEntries(names.map((n, i) => [n, [i, 0, 0]]))
  const parts = [{ name: 'p', shape: 'capsule', a: 'pelvis', b: 'chest', radiusA: 0.1, radiusB: 0.1, material: 'm' }]
  const result = validateMannequin({ name: 'm', height: 2, joints, parts })
  assert.deepEqual(result.errors, [])
  return result.value!
}

function paths (input: unknown): string[] {
  return validateRig(input).errors.map(e => e.path)
}

test('accepts a valid rig and copies it', () => {
  const input = rig()
  const result = validateRig(input)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.value, input)
  result.value!.upperBody.push('x')
  assert.deepEqual(input.upperBody, ['chest'])
})

test('rejects unknown fields and wrong types with paths', () => {
  const input: Record<string, any> = rig()
  input.extra = 1
  input.pelvis = ''
  input.legs[0].side = 'middle'
  input.legs[1].toe = 3
  input.arms[0].hand = undefined
  input.upperBody = 'chest'
  assert.deepEqual(paths(input).sort(), [
    'arms[0].hand', 'extra', 'legs[0].side', 'legs[1].toe', 'pelvis', 'upperBody'
  ])
})

test('rejects non-object input and missing gait', () => {
  assert.deepEqual(paths(null), [''])
  const input: Record<string, any> = rig()
  delete input.gait
  assert.deepEqual(paths(input), ['gait'])
})

test('range-checks gait values', () => {
  const input = rig()
  input.gait.strideLength = 0
  input.gait.referenceSpeed = -1
  input.gait.stanceFraction = 0.4
  input.gait.stepHeight = -0.1
  input.gait.bobAmplitude = Number.NaN
  input.gait.armSwingDegrees = 120
  input.gait.footSpacing = -1
  assert.deepEqual(paths(input).sort(), [
    'gait.armSwingDegrees', 'gait.bobAmplitude', 'gait.footSpacing', 'gait.referenceSpeed',
    'gait.stanceFraction', 'gait.stepHeight', 'gait.strideLength'
  ])
  const high = rig()
  high.gait.stanceFraction = 0.81
  assert.deepEqual(paths(high), ['gait.stanceFraction'])
})

test('checkRig accepts a complete rig', () => {
  assert.deepEqual(checkRig(validateRig(rig()).value!, mannequin()), [])
})

test('checkRig reports unknown joints with known names', () => {
  const input = rig()
  input.legs[0].knee = 'kneeX'
  const [error] = checkRig(validateRig(input).value!, mannequin())
  assert.equal(error.path, 'legs[0].knee')
  assert.match(error.message, /unknown joint 'kneeX'; known joints: hipL, /)
})

test('checkRig reports joints used twice', () => {
  const input = rig()
  input.upperBody.push('hipL')
  const errors = checkRig(validateRig(input).value!, mannequin())
  assert.deepEqual(errors.map(e => e.path), ['upperBody[1]'])
  assert.match(errors[0].message, /already used by legs\[0\]\.hip/)
})

test('checkRig reports mannequin joints no group moves', () => {
  const input = rig()
  input.upperBody = []
  const errors = checkRig(validateRig(input).value!, mannequin())
  assert.deepEqual(errors.map(e => e.path), ['upperBody'])
  assert.match(errors[0].message, /'chest'/)
})

test('checkRig needs one left and one right leg', () => {
  const input = rig()
  input.legs[1].side = 'left'
  const errors = checkRig(validateRig(input).value!, mannequin())
  assert.deepEqual(errors.map(e => e.path), ['legs'])
  const one = rig()
  one.legs.pop()
  assert.deepEqual(paths(one), ['legs'])
})

test('stride grows with the square root of speed and is clamped', () => {
  const { gait } = validateRig(rig()).value!
  assertClose(stride(gait, 1.2), 1.4)
  assertClose(stride(gait, 1.2 * 1.21), 1.4 * 1.1)
  assertClose(stride(gait, 100), 1.4 * 1.5)
  assertClose(stride(gait, 0.01), 1.4 * 0.5)
})

test('strideExponent changes how stride grows with speed and defaults to one half', () => {
  const { gait } = validateRig(rig()).value!
  assertClose(stride({ ...gait, strideExponent: 1 }, 1.2 * 1.2), 1.4 * 1.2)
  assertClose(stride({ ...gait, strideExponent: 0.5 }, 1.2 * 1.21), stride(gait, 1.2 * 1.21))
  assertClose(stride({ ...gait, strideExponent: 1 }, 100), 1.4 * 1.5)
})

test('strideExponent is optional and must be within 0.2 to 1', () => {
  const ok = rig()
  Object.assign(ok.gait, { strideExponent: 0.75 })
  assert.deepEqual(paths(ok), [])
  assert.equal(validateRig(ok).value!.gait.strideExponent, 0.75)
  for (const bad of [0.1, 1.1, Number.NaN, '1']) {
    const input = rig()
    Object.assign(input.gait, { strideExponent: bad })
    assert.deepEqual(paths(input), ['gait.strideExponent'])
  }
  for (const edge of [0.2, 1]) {
    const input = rig()
    Object.assign(input.gait, { strideExponent: edge })
    assert.deepEqual(paths(input), [])
  }
})
