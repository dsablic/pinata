import type { Mannequin } from '../formats/mannequin.ts'
import { armsOf, legsOf } from '../formats/rig.ts'
import type { Leg, Rig } from '../formats/rig.ts'
import { add, normalize, rotateY, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { between } from '../math/matrix.ts'
import type { Matrix } from '../math/matrix.ts'
import { toLocal } from '../sim/body.ts'
import type { FootState, GaitFrame } from './gait.ts'
import { chainIk, MAX_FLEXION_DEGREES } from './ik.ts'
import { nearestLegs } from './pose.ts'
import type { Pose } from './pose.ts'
import { hierarchyOrder, inherit, parentsOf, transformTo } from './skeleton.ts'
import type { Transform, Transforms } from './skeleton.ts'

type PoseOptions = { frame: GaitFrame, rig: Rig, rest: Pose, mannequin: Mannequin }

const FORWARD: Vec3 = [0, 0, 1]
const UP: Vec3 = [0, 1, 0]
const MISS_TOLERANCE = 1e-4
const MAX_TOE_PITCH = 20 * Math.PI / 180

function rotateX (v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]
}

function xRotation (angle: number): Matrix {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [[1, 0, 0], [0, c, -s], [0, s, c]]
}

function legTransforms (leg: Leg, rest: Pose, pose: Pose): Transforms {
  const { joints } = leg
  const transforms: Transforms = {}
  joints.forEach((joint, i) => {
    const [from, to] = i < joints.length - 1 ? [joint, joints[i + 1]] : [joints[i - 1], joint]
    const rotation = between(normalize(sub(rest[to], rest[from])), normalize(sub(pose[to], pose[from])))
    transforms[joint] = transformTo(rotation, rest[joint], pose[joint])
  })
  return transforms
}

function pitchUp (v: Vec3, angle: number): Vec3 {
  return rotateX(v, -angle)
}

function withPelvis (options: PoseOptions, name: string): Vec3 {
  const { frame, rig, rest } = options
  if (frame.pelvisPitch === undefined) return add(rest[name], frame.pelvisOffset)
  const pelvis = rest[rig.pelvis]
  return add(add(pelvis, pitchUp(sub(rest[name], pelvis), frame.pelvisPitch)), frame.pelvisOffset)
}

function placeLeg (leg: Leg, options: PoseOptions, foot: FootState): { placed: Pose, clamped: boolean } {
  const { frame, rest } = options
  const result = chainIk({
    joints: leg.chain.map(name => rest[name]),
    root: withPelvis(options, leg.hip),
    target: toLocal(foot.ankle, frame.root),
    pole: leg.bends.includes('up') ? UP : FORWARD,
    bends: leg.bends.map(bend => bend === 'backward' ? -1 : 1),
    limits: leg.limits ?? (leg.chain.length > 3 ? { min: 0, max: MAX_FLEXION_DEGREES } : undefined)
  })
  const placed: Pose = Object.fromEntries(leg.chain.map((name, i) => [name, result.joints[i]]))
  const flat = sub(rest[leg.toe], rest[leg.ankle])
  const pitch = MAX_TOE_PITCH * foot.toePitch
  const tilt = foot.surfacePitch === undefined ? pitch : pitch + foot.surfacePitch
  const toe = rotateY(pitchUp(flat, tilt), foot.toeYaw - frame.root.yaw)
  placed[leg.toe] = add(result.joints[leg.chain.length - 1], toe)
  return { placed, clamped: result.clamped || result.missed > MISS_TOLERANCE }
}

export type Posed = { pose: Pose, transforms: Transforms, clamped: number }

export function poseAt (options: PoseOptions): Posed {
  const { frame, rig, rest } = options
  const pose: Pose = {}
  const transforms: Transforms = {}
  const pitch = frame.pelvisPitch
  const pelvis = rest[rig.pelvis]
  const body: Transform = pitch === undefined
    ? { translation: frame.pelvisOffset }
    : transformTo(xRotation(-pitch), pelvis, withPelvis(options, rig.pelvis))
  for (const name of [rig.pelvis, ...rig.upperBody]) {
    pose[name] = withPelvis(options, name)
    transforms[name] = body
  }
  let clamped = 0
  for (const [index, leg] of legsOf(rig).entries()) {
    const foot = frame.feet[index]
    if (foot === undefined) throw new Error(`gait frame has no foot for leg ${index}`)
    const { placed, clamped: bound } = placeLeg(leg, options, foot)
    Object.assign(pose, placed)
    Object.assign(transforms, legTransforms(leg, rest, pose))
    if (bound) clamped++
  }
  const followed = nearestLegs(rig, rest)
  for (const [index, arm] of armsOf(rig).entries()) {
    const shoulder = withPelvis(options, arm.shoulder)
    const swing = frame.armSwings[followed[index]] * Math.PI / 180
    const angle = pitch === undefined ? swing : swing - pitch
    const rotation = xRotation(angle)
    pose[arm.shoulder] = shoulder
    transforms[arm.shoulder] = transformTo(rotation, rest[arm.shoulder], shoulder)
    for (const name of [...arm.joints.slice(1), ...(arm.carried ?? [])]) {
      pose[name] = add(shoulder, rotateX(sub(rest[name], rest[arm.shoulder]), angle))
      transforms[name] = transforms[arm.shoulder]
    }
  }
  const parents = parentsOf(rig)
  inherit(pose, transforms, { rest, parents, order: hierarchyOrder(parents), driven: new Set(Object.keys(pose)) })
  return { pose, transforms, clamped }
}
