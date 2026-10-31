import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkCapeAnchors, checkRig, validateRig } from '../src/formats/rig.ts'
import type { AppendageLimb, Rig } from '../src/formats/rig.ts'
import type { Mannequin } from '../src/formats/mannequin.ts'
import type { GaitFrame } from '../src/motion/gait.ts'
import { poseAt } from '../src/motion/locomotion.ts'
import { restPose } from '../src/motion/pose.ts'
import type { Scenario } from '../src/formats/sim.ts'
import { simulateCharacter } from '../src/motion/character.ts'
import { poseSequence } from '../src/motion/sequence.ts'
import { toWorld } from '../src/sim/body.ts'
import { hierarchyOrder, parentsOf } from '../src/motion/skeleton.ts'
import { apply } from '../src/math/matrix.ts'
import { add, length, sub } from '../src/math/vec.ts'
import type { Vec3 } from '../src/math/vec.ts'
import { createRootTrack } from '../src/motion/script.ts'
import { assertClose } from './helpers.ts'
import { hexMannequin, hexRig } from './hexapod-fixtures.ts'
import { FPS, mannequin, plan, rig, silk, walkTrack } from './locomotion-fixtures.ts'

const tasselled: Mannequin = {
  ...mannequin,
  joints: {
    ...mannequin.joints,
    tassel1: add(mannequin.joints.handL, [0, -0.02, 0]),
    tassel2: add(mannequin.joints.handL, [0, -0.12, -0.02]),
    badge: add(mannequin.joints.wristL, [0.03, 0, 0])
  }
}
const tassel: AppendageLimb = {
  kind: 'appendage', name: 'tassel', joints: ['tassel1', 'tassel2'], parent: 'handL', stiffness: 1, damping: 0.4
}
const armed: Rig = { ...rig, limbs: [...rig.limbs, tassel], attached: { badge: 'wristL' } }
const rest = restPose(tasselled)

function walk (r: Rig): GaitFrame[] {
  return plan({ rig: r, mannequin: tasselled }, walkTrack(1.2, 4), 2)
}

test('parents follow the rig: upperBody and limb roots under the pelvis, chains in order, attached and carried', () => {
  const parents = parentsOf(armed)
  assert.equal(parents.pelvis, undefined)
  assert.equal(parents.chest, 'pelvis')
  assert.equal(parents.kneeL, 'hipL')
  assert.equal(parents.hipL, 'pelvis')
  assert.equal(parents.tassel1, 'handL')
  assert.equal(parents.tassel2, 'tassel1')
  assert.equal(parents.badge, 'wristL')
  const order = hierarchyOrder(parents)
  assert.ok(order.indexOf('handL') < order.indexOf('tassel1'))
  assert.throws(() => hierarchyOrder({ a: 'b', b: 'a' }), /cycle: a -> b -> a/)
})

test('the pelvis group is placed exactly as rest plus the pelvis offset', () => {
  for (const frame of walk(rig).slice(0, 30)) {
    const { pose, transforms } = poseAt({ frame, rig, rest, mannequin: tasselled })
    for (const name of [rig.pelvis, ...rig.upperBody]) {
      assert.deepEqual(pose[name], add(rest[name], frame.pelvisOffset))
      assert.equal(transforms[name].rotation, undefined)
    }
  }
})

test('an attached joint moves rigidly with a swinging forearm', () => {
  for (const frame of walk(armed).slice(10, 40)) {
    const { pose } = poseAt({ frame, rig: armed, rest, mannequin: tasselled })
    const before = sub(rest.badge, rest.wristL)
    const after = sub(pose.badge, pose.wristL)
    assertClose(length(after), length(before), 1e-12)
    const elbow = sub(rest.elbowL, rest.wristL)
    const posedElbow = sub(pose.elbowL, pose.wristL)
    const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    assertClose(dot(after, posedElbow), dot(before, elbow), 1e-12)
  }
})

