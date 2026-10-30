import type { Mannequin } from '../formats/mannequin.ts'
import { armsOf, legsOf } from '../formats/rig.ts'
import type { Leg, Rig } from '../formats/rig.ts'
import { add, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import type { FootState, GaitFrame } from './gait.ts'
import { chainIk, MAX_FLEXION_DEGREES } from './ik.ts'
import { nearestLegs } from './pose.ts'
import type { Pose } from './pose.ts'

type PoseOptions = { frame: GaitFrame, rig: Rig, rest: Pose, mannequin: Mannequin }

const FORWARD: Vec3 = [0, 0, 1]
const UP: Vec3 = [0, 1, 0]
const MAX_TOE_PITCH = 20 * Math.PI / 180

function toLocal (world: Vec3, frame: GaitFrame): Vec3 {
  const { position, yaw } = frame.root
  const dx = world[0] - position[0]
  const dz = world[2] - position[2]
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [dx * c - dz * s, world[1] - position[1], dx * s + dz * c]
}

function rotateY (v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]
}

function rotateX (v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]
}

function pitchUp (v: Vec3, angle: number): Vec3 {
  return rotateX(v, -angle)
}

function placeLeg (leg: Leg, options: PoseOptions, foot: FootState): { placed: Pose, clamped: boolean } {
  const { frame, rest } = options
  const result = chainIk({
    joints: leg.chain.map(name => rest[name]),
    root: add(rest[leg.hip], frame.pelvisOffset),
    target: toLocal(foot.ankle, frame),
    pole: leg.bends.includes('up') ? UP : FORWARD,
    bends: leg.bends.map(bend => bend === 'backward' ? -1 : 1),
    limits: leg.limits ?? { min: 0, max: MAX_FLEXION_DEGREES }
  })
  const placed: Pose = Object.fromEntries(leg.chain.map((name, i) => [name, result.joints[i]]))
  const flat = sub(rest[leg.toe], rest[leg.ankle])
  const toe = rotateY(pitchUp(flat, MAX_TOE_PITCH * foot.toePitch), foot.toeYaw - frame.root.yaw)
  placed[leg.toe] = add(result.joints[leg.chain.length - 1], toe)
  return { placed, clamped: result.clamped }
}

export function poseAt (options: PoseOptions): { pose: Pose, clamped: number } {
  const { frame, rig, rest } = options
  const pose: Pose = {}
  const shift = (name: string): Vec3 => add(rest[name], frame.pelvisOffset)
  for (const name of [rig.pelvis, ...rig.upperBody]) pose[name] = shift(name)
  let clamped = 0
  for (const [index, leg] of legsOf(rig).entries()) {
    const foot = frame.feet[index]
    if (foot === undefined) throw new Error(`gait frame has no foot for leg ${index}`)
    const { placed, clamped: bound } = placeLeg(leg, options, foot)
    Object.assign(pose, placed)
    if (bound) clamped++
  }
  const followed = nearestLegs(rig, rest)
  for (const [index, arm] of armsOf(rig).entries()) {
    const shoulder = shift(arm.shoulder)
    const angle = frame.armSwings[followed[index]] * Math.PI / 180
    pose[arm.shoulder] = shoulder
    for (const name of [...arm.joints.slice(1), ...(arm.carried ?? [])]) {
      pose[name] = add(shoulder, rotateX(sub(rest[name], rest[arm.shoulder]), angle))
    }
  }
  for (const limb of rig.limbs) {
    if (limb.kind === 'appendage') for (const name of limb.joints) pose[name] = shift(name)
  }
  return { pose, clamped }
}
