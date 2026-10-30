import type { Mannequin } from '../formats/mannequin.ts'
import type { Rig } from '../formats/rig.ts'
import { add, length, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import type { GaitFrame } from './gait.ts'
import { twoBoneIk } from './ik.ts'
import type { Pose } from './pose.ts'

type Options = { frame: GaitFrame, rig: Rig, rest: Pose, mannequin: Mannequin }

const FORWARD: Vec3 = [0, 0, 1]
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

export function poseAt (options: Options): { pose: Pose, clamped: number } {
  const { frame, rig, rest } = options
  const pose: Pose = {}
  const shift = (name: string): Vec3 => add(rest[name], frame.pelvisOffset)
  for (const name of [rig.pelvis, ...rig.upperBody]) pose[name] = shift(name)
  let clamped = 0
  for (const leg of rig.legs) {
    const foot = frame.feet.find(f => f.side === leg.side)
    if (foot === undefined) throw new Error(`gait frame has no ${leg.side} foot`)
    const hip = shift(leg.hip)
    const result = twoBoneIk({
      hip,
      target: toLocal(foot.ankle, frame),
      upper: length(sub(rest[leg.knee], rest[leg.hip])),
      lower: length(sub(rest[leg.ankle], rest[leg.knee])),
      pole: FORWARD
    })
    if (result.clamped) clamped++
    const flat = sub(rest[leg.toe], rest[leg.ankle])
    const toe = rotateY(pitchUp(flat, MAX_TOE_PITCH * foot.toePitch), foot.toeYaw - frame.root.yaw)
    pose[leg.hip] = hip
    pose[leg.knee] = result.knee
    pose[leg.ankle] = result.end
    pose[leg.toe] = add(result.end, toe)
  }
  for (const arm of rig.arms) {
    const shoulder = shift(arm.shoulder)
    const angle = (arm.side === 'left' ? 1 : -1) * frame.armSwing * Math.PI / 180
    pose[arm.shoulder] = shoulder
    for (const name of [arm.elbow, arm.wrist, arm.hand, ...(arm.carried ?? [])]) {
      pose[name] = add(shoulder, rotateX(sub(rest[name], rest[arm.shoulder]), angle))
    }
  }
  return { pose, clamped }
}
