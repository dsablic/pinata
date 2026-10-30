import { check } from '../formats/schema.ts'
import type { Schema } from '../formats/schema.ts'
import type { Mannequin } from '../formats/mannequin.ts'
import { legsOf } from '../formats/rig.ts'
import type { Rig } from '../formats/rig.ts'
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
import { clipPose } from './clip.ts'
import { applyStyle } from './style.ts'
import type { MotionStyle } from './style.ts'
import type { Clip } from './clip.ts'

/**
 * How a character follows a clip's source skeleton. `aim` joints point the bone to the next joint of their limb
 * where the source bone points, keeping the character's bone lengths (legs and arms, whose rest poses differ from the
 * source's); `turn` joints turn as the source bone turns from its rest pose (pelvis, spine, head, feet); `hang` moves
 * joints to hang from another joint while retargeted, grouped by that joint, so a visor follows the head. Every other
 * joint moves rigidly with its parent.
 */
export type Retargeting = {
  aim: Record<string, string>
  turn: Record<string, string>
  hang?: Record<string, string[]>
}
/** A retargeted frame: the root, body-local joint positions and transforms, and which feet are on the ground. */
export type RetargetedFrame = { root: RootState, pose: Pose, transforms: Transforms, contact: boolean[] }

/** Metres over which the weight of the body's height moves from one foot to the other. */
const LIFT_SOFTNESS = 0.01
const FOOT_POINTS = { left: ['ltibia', 'ltoes'], right: ['rtibia', 'rtoes'] } as const

const RETARGETING_SCHEMA: Schema = {
  kind: 'object',
  fields: {
    aim: { kind: 'map', of: { kind: 'string' }, note: 'our joint to the source bone its limb bone points along' },
    turn: { kind: 'map', of: { kind: 'string' }, note: 'our joint to the source bone whose turn it copies' },
    hang: { kind: 'map', of: { kind: 'array', of: { kind: 'string' } }, note: 'a joint to the joints hanging from it' }
  },
  optional: ['hang']
}

/** Merges retargetings, later ones adding to and overriding earlier ones. */
export function mergeRetargeting (...maps: Array<Partial<Retargeting>>): Retargeting {
  const result: Retargeting = { aim: {}, turn: {}, hang: {} }
  for (const map of maps) {
    Object.assign(result.aim, map.aim)
    Object.assign(result.turn, map.turn)
    Object.assign(result.hang ?? {}, map.hang)
  }
  return result
}

/**
 * Checks a retargeting against a character and a clip: its shape, that every joint it names is one of the
 * character's, every bone one of the clip's, the pelvis turns, and each aimed joint has a next joint in a limb.
 */
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

/**
 * A clip frame in the character's terms, before it is assembled into joint positions: the body-local rotation of
 * every aimed and turned joint, the root (its path scaled to the character), how far each foot (left, right) is above
 * its planted level in the character's scale, and which feet are on the ground, per leg.
 */
export type BodyFrame = {
  rotations: Record<string, Matrix>
  root: RootState
  clearance: { left: number, right: number }
  contact: boolean[]
}

/** The joint hierarchy a retargeting poses: the rig's, with the `hang` joints moved, parents first. */
export type Hierarchy = { parents: Parents, order: string[] }

export function hierarchyOf (rig: Rig, map: Retargeting): Hierarchy {
  const parents: Parents = { ...parentsOf(rig) }
  for (const [parent, joints] of Object.entries(map.hang ?? {})) for (const joint of joints) parents[joint] = parent
  return { parents, order: hierarchyOrder(parents) }
}

/** The ratio of the character's leg (hip to ankle, the left one) to the source's, from the bones its joints aim. */
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

/**
 * The body frames of a clip: each turned joint takes its source bone's rotation from rest, each aimed joint the
 * rotation that points its limb bone along the source bone, both relative to the clip's heading, then shaped by the
 * style. The root's path scales by the leg ratio (times the style's stride) and turns with the heading.
 */
