import { check } from '../formats/schema.ts'
import type { Schema } from '../formats/schema.ts'
import type { Mannequin } from '../formats/mannequin.ts'
import { legsOf } from '../formats/rig.ts'
import type { Leg, Rig } from '../formats/rig.ts'
import type { Validated, ValidationError } from '../formats/validate.ts'
import { apply, between, multiply, transpose, yawMatrix } from '../math/matrix.ts'
import type { Matrix } from '../math/matrix.ts'
import { add, normalize, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { chainLength, footRadii } from '../motion/pose.ts'
import type { Pose } from '../motion/pose.ts'
import type { RootState } from '../motion/script.ts'
import { hierarchyOrder, parentsOf, placed, transformTo } from '../motion/skeleton.ts'
import type { Parents, Transforms } from '../motion/skeleton.ts'
import { clipPose, lowestFootPoints, SOURCE_FEET } from './clip.ts'
import type { AsfPose } from './asf.ts'
import { applyStyle } from './style.ts'
import type { MotionStyle } from './style.ts'
import type { Clip } from './clip.ts'
import { turnBetween } from '../world/yaw.ts'

export type Retargeting = {
  aim: Record<string, string>
  turn: Record<string, string>
  hang?: Record<string, string[]>
}
export type RetargetedFrame = { root: RootState, pose: Pose, transforms: Transforms, contact: boolean[] }

const LIFT_SOFTNESS = 0.01

const RETARGETING_SCHEMA: Schema = {
  kind: 'object',
  fields: {
    aim: { kind: 'map', of: { kind: 'string' }, note: 'our joint to the source bone its limb bone points along' },
    turn: { kind: 'map', of: { kind: 'string' }, note: 'our joint to the source bone whose turn it copies' },
    hang: { kind: 'map', of: { kind: 'array', of: { kind: 'string' } }, note: 'a joint to the joints hanging from it' }
  },
  optional: ['hang']
}

export function mergeRetargeting (...maps: Array<Partial<Retargeting>>): Retargeting {
  const result: Retargeting = { aim: {}, turn: {}, hang: {} }
  for (const map of maps) {
    Object.assign(result.aim, map.aim)
    Object.assign(result.turn, map.turn)
    Object.assign(result.hang ?? {}, map.hang)
  }
  return result
}

export function validateRetargeting (input: unknown, rig: Rig, rest: Pose, clip: Clip): Validated<Retargeting> {
  const errors: ValidationError[] = []
  check(input, RETARGETING_SCHEMA, '', errors)
  if (errors.length > 0) return { errors }
  const map = input as Retargeting
  const bones = new Set(clip.bones.map(bone => bone.name))
  for (const kind of ['aim', 'turn'] as const) {
    for (const [joint, bone] of Object.entries(map[kind])) {
      if (rest[joint] === undefined) errors.push({ path: `${kind}.${joint}`, message: 'not a joint of the character' })
      if (!bones.has(bone)) errors.push({ path: `${kind}.${joint}`, message: `'${bone}' is not a bone of the clip` })
      if (kind === 'aim' && nextInLimb(rig, joint) === undefined) {
        errors.push({ path: `aim.${joint}`, message: 'an aimed joint needs a next joint in its limb to point at' })
      }
    }
  }
  if (map.turn[rig.pelvis] === undefined) {
    errors.push({ path: `turn.${rig.pelvis}`, message: 'the pelvis must turn with a source bone, usually root' })
  }
  for (const [parent, joints] of Object.entries(map.hang ?? {})) {
    for (const joint of [parent, ...joints]) {
      if (rest[joint] === undefined) errors.push({ path: `hang.${parent}`, message: `'${joint}' is not a joint` })
    }
  }
  return errors.length > 0 ? { errors } : { value: map, errors }
}

function nextInLimb (rig: Rig, joint: string): string | undefined {
  for (const limb of rig.limbs) {
    const i = limb.joints.indexOf(joint)
    if (i >= 0) return limb.joints[i + 1]
  }
  return undefined
}

export type RetargetOptions = { rig: Rig, rest: Pose, mannequin: Mannequin, map: Retargeting, style?: MotionStyle }

export type BodyFrame = {
  rotations: Record<string, Matrix>
  root: RootState
  clearance: { left: number, right: number }
  contact: boolean[]
}

export type Hierarchy = { parents: Parents, order: string[] }

export function hierarchyOf (rig: Rig, map: Retargeting): Hierarchy {
  const parents: Parents = { ...parentsOf(rig) }
  for (const [parent, joints] of Object.entries(map.hang ?? {})) for (const joint of joints) parents[joint] = parent
  return { parents, order: hierarchyOrder(parents) }
}

export function legRatio (clip: Clip, options: RetargetOptions): number {
  const { rig, rest, map } = options
  const legs = legsOf(rig)
  const left = legs.find(leg => leg.side === 'left') ?? legs[0]
  const sourceLength = left.chain.slice(0, -1).reduce((sum, joint) => {
    const bone = clip.bones.find(b => b.name === map.aim[joint])
    if (bone === undefined) throw new Error(`leg joint '${joint}' has no aimed source bone to measure the leg by`)
    return sum + bone.length
  }, 0)
  return chainLength(left.chain, rest) / sourceLength
}

function rotationsFrom (
  source: AsfPose,
  heading: number,
  directions: Map<string, Vec3>,
  options: RetargetOptions
): Record<string, Matrix> {
  const { rig, rest, map } = options
  const unturn = transpose(yawMatrix(heading))
  const local = (bone: string): Matrix => multiply(unturn, source[bone].rotation)
  const rotations: Record<string, Matrix> = {}
  for (const [joint, bone] of Object.entries(map.turn)) rotations[joint] = local(bone)
  for (const [joint, bone] of Object.entries(map.aim)) {
    const next = nextInLimb(rig, joint) as string
    const from = normalize(sub(rest[next], rest[joint]))
    rotations[joint] = between(from, normalize(apply(local(bone), directions.get(bone) as Vec3)))
  }
  return rotations
}

function setRootVelocities (frames: BodyFrame[], fps: number): void {
  frames.forEach((frame, i) => {
    const before = Math.max(0, i - 1)
    const after = Math.min(frames.length - 1, i + 1)
    const a = frames[before].root
    const b = frames[after].root
    const dt = (after - before) / fps
    if (dt === 0) return
    frame.root.velocity = scale(sub(b.position, a.position), 1 / dt)
    frame.root.angularVelocity = turnBetween(a.yaw, b.yaw) / dt
  })
}

export function retargetRotations (clip: Clip, options: RetargetOptions): BodyFrame[] {
  const legs = legsOf(options.rig)
  const ratio = legRatio(clip, options) * (options.style?.stride ?? 1)
  const directions = new Map(clip.bones.map(bone => [bone.name, bone.direction]))
  const sources = clip.frames.map(frame => clipPose(clip, frame))
  const floor = lowestFootPoints(sources)
  const frames = clip.frames.map((frame, i): BodyFrame => {
    const source = sources[i]
    const clearance = (side: 'left' | 'right'): number => {
      return ratio * Math.min(...SOURCE_FEET[side].map(name => source[name].end[1] - floor[name]))
    }
    return {
      rotations: rotationsFrom(source, frame.heading, directions, options),
      root: {
        position: [ratio * frame.root[0], 0, ratio * frame.root[2]],
        yaw: frame.heading,
        velocity: [0, 0, 0],
        angularVelocity: 0
      },
      clearance: { left: clearance('left'), right: clearance('right') },
      contact: legs.map(leg => frame.contact[sideOf(leg)])
    }
  })
  setRootVelocities(frames, clip.fps)
  if (options.style !== undefined) applyStyle(frames, options.style)
  return frames
}

export function sideOf (leg: Leg): 'left' | 'right' {
  return leg.side === 'right' ? 'right' : 'left'
}

export function raise (pose: Pose, transforms: Transforms, joints: string[], lift: number): void {
  for (const joint of joints) {
    pose[joint] = add(pose[joint], [0, lift, 0])
    const t = transforms[joint]
    transforms[joint] = { ...t, translation: add(t.translation, [0, lift, 0]) }
  }
}

function placeJoints (
  rotations: Record<string, Matrix>,
  options: RetargetOptions,
  hierarchy: Hierarchy
): { pose: Pose, transforms: Transforms } {
  const { rig, rest } = options
  const { parents, order } = hierarchy
  const pose: Pose = {}
  const transforms: Transforms = {}
  for (const joint of order) {
    const parent = parents[joint]
    const at = parent === undefined ? rest[rig.pelvis] : placed(transforms[parent], rest[joint])
    pose[joint] = at
    const rotation = rotations[joint]
    if (rotation !== undefined) transforms[joint] = transformTo(rotation, rest[joint], at)
    else if (parent !== undefined) transforms[joint] = transforms[parent]
    else transforms[joint] = { translation: [0, 0, 0] }
  }
  return { pose, transforms }
}

function softLift (pose: Pose, clearance: BodyFrame['clearance'], options: RetargetOptions): number {
  const lift = legsOf(options.rig).map(leg => {
    const above = clearance[sideOf(leg)]
    const radii = footRadii(leg, options.mannequin)
    const sole = Math.min(pose[leg.ankle][1] - radii.ankle, pose[leg.toe][1] - radii.toe)
    return { above, shift: above - sole }
  })
  const nearest = Math.min(...lift.map(l => l.above))
  const weights = lift.map(l => Math.exp(-(l.above - nearest) / LIFT_SOFTNESS))
  const total = weights.reduce((a, b) => a + b, 0)
  return lift.reduce((sum, l, i) => sum + l.shift * weights[i], 0) / total
}

export function assemble (
  frame: Pick<BodyFrame, 'rotations' | 'clearance'>,
  options: RetargetOptions,
  hierarchy: Hierarchy
): { pose: Pose, transforms: Transforms } {
  const { pose, transforms } = placeJoints(frame.rotations, options, hierarchy)
  raise(pose, transforms, hierarchy.order, softLift(pose, frame.clearance, options))
  return { pose, transforms }
}

export function retargetClip (clip: Clip, options: RetargetOptions): RetargetedFrame[] {
  const hierarchy = hierarchyOf(options.rig, options.map)
  return retargetRotations(clip, options).map(frame => ({
    root: frame.root,
    ...assemble(frame, options, hierarchy),
    contact: frame.contact
  }))
}
