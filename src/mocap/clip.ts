import { check } from '../formats/schema.ts'
import type { Schema } from '../formats/schema.ts'
import type { Validated, ValidationError } from '../formats/validate.ts'
import { apply, fromQuaternion, toQuaternion } from '../math/matrix.ts'
import type { Matrix } from '../math/matrix.ts'
import { add, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { posed } from './asf.ts'
import type { AmcFrame, AsfPose, AsfSkeleton } from './asf.ts'

/** A bone of a clip's source skeleton: unit rest direction and length in metres; all but the root have a parent. */
export type ClipBone = { name: string, parent?: string, direction: Vec3, length: number }
/**
 * One frame of a clip: the root's position (metres; height above the ground, horizontal from the clip's start), the
 * direction the body faces (radians, as yaw), every bone's global rotation from its rest pose as a quaternion
 * [w, x, y, z] in bone order, and whether each foot is on the ground.
 */
export type ClipFrame = {
  root: Vec3
  heading: number
  rotations: number[][]
  contact: { left: boolean, right: boolean }
}
/** A motion clip converted from motion capture, at a fixed frame rate, with the take it came from. */
export type Clip = { name: string, source: string, fps: number, bones: ClipBone[], frames: ClipFrame[] }

export type ConvertOptions = {
  name: string
  source: string
  /** Frame rate of the AMC file, and of the clip; the clip keeps every (source / fps)-th frame. */
  sourceFps: number
  fps: number
  /** Bones left out (with every bone below them), like fingers. */
  drop?: readonly string[]
  /** First and last source frame kept, inclusive. */
  range?: [number, number]
}

const HEADING_WINDOW_SECONDS = 0.5
const CONTACT_HEIGHT = 0.03
const CONTACT_SPEED = 0.45
const FEET = { left: ['ltibia', 'ltoes'], right: ['rtibia', 'rtoes'] } as const
const DIGITS = 4

function round (v: number, digits = DIGITS): number {
  const f = 10 ** digits
  return Math.round(v * f) / f || 0
}

/** The facing of a rotation, as yaw: the angle of its turned forward axis (+z) about +y. */
export function facing (rotation: Matrix): number {
  const forward = apply(rotation, [0, 0, 1])
  return Math.atan2(forward[0], forward[2])
}

/**
 * Converts AMC frames into a clip: drops the listed bones and resamples to the clip's rate. The heading is the
 * root's facing averaged over half a second each side, so the sway of the hips during a stride stays in the body.
 * The ground is the lowest point either foot reaches; a foot is in contact while its ankle or its toe tip is within
 * 3 cm of the lowest that point gets in the take and moving slower than 0.45 m/s.
 */
export function clipFromAmc (skeleton: AsfSkeleton, amc: AmcFrame[], options: ConvertOptions): Clip {
  const every = options.sourceFps / options.fps
  if (!Number.isInteger(every) || every < 1) throw new Error('the source frame rate must be a multiple of the clip\'s')
  const dropped = new Set<string>(options.drop ?? [])
  for (const bone of skeleton.bones) if (dropped.has(bone.parent)) dropped.add(bone.name)
  const bones: ClipBone[] = skeleton.bones.filter(bone => !dropped.has(bone.name)).map(bone => ({
    name: bone.name,
    ...(bone.parent === '' ? {} : { parent: bone.parent }),
    direction: bone.direction.map(v => round(v, 6)) as Vec3,
    length: round(bone.length, 5)
  }))
  const [first, last] = options.range ?? [0, amc.length - 1]
  const poses: AsfPose[] = []
  for (let i = first; i <= Math.min(last, amc.length - 1); i += every) poses.push(posed(skeleton, amc[i]))
  const points = Object.values(FEET).flat()
  const floor = Object.fromEntries(points.map(name => [name, Math.min(...poses.map(pose => pose[name].end[1]))]))
  const ground = Math.min(...Object.values(floor))
  const facings = poses.map(pose => facing(pose.root.rotation))
  const window = Math.round(HEADING_WINDOW_SECONDS * options.fps)
  const origin = poses[0].root.end
  const dt = 1 / options.fps
  const frames = poses.map((pose, i): ClipFrame => {
    let s = 0
    let c = 0
    for (let k = Math.max(0, i - window); k <= Math.min(poses.length - 1, i + window); k++) {
      s += Math.sin(facings[k])
      c += Math.cos(facings[k])
    }
    const near = poses[i + 1] ?? poses[i - 1]
    const resting = (name: string): boolean => {
      const here = pose[name].end
      const there = near[name].end
      const speed = Math.hypot(here[0] - there[0], here[2] - there[2]) / dt
      return here[1] - floor[name] < CONTACT_HEIGHT && speed < CONTACT_SPEED
    }
    const contact = (side: 'left' | 'right'): boolean => FEET[side].some(resting)
    const root = sub(pose.root.end, [origin[0], ground, origin[2]])
    return {
      root: root.map(v => round(v)) as Vec3,
      heading: round(Math.atan2(s, c)),
      rotations: bones.map(bone => toQuaternion(pose[bone.name].rotation).map(v => round(v))),
      contact: { left: contact('left'), right: contact('right') }
    }
  })
  return { name: options.name, source: options.source, fps: options.fps, bones, frames }
}

/** The posed source skeleton of a clip frame: every bone's rotation, start and end, from the root's position. */
export function clipPose (clip: Clip, frame: ClipFrame): AsfPose {
  const pose: AsfPose = {}
  clip.bones.forEach((bone, i) => {
    const rotation = fromQuaternion(frame.rotations[i])
    const start = bone.parent === undefined ? frame.root : pose[bone.parent].end
    pose[bone.name] = { rotation, start, end: add(start, scale(apply(rotation, bone.direction), bone.length)) }
  })
  return pose
}

const CLIP_SCHEMA: Schema = {
  kind: 'object',
  fields: {
    name: { kind: 'string' },
    source: { kind: 'string', note: 'the motion-capture take the clip came from' },
    fps: { kind: 'number', min: 1, max: 240 },
    bones: {
      kind: 'array',
      minItems: 1,
      of: {
        kind: 'object',
        fields: {
          name: { kind: 'string' },
          parent: { kind: 'string', note: 'the parent bone; the root has none' },
          direction: { kind: 'vec3' },
          length: { kind: 'number', min: 0 }
        },
        optional: ['parent']
      }
    },
    frames: {
      kind: 'array',
      minItems: 1,
      of: {
        kind: 'object',
        fields: {
          root: { kind: 'vec3' },
          heading: { kind: 'number' },
          rotations: { kind: 'array', of: { kind: 'array', of: { kind: 'number', min: -1, max: 1 } } },
          contact: { kind: 'object', fields: { left: { kind: 'boolean' }, right: { kind: 'boolean' } } }
        }
      }
    }
  }
}

/** Checks a clip read from JSON: its shape, a root first and every parent before its bones, a rotation per bone. */
export function validateClip (input: unknown): Validated<Clip> {
  const errors: ValidationError[] = []
  check(input, CLIP_SCHEMA, '', errors)
  if (errors.length > 0) return { errors }
  const clip = input as Clip
  const seen = new Set<string>()
  clip.bones.forEach((bone, i) => {
    const rooted = i === 0 ? bone.parent === undefined : bone.parent !== undefined && seen.has(bone.parent)
    if (!rooted) {
      const message = i === 0 ? 'the first bone must be the root, without a parent'
        : `parent '${bone.parent ?? ''}' must be a bone before this one`
      errors.push({ path: `bones[${i}].parent`, message })
    }
    seen.add(bone.name)
  })
  clip.frames.forEach((frame, i) => {
    if (frame.rotations.length !== clip.bones.length || frame.rotations.some(q => q.length !== 4)) {
      errors.push({ path: `frames[${i}].rotations`, message: 'expected one quaternion [w, x, y, z] per bone' })
    }
  })
  return errors.length > 0 ? { errors } : { value: clip, errors }
}
