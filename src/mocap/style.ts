import { check } from '../formats/schema.ts'
import type { Schema } from '../formats/schema.ts'
import type { Validated, ValidationError } from '../formats/validate.ts'
import { eulerXyz, fromQuaternion, interpolate, IDENTITY, multiply, toQuaternion } from '../math/matrix.ts'
import type { Matrix } from '../math/matrix.ts'
import { random } from '../world/terrain.ts'
import type { BodyFrame } from './retarget.ts'

/**
 * How one character moves differently from the clip it plays. `amplitude` scales a joint's movement about its mean in
 * the clip (1 unchanged, 1.4 wider, 0.6 stiffer); `offset` turns a joint by fixed degrees [x, y, z] in the body frame
 * (a forward hunch is a positive x on the chest); `variation` adds up to that many degrees of fixed, seeded offset to
 * every aimed or turned joint, so two characters with the same style still differ; `rate` scales playback speed and
 * `stride` the length of the path, both 1 by default.
 */
export type MotionStyle = {
  amplitude?: Record<string, number>
  offset?: Record<string, [number, number, number]>
  variation?: number
  seed?: number
  rate?: number
  stride?: number
}

const DEGREES = Math.PI / 180

const STYLE_SCHEMA: Schema = {
  kind: 'object',
  fields: {
    amplitude: { kind: 'map', of: { kind: 'number', min: 0, max: 3 }, note: 'joint to a scale of its movement' },
    offset: { kind: 'map', of: { kind: 'vec3' }, note: 'joint to a fixed turn [x, y, z] in degrees' },
    variation: { kind: 'number', min: 0, max: 20, note: 'degrees of seeded offset on every joint' },
    seed: { kind: 'number', integer: true },
    rate: { kind: 'number', min: 0.5, max: 2, note: 'playback speed' },
    stride: { kind: 'number', min: 0.5, max: 2, note: 'scale of the path' }
  },
  optional: ['amplitude', 'offset', 'variation', 'seed', 'rate', 'stride']
}

export function validateStyle (input: unknown): Validated<MotionStyle> {
  const errors: ValidationError[] = []
  check(input, STYLE_SCHEMA, '', errors)
  return errors.length > 0 ? { errors } : { value: input as MotionStyle, errors }
}

/** The mean of rotations: their quaternions, turned to one hemisphere, summed and normalized. */
export function meanRotation (rotations: Matrix[]): Matrix {
  const sum = [0, 0, 0, 0]
  const first = toQuaternion(rotations[0])
  for (const rotation of rotations) {
    const q = toQuaternion(rotation)
    const sign = q.reduce((dot, v, i) => dot + v * first[i], 0) < 0 ? -1 : 1
    q.forEach((v, i) => { sum[i] += sign * v })
  }
  return fromQuaternion(sum)
}

/** Shapes the rotations of a clip's body frames by a style, in place: amplitude about the mean, then offsets. */
export function applyStyle (frames: BodyFrame[], style: MotionStyle): void {
  if (frames.length === 0) return
  const joints = Object.keys(frames[0].rotations).sort()
  const next = random(style.seed ?? 1)
  const spread = (style.variation ?? 0) * DEGREES
  const turns = new Map(joints.map(joint => {
    const [x, y, z] = style.offset?.[joint] ?? [0, 0, 0]
    const fixed = eulerXyz(x * DEGREES, y * DEGREES, z * DEGREES)
    const varied = spread === 0 ? IDENTITY : eulerXyz((2 * next() - 1) * spread, 0, (2 * next() - 1) * spread)
    return [joint, multiply(varied, fixed)]
  }))
  for (const joint of joints) {
    const amplitude = style.amplitude?.[joint] ?? 1
    const mean = amplitude === 1 ? undefined : meanRotation(frames.map(frame => frame.rotations[joint]))
    const turn = turns.get(joint) as Matrix
    for (const frame of frames) {
      const scaled = mean === undefined ? frame.rotations[joint] : interpolate(mean, frame.rotations[joint], amplitude)
      frame.rotations[joint] = multiply(turn, scaled)
    }
  }
}