export function retargetRotations (clip: Clip, options: RetargetOptions): BodyFrame[] {
  const { rig, rest, map } = options
  const legs = legsOf(rig)
  const ratio = legRatio(clip, options) * (options.style?.stride ?? 1)
  const directions = new Map(clip.bones.map(bone => [bone.name, bone.direction]))
  const sources = clip.frames.map(frame => clipPose(clip, frame))
  const points = Object.values(FOOT_POINTS).flat()
  const floor = Object.fromEntries(points.map(name => [name, Math.min(...sources.map(pose => pose[name].end[1]))]))
  const frames = clip.frames.map((frame, i): BodyFrame => {
    const source = sources[i]
    const unturn = transpose(yawMatrix(frame.heading))
    const local = (bone: string): Matrix => multiply(unturn, source[bone].rotation)
    const rotations: Record<string, Matrix> = {}
    for (const [joint, bone] of Object.entries(map.turn)) rotations[joint] = local(bone)
    for (const [joint, bone] of Object.entries(map.aim)) {
      const next = nextInLimb(rig, joint) as string
      const from = normalize(sub(rest[next], rest[joint]))
      rotations[joint] = between(from, normalize(apply(local(bone), directions.get(bone) as Vec3)))
    }
    const clearance = (side: 'left' | 'right'): number => {
      return ratio * Math.min(...FOOT_POINTS[side].map(name => source[name].end[1] - floor[name]))
    }
    return {
      rotations,
      root: {
        position: [ratio * frame.root[0], 0, ratio * frame.root[2]],
        yaw: frame.heading,
        velocity: [0, 0, 0],
        angularVelocity: 0
      },
      clearance: { left: clearance('left'), right: clearance('right') },
      contact: legs.map(leg => leg.side === 'right' ? frame.contact.right : frame.contact.left)
    }
  })
  frames.forEach((frame, i) => {
    const before = Math.max(0, i - 1)
    const after = Math.min(frames.length - 1, i + 1)
    const a = frames[before].root
    const b = frames[after].root
    const dt = (after - before) / clip.fps
    if (dt === 0) return
    frame.root.velocity = scale(sub(b.position, a.position), 1 / dt)
    frame.root.angularVelocity = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) / dt
  })
  if (options.style !== undefined) applyStyle(frames, options.style)
  return frames
}

/**
 * Body-local joint positions and transforms from a body frame's rotations: the pelvis at its rest place, each joint
 * placed by its parent's transform, turned and aimed joints turning by their rotations, the rest moving rigidly with
 * their parent; then the body lifted so the feet are as far above the ground as the source's, the foot nearer its
 * planted level counting most (a soft minimum, so the height does not jump as the weight passes between the feet).
 */
export function assemble (
  frame: Pick<BodyFrame, 'rotations' | 'clearance'>,
  options: RetargetOptions,
  hierarchy: Hierarchy
): { pose: Pose, transforms: Transforms } {
  const { rig, rest, mannequin } = options
  const { parents, order } = hierarchy
  const pose: Pose = {}
  const transforms: Transforms = {}
  for (const joint of order) {
    const parent = parents[joint]
    const at = parent === undefined ? rest[rig.pelvis] : placed(transforms[parent], rest[joint])
    pose[joint] = at
    const rotation = frame.rotations[joint]
    if (rotation !== undefined) transforms[joint] = transformTo(rotation, rest[joint], at)
    else if (parent !== undefined) transforms[joint] = transforms[parent]
    else transforms[joint] = { translation: [0, 0, 0] }
  }
  const lift = legsOf(rig).map(leg => {
    const above = leg.side === 'right' ? frame.clearance.right : frame.clearance.left
    const radii = footRadii(leg, mannequin)
    const sole = Math.min(pose[leg.ankle][1] - radii.ankle, pose[leg.toe][1] - radii.toe)
    return { above, shift: above - sole }
  })
  // a soft minimum: the foot nearer its planted level counts most, and the weight moves smoothly between feet
  const nearest = Math.min(...lift.map(l => l.above))
  const weights = lift.map(l => Math.exp(-(l.above - nearest) / LIFT_SOFTNESS))
  const total = weights.reduce((a, b) => a + b, 0)
  const shift = lift.reduce((sum, l, i) => sum + l.shift * weights[i], 0) / total
  for (const joint of order) {
    pose[joint] = add(pose[joint], [0, shift, 0])
    const t = transforms[joint]
    transforms[joint] = { ...t, translation: add(t.translation, [0, shift, 0]) }
  }
  return { pose, transforms }
}

/**
 * Retargets every frame of a clip onto a character. Bones keep the character's lengths; the root's path scales by
 * the ratio of the character's leg (hip to ankle) to the source's, and turns with the clip's heading. The body is
 * placed so the foot nearer its planted level stands as far above the ground as the source's, scaled, which puts a
 * planted foot on the ground.
 */
export function retargetClip (clip: Clip, options: RetargetOptions): RetargetedFrame[] {
  const hierarchy = hierarchyOf(options.rig, options.map)
  return retargetRotations(clip, options).map(frame => ({
    root: frame.root,
    ...assemble(frame, options, hierarchy),
    contact: frame.contact
  }))
}
