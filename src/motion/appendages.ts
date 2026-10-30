import type { AppendageLimb, Rig } from '../formats/rig.ts'
import { add, cross, dot, length, normalize, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { toLocal, toWorld } from '../sim/body.ts'
import type { GaitFrame } from './gait.ts'
import type { Pose } from './pose.ts'

type Options = { rig: Rig, rest: Pose, fps: number, substeps: number }
type Matrix = [Vec3, Vec3, Vec3]
type Segment = { length: number, rest: Vec3, tip: Vec3, velocity: Vec3, target: Vec3, frame: Matrix }

export const DEFAULT_APPENDAGE_SUBSTEPS = 8
const MIN_FREQUENCY = 0.3
const FREQUENCY_RANGE = 2.7
const PARALLEL_EPSILON = 1e-12
const IDENTITY: Matrix = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]

/** Natural frequency in Hz of an appendage spring: 0.3 Hz at stiffness 0 up to 3 Hz at stiffness 1. */
export function springFrequency (stiffness: number): number {
  return MIN_FREQUENCY + FREQUENCY_RANGE * stiffness
}

function apply (m: Matrix, v: Vec3): Vec3 {
  return [dot(m[0], v), dot(m[1], v), dot(m[2], v)]
}

function multiply (a: Matrix, b: Matrix): Matrix {
  const columns: Matrix = [[b[0][0], b[1][0], b[2][0]], [b[0][1], b[1][1], b[2][1]], [b[0][2], b[1][2], b[2][2]]]
  return a.map(row => columns.map(column => dot(row, column))) as Matrix
}

/** Rotation about the y axis by yaw, matching toWorld. */
function yawMatrix (yaw: number): Matrix {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]]
}

/** Rotation about the unit axis by angle radians (Rodrigues). */
function axisAngle (axis: Vec3, angle: number): Matrix {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const t = 1 - c
  const [x, y, z] = axis
  return [
    [c + x * x * t, x * y * t - z * s, x * z * t + y * s],
    [y * x * t + z * s, c + y * y * t, y * z * t - x * s],
    [z * x * t - y * s, z * y * t + x * s, c + z * z * t]
  ]
}

/** The smallest rotation that takes unit vector from onto unit vector to. */
function between (from: Vec3, to: Vec3): Matrix {
  const axis = cross(from, to)
  const sin = length(axis)
  if (sin < PARALLEL_EPSILON) return IDENTITY
  return axisAngle(scale(axis, 1 / sin), Math.atan2(sin, dot(from, to)))
}

function lerp (a: Vec3, b: Vec3, u: number): Vec3 {
  return add(a, scale(sub(b, a), u))
}

function oscillation (limb: AppendageLimb, time: number): number {
  const { oscillate } = limb
  if (oscillate === undefined || oscillate.degrees === 0 || oscillate.period === undefined) return 0
  return oscillate.degrees * Math.PI / 180 * Math.sin(2 * Math.PI * (time / oscillate.period + oscillate.phase))
}

/** Rotation from body rest space to world for the first segment's target: the oscillator, then the body's yaw. */
function rootFrame (limb: AppendageLimb, yaw: number, time: number): Matrix {
  const angle = oscillation(limb, time)
  if (angle === 0 || limb.oscillate === undefined) return yawMatrix(yaw)
  return multiply(yawMatrix(yaw), axisAngle(normalize(limb.oscillate.axis), angle))
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
    const zero: Vec3 = [0, 0, 0]
    return { length: length(bone), rest: normalize(bone), tip: zero, velocity: zero, target: zero, frame: IDENTITY }
  })
  const start = frames[0].root
  const startVelocity = (p: Vec3): Vec3 => {
    const r = sub(p, start.position)
    return add(start.velocity, scale([r[2], 0, -r[0]], start.angularVelocity))
  }
  const baseAt = (f: number): Vec3 => toWorld(add(rest[root], frames[f].pelvisOffset), frames[f].root)
  const place = (base: Vec3, yaw: number, time: number, step?: number): void => {
    let parent = rootFrame(limb, yaw, time)
    let from = base
    for (const segment of segments) {
      const direction = apply(parent, segment.rest)
      const goal = add(from, scale(direction, segment.length))
      if (step === undefined) {
        segment.tip = goal
        segment.target = goal
        segment.velocity = startVelocity(goal)
      } else springStep(segment, from, goal, limb, step)
      segment.frame = multiply(between(direction, normalize(sub(segment.tip, from))), parent)
      parent = segment.frame
      from = segment.tip
    }
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
 * spring toward each segment's rest direction relative to its parent, plus the optional oscillator on the first
 * segment. Each segment carries the rotation from rest to its current direction (its target's rotation followed by
 * the smallest swing to where the spring put it), and its children aim through that rotation. The tips are
 * integrated in world space at `substeps` steps per frame, with the root joint, pelvis offset and yaw interpolated
 * between frames, and each tip is projected back to its bone length. Deterministic; returns the poses it changed.
 */
export function animateAppendages (frames: GaitFrame[], poses: Pose[], options: Options): Pose[] {
  const appendages = options.rig.limbs.filter((limb): limb is AppendageLimb => limb.kind === 'appendage')
  if (appendages.length === 0 || frames.length === 0) return poses
  for (const limb of appendages) animate(limb, frames, poses, options)
  return poses
}
