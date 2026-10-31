import { check } from '../formats/schema.ts'
import type { Schema } from '../formats/schema.ts'
import type { Validated, ValidationError } from '../formats/validate.ts'
import { apply, fromQuaternion, toQuaternion } from '../math/matrix.ts'
import type { Matrix } from '../math/matrix.ts'
import { add, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { posed } from './asf.ts'
import type { AmcFrame, AsfPose, AsfSkeleton } from './asf.ts'

export type ClipBone = { name: string, parent?: string, direction: Vec3, length: number }
export type ClipFrame = {
  root: Vec3
  heading: number
  rotations: number[][]
  contact: { left: boolean, right: boolean }
}
export type Clip = { name: string, source: string, fps: number, bones: ClipBone[], frames: ClipFrame[] }

export type ConvertOptions = {
  name: string
  source: string
  sourceFps: number
  fps: number
  drop?: readonly string[]
  range?: [number, number]
}

const HEADING_WINDOW_SECONDS = 0.5
const CONTACT_HEIGHT = 0.03
const CONTACT_SPEED = 0.45
export const SOURCE_FEET = { left: ['ltibia', 'ltoes'], right: ['rtibia', 'rtoes'] } as const
const DIGITS = 4

type Side = keyof typeof SOURCE_FEET

function round (v: number, digits = DIGITS): number {
  const f = 10 ** digits
  return Math.round(v * f) / f || 0
}

export function facing (rotation: Matrix): number {
  const forward = apply(rotation, [0, 0, 1])
  return Math.atan2(forward[0], forward[2])
}

export function lowestFootPoints (poses: AsfPose[]): Record<string, number> {
  const points = Object.values(SOURCE_FEET).flat()
  return Object.fromEntries(points.map(name => [name, Math.min(...poses.map(pose => pose[name].end[1]))]))
}

function keptBones (skeleton: AsfSkeleton, drop: readonly string[]): ClipBone[] {
  const dropped = new Set<string>(drop)
  for (const bone of skeleton.bones) if (dropped.has(bone.parent)) dropped.add(bone.name)
  return skeleton.bones.filter(bone => !dropped.has(bone.name)).map(bone => ({
    name: bone.name,
    ...(bone.parent === '' ? {} : { parent: bone.parent }),
    direction: bone.direction.map(v => round(v, 6)) as Vec3,
    length: round(bone.length, 5)
  }))
}

function averageFacing (facings: number[], i: number, window: number): number {
  let s = 0
  let c = 0
  for (let k = Math.max(0, i - window); k <= Math.min(facings.length - 1, i + window); k++) {
    s += Math.sin(facings[k])
    c += Math.cos(facings[k])
  }
  return Math.atan2(s, c)
}

function footDown (pose: AsfPose, near: AsfPose, floor: Record<string, number>, dt: number, side: Side): boolean {
  return SOURCE_FEET[side].some(name => {
    const here = pose[name].end
    const there = near[name].end
    const speed = Math.hypot(here[0] - there[0], here[2] - there[2]) / dt
    return here[1] - floor[name] < CONTACT_HEIGHT && speed < CONTACT_SPEED
  })
}

export function clipFromAmc (skeleton: AsfSkeleton, amc: AmcFrame[], options: ConvertOptions): Clip {
  const every = options.sourceFps / options.fps
  if (!Number.isInteger(every) || every < 1) throw new Error('the source frame rate must be a multiple of the clip\'s')
  const bones = keptBones(skeleton, options.drop ?? [])
  const [first, last] = options.range ?? [0, amc.length - 1]
  const poses: AsfPose[] = []
  for (let i = first; i <= Math.min(last, amc.length - 1); i += every) poses.push(posed(skeleton, amc[i]))
  const floor = lowestFootPoints(poses)
  const ground = Math.min(...Object.values(floor))
  const facings = poses.map(pose => facing(pose.root.rotation))
  const window = Math.round(HEADING_WINDOW_SECONDS * options.fps)
  const origin = poses[0].root.end
  const dt = 1 / options.fps
  const frames = poses.map((pose, i): ClipFrame => {
    const near = poses[i + 1] ?? poses[i - 1]
    const root = sub(pose.root.end, [origin[0], ground, origin[2]])
    return {
      root: root.map(v => round(v)) as Vec3,
      heading: round(averageFacing(facings, i, window)),
      rotations: bones.map(bone => toQuaternion(pose[bone.name].rotation).map(v => round(v))),
      contact: { left: footDown(pose, near, floor, dt, 'left'), right: footDown(pose, near, floor, dt, 'right') }
    }
  })
  return { name: options.name, source: options.source, fps: options.fps, bones, frames }
}

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
