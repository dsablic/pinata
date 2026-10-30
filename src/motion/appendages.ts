import type { AppendageLimb, Rig } from '../formats/rig.ts'
import { add, cross, dot, length, normalize, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { toLocal, toWorld } from '../sim/body.ts'
import type { GaitFrame } from './gait.ts'
import type { Pose } from './pose.ts'

type Options = { rig: Rig, rest: Pose, fps: number, substeps: number }
type Segment = { length: number, rest: Vec3, tip: Vec3, velocity: Vec3, target: Vec3 }

export const DEFAULT_APPENDAGE_SUBSTEPS = 8
const MIN_FREQUENCY = 0.3
const FREQUENCY_RANGE = 2.7
const PARALLEL_EPSILON = 1e-12

/** Natural frequency in Hz of an appendage spring: 0.3 Hz at stiffness 0 up to 3 Hz at stiffness 1. */
export function springFrequency (stiffness: number): number {
  return MIN_FREQUENCY + FREQUENCY_RANGE * stiffness
}

function yawed (v: Vec3, yaw: number): Vec3 {
  return toWorld(v, { position: [0, 0, 0], yaw, velocity: [0, 0, 0], angularVelocity: 0 })
}

/** Rotates v about the unit axis by angle radians (Rodrigues). */
function rotateAbout (v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)))
}

/** Applies to v the smallest rotation that takes unit vector from onto unit vector to. */
function rotateBetween (from: Vec3, to: Vec3, v: Vec3): Vec3 {
  const axis = cross(from, to)
  const sin = length(axis)
  const cos = dot(from, to)
  if (sin < PARALLEL_EPSILON) return cos > 0 ? v : scale(v, -1)
  return rotateAbout(v, scale(axis, 1 / sin), Math.atan2(sin, cos))
}

function lerp (a: Vec3, b: Vec3, u: number): Vec3 {
  return add(a, scale(sub(b, a), u))
}

function oscillation (limb: AppendageLimb, time: number): number {
  const { oscillate } = limb
  if (oscillate === undefined || oscillate.degrees === 0 || oscillate.period === undefined) return 0
  return oscillate.degrees * Math.PI / 180 * Math.sin(2 * Math.PI * (time / oscillate.period + oscillate.phase))
}

/**
 * Rest direction of the first segment, in body space, turned by the oscillator at the given time. Later segments keep
 * their rest direction relative to their parent's current direction.
 */
function firstDirection (limb: AppendageLimb, segment: Segment, time: number): Vec3 {
  const angle = oscillation(limb, time)
  if (angle === 0 || limb.oscillate === undefined) return segment.rest
  return rotateAbout(segment.rest, normalize(limb.oscillate.axis), angle)
}

function springStep (segment: Segment, base: Vec3, goal: Vec3, limb: AppendageLimb, dt: number): void {
  const targetVelocity = scale(sub(goal, segment.target), 1 / dt)
  segment.target = goal
  if (limb.stiffness >= 1) {
    segment.tip = goal
    segment.velocity = targetVelocity
    return
  }
  const omega = 2 * Math.PI * springFrequency(limb.stiffness)
  const damping = 2 * limb.damping * omega
  const pull = add(scale(sub(goal, segment.tip), omega * omega * dt), scale(targetVelocity, damping * dt))
  const velocity = scale(add(segment.velocity, pull), 1 / (1 + damping * dt + omega * omega * dt * dt))
  const moved = add(segment.tip, scale(velocity, dt))
  const reach = sub(moved, base)
  const tip = length(reach) > 0 ? add(base, scale(reach, segment.length / length(reach))) : goal
  segment.velocity = scale(sub(tip, segment.tip), 1 / dt)
  segment.tip = tip
}

function animate (limb: AppendageLimb, frames: GaitFrame[], poses: Pose[], options: Options): void {
  const { rest, fps, substeps } = options
  const root = limb.joints[0]
  const segments: Segment[] = limb.joints.slice(1).map((joint, i) => {
    const bone = sub(rest[joint], rest[limb.joints[i]])
    return { length: length(bone), rest: normalize(bone), tip: [0, 0, 0], velocity: [0, 0, 0], target: [0, 0, 0] }
  })
  const baseAt = (f: number): Vec3 => toWorld(add(rest[root], frames[f].pelvisOffset), frames[f].root)
  const place = (base: Vec3, yaw: number, time: number, step?: number): void => {
    let parentBase = base
    let from = base
    segments.forEach((segment, i) => {
      const direction = i === 0
        ? yawed(firstDirection(limb, segment, time), yaw)
        : rotateBetween(yawed(segments[i - 1].rest, yaw), normalize(sub(from, parentBase)), yawed(segment.rest, yaw))
      const goal = add(from, scale(direction, segment.length))
      if (step === undefined) {
        segment.tip = goal
        segment.target = goal
        segment.velocity = [...frames[0].root.velocity]
      } else springStep(segment, from, goal, limb, step)
      parentBase = from
      from = segment.tip
    })
  }
  const record = (f: number): void => {
    for (const [i, segment] of segments.entries()) poses[f][limb.joints[i + 1]] = toLocal(segment.tip, frames[f].root)
  }
  place(baseAt(0), frames[0].root.yaw, 0)
  record(0)
  const dt = 1 / (fps * substeps)
  for (let f = 1; f < frames.length; f++) {
    const [from, to] = [baseAt(f - 1), baseAt(f)]
    const [yawFrom, yawTo] = [frames[f - 1].root.yaw, frames[f].root.yaw]
    for (let s = 1; s <= substeps; s++) {
      const u = s / substeps
      place(lerp(from, to, u), yawFrom + (yawTo - yawFrom) * u, (f - 1 + u) / fps, dt)
    }
    record(f)
  }
}

/**
 * Moves the joints of every appendage in the body-local poses (one per frame, from poseAt) with a damped angular
 * spring toward each segment's rest direction relative to its parent, plus the optional oscillator. The tips are
 * integrated in world space at `substeps` steps per frame, with the root joint, pelvis offset and yaw interpolated
 * between frames, and each tip is projected back to its bone length. Deterministic; returns the poses it changed.
 */
export function animateAppendages (frames: GaitFrame[], poses: Pose[], options: Options): Pose[] {
  const appendages = options.rig.limbs.filter((limb): limb is AppendageLimb => limb.kind === 'appendage')
  if (appendages.length === 0 || frames.length === 0) return poses
  for (const limb of appendages) animate(limb, frames, poses, options)
  return poses
}