test('a rigid appendage hanging from a hand turns with the arm swing', () => {
  const frames = walk(armed)
  const { poses, transforms } = poseSequence(frames, { rig: armed, rest, mannequin: tasselled, fps: FPS })
  let swung = 0
  poses.forEach((pose, f) => {
    const rotation = transforms[f].handL.rotation
    assert.ok(rotation !== undefined)
    const expected = add(pose.tassel1, apply(rotation, sub(rest.tassel2, rest.tassel1)))
    for (let k = 0; k < 3; k++) assertClose(pose.tassel2[k], expected[k], 1e-9)
    swung = Math.max(swung, length(sub(sub(pose.tassel2, pose.tassel1), sub(rest.tassel2, rest.tassel1))))
  })
  assert.ok(swung > 0.01, `largest swing of the tassel: ${swung}`)
})

test('validation rejects unknown, self and cyclic attachments and an appendage hanging from itself', () => {
  const input = (extra: Record<string, unknown>): unknown => {
    const limbs = [...rig.limbs, { ...tassel, ...extra }]
    return { limbs, pelvis: rig.pelvis, upperBody: rig.upperBody, gait: rig.gait, attached: { badge: 'wristL' } }
  }
  const ok = validateRig(input({}))
  assert.deepEqual(ok.errors, [])
  assert.deepEqual(checkRig(ok.value!, tasselled), [])
  const own = validateRig(input({ parent: 'tassel2' })).value!
  assert.match(checkRig(own, tasselled).map(e => e.message).join(), /one of this appendage's own joints/)
  const unknown = { ...ok.value!, attached: { badge: 'elbowX' } }
  const unknownErrors = checkRig(unknown, tasselled).map(e => `${e.path}: ${e.message}`).join()
  assert.match(unknownErrors, /attached.badge: unknown joint 'elbowX'/)
  const looped = { ...ok.value!, attached: { badge: 'tassel2' }, limbs: [...rig.limbs, { ...tassel, parent: 'badge' }] }
  assert.match(checkRig(looped, tasselled).map(e => e.message).join(), /cycle/)
  const numeric = validateRig({ ...(input({}) as object), attached: { badge: 3 } })
  assert.match(numeric.errors[0].message, /mapping joint names/)
})

test('a cloth chain pinned to a swinging hand turns with it', () => {
  const scenario: Scenario = {
    name: 'walk',
    body: 'unused.json',
    bodyExcludeParts: [],
    script: { accelSeconds: 0.3, segments: [{ action: 'move', speed: 1.2, duration: 1.5 }] },
    chains: [{ anchor: 'handL', links: 3, linkLength: 0.05, direction: [0, -1, 0], material: 'silk' }],
    gravity: [0, -9.81, 0],
    fps: FPS,
    substeps: 4,
    particleRadius: 0.02,
    durationSeconds: 1.5
  }
  const run = simulateCharacter({ mannequin: tasselled, rig: armed, scenario, materials: [silk] })
  const step: Vec3 = [0, -0.05, 0]
  let turned = 0
  run.recording.frames.forEach((recorded, f) => {
    if (f === 0) return
    const rotation = run.transforms[f].handL.rotation!
    const local = add(run.poses[f].handL, apply(rotation, step))
    const world = toWorld(local, recorded.root)
    for (let k = 0; k < 3; k++) assertClose(recorded.positions[3 + k], world[k], 1e-9)
    turned = Math.max(turned, length(sub(apply(rotation, step), step)))
  })
  assert.ok(turned > 0.005, `largest turn of the pinned link: ${turned} m`)
})

test('a joint attached to a knee stays on the shin, which leaves the knee', () => {
  const kneed: Mannequin = {
    ...tasselled,
    joints: { ...tasselled.joints, pad: lerpVec(mannequin.joints.kneeL, mannequin.joints.ankleL, 0.4) }
  }
  const padded: Rig = { ...armed, attached: { ...armed.attached, pad: 'kneeL' } }
  const padRest = restPose(kneed)
  for (const frame of walk(padded).slice(5, 45)) {
    const { pose } = poseAt({ frame, rig: padded, rest: padRest, mannequin: kneed })
    const expected = lerpVec(pose.kneeL, pose.ankleL, 0.4)
    for (let k = 0; k < 3; k++) assertClose(pose.pad[k], expected[k], 1e-9)
  }
})

function lerpVec (a: Vec3, b: Vec3, u: number): Vec3 {
  return add(a, [(b[0] - a[0]) * u, (b[1] - a[1]) * u, (b[2] - a[2]) * u])
}

test('on a turning walk, joints attached to a soft tail stay on the segment that leaves their parent', () => {
  const tailed: Mannequin = {
    ...hexMannequin,
    joints: {
      ...hexMannequin.joints,
      tip: lerpVec(hexMannequin.joints.tail2, hexMannequin.joints.tail3, 1.5),
      knot: lerpVec(hexMannequin.joints.tail2, hexMannequin.joints.tail3, 0.3),
      tuft1: hexMannequin.joints.tail3,
      tuft2: add(hexMannequin.joints.tail3, [0.05, 0.05, -0.05]),
      tuftEnd: add(hexMannequin.joints.tail3, [0.1, 0.1, -0.1])
    }
  }
  const tuft: AppendageLimb = {
    kind: 'appendage', name: 'tuft', joints: ['tuft1', 'tuft2'], parent: 'tail3', stiffness: 0.5, damping: 0.4
  }
  const soft: AppendageLimb = {
    kind: 'appendage', name: 'tail', joints: ['tail1', 'tail2', 'tail3'], stiffness: 0.2, damping: 0.3
  }
  const tailRig: Rig = {
    ...hexRig,
    limbs: [tuft, ...hexRig.limbs.filter(l => l.kind !== 'appendage'), soft],
    attached: { tip: 'tail3', knot: 'tail2', tuftEnd: 'tuft2' }
  }
  assert.deepEqual(checkRig(tailRig, tailed), [])
  const tailRest = restPose(tailed)
  const script = { accelSeconds: 0.5, segments: [
    { action: 'move' as const, speed: 0.3, duration: 1.5 }, { action: 'turn' as const, degrees: 120, duration: 1.5 }
  ] }
  const frames = plan({ rig: tailRig, mannequin: tailed }, createRootTrack(script), 3)
  const { poses } = poseSequence(frames, { rig: tailRig, rest: tailRest, mannequin: tailed, fps: FPS })
  let bent = 0
  poses.forEach(pose => {
    const tipAt = lerpVec(pose.tail2, pose.tail3, 1.5)
    const knotAt = lerpVec(pose.tail2, pose.tail3, 0.3)
    for (let k = 0; k < 3; k++) {
      assertClose(pose.tip[k], tipAt[k], 1e-9)
      assertClose(pose.knot[k], knotAt[k], 1e-9)
      assertClose(pose.tuft1[k], pose.tail3[k], 1e-12)
      assertClose(pose.tuftEnd[k], lerpVec(pose.tuft1, pose.tuft2, 2)[k], 1e-9)
    }
    bent = Math.max(bent, length(sub(sub(pose.tail3, pose.tail2), sub(tailRest.tail3, tailRest.tail2))))
  })
  assert.ok(bent > 0.01, `largest tail swing: ${bent}`)
})

test('cape anchors may be attached through upperBody joints but not through a limb', () => {
  const capeRig = (parent: string): Rig => {
    return { ...armed, attached: { ...armed.attached, capeA: parent, capeB: parent } }
  }
  const cape = { anchorLeft: 'capeA', anchorRight: 'capeB' }
  assert.deepEqual(checkCapeAnchors(cape, capeRig('chest')), [])
  const errors = checkCapeAnchors(cape, capeRig('wristL'))
  assert.equal(errors.length, 2)
  assert.match(errors[0].message, /attached to a joint that moves on its own/)
})

test('a cycle made of appendage parents is reported at the appendage', () => {
  const a: AppendageLimb = { ...tassel, name: 'a', joints: ['tassel1', 'tassel2'], parent: 'badge' }
  const looped: Rig = { ...rig, limbs: [...rig.limbs, a], attached: { badge: 'tassel2' } }
  const loopedErrors = checkRig(looped, tasselled)
  assert.equal(loopedErrors.length, 1)
  assert.match(loopedErrors[0].message, /joints form a cycle: (badge|tassel1|tassel2) -> .* every chain of parents/)
})
