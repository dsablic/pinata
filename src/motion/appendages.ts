import type { AppendageLimb, Rig } from '../formats/rig.ts'
import { add, length, normalize, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { apply, axisAngle, between, IDENTITY, interpolate, multiply, yawMatrix } from '../math/matrix.ts'
import type { Matrix } from '../math/matrix.ts'
import { toLocal, toWorld } from '../sim/body.ts'
import type { GaitFrame } from './gait.ts'
import type { Pose } from './pose.ts'
import { hierarchyOrder, inherit, parentsOf, transformTo } from './skeleton.ts'
import type { Transforms } from './skeleton.ts'

type Options = { rig: Rig, rest: Pose, fps: number, substeps: number }
type Segment = { length: number, rest: Vec3, tip: Vec3, velocity: Vec3, target: Vec3, frame: Matrix }

export const DEFAULT_APPENDAGE_SUBSTEPS = 8
const MIN_FREQUENCY = 0.3
const FREQUENCY_RANGE = 2.7
/** Natural frequency in Hz of an appendage spring: 0.3 Hz at stiffness 0 up to 3 Hz at stiffness 1. */
export function springFrequency (stiffness: number): number {
  return MIN_FREQUENCY + FREQUENCY_RANGE * stiffness
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
 * Rotation from body rest space to world for the first segment's target: the oscillator, then `body` (the rotation
 * of the joint the chain hangs from, rest space to world).
 */
function rootFrame (limb: AppendageLimb, body: Matrix, time: number): Matrix {
  const angle = oscillation(limb, time)
  if (angle === 0 || limb.oscillate === undefined) return body
  return multiply(body, axisAngle(normalize(limb.oscillate.axis), angle))
}

/** The yaw of the body after a parent joint's rotation within the body (none for a joint rigid with the body). */
export function bodyFrame (yaw: number, parent: Matrix | undefined): Matrix {
  return parent === undefined ? yawMatrix(yaw) : multiply(yawMatrix(yaw), parent)
}

/** A spring chain's state: one rigid segment per bone, each with its tip, velocity, target and rotation. */
export type SpringChain = { limb: AppendageLimb, segments: Segment[] }

export function createSpringChain (limb: AppendageLimb, rest: Pose): SpringChain {
  const segments: Segment[] = limb.joints.slice(1).map((joint, i) => {
    const bone = sub(rest[joint], rest[limb.joints[i]])
    const zero: Vec3 = [0, 0, 0]
    return { length: length(bone), rest: normalize(bone), tip: zero, velocity: zero, target: zero, frame: IDENTITY }
  })
  return { limb, segments }
}

/**
 * Places the chain at rest on its targets (step undefined; tips start with `velocity(tip)`), or advances it one
 * spring step of `step` seconds, with its root at `base` and `body` the rotation of the joint it hangs from.
 */
function placeChain (
  chain: SpringChain,
  base: Vec3,
  body: Matrix,
  time: number,
  options: { step?: number, velocity?: (tip: Vec3) => Vec3 }
): void {
  const { limb, segments } = chain
  let frame = rootFrame(limb, body, time)
  let from = base
  for (const segment of segments) {
    const direction = apply(frame, segment.rest)
    const goal = add(from, scale(direction, segment.length))
    if (options.step === undefined) {
      segment.tip = goal
      segment.target = goal
      segment.velocity = options.velocity?.(goal) ?? [0, 0, 0]
    } else springStep(segment, from, goal, limb, options.step)
    segment.frame = multiply(between(direction, normalize(sub(segment.tip, from))), frame)
    frame = segment.frame
    from = segment.tip
  }
}

export function startChain (
  chain: SpringChain,
  base: Vec3,
  body: Matrix,
  time: number,
  velocity: (tip: Vec3) => Vec3
): void {
  placeChain(chain, base, body, time, { velocity })
}

export function stepChain (chain: SpringChain, base: Vec3, body: Matrix, time: number, dt: number): void {
  placeChain(chain, base, body, time, { step: dt })
}

function parentRotation (from: Matrix | undefined, to: Matrix | undefined, u: number): Matrix | undefined {
  if (from === undefined && to === undefined) return undefined
  return interpolate(from ?? IDENTITY, to ?? IDENTITY, u)
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

export type Sequence = { frames: GaitFrame[], poses: Pose[], transforms: Transforms[] }

function animate (limb: AppendageLimb, sequence: Sequence, parent: string, options: Options): void {
  const { frames, poses, transforms } = sequence
  const { rest, fps, substeps } = options
  const root = limb.joints[0]
  const chain = createSpringChain(limb, rest)
  const { segments } = chain
  const start = frames[0].root
  const baseAt = (f: number): Vec3 => toWorld(poses[f][root], frames[f].root)
  const rotationAt = (f: number): Matrix | undefined => transforms[f][parent]?.rotation
  const moving = frames.length > 1 && (rotationAt(0) !== undefined || rotationAt(1) !== undefined)
  const startVelocity = (p: Vec3): Vec3 => {
    if (moving) return scale(sub(baseAt(1), baseAt(0)), fps)
    const r = sub(p, start.position)
    return add(start.velocity, scale([r[2], 0, -r[0]], start.angularVelocity))
  }
  const record = (f: number): void => {
    const unyaw = yawMatrix(-frames[f].root.yaw)
    segments.forEach((segment, i) => { poses[f][limb.joints[i + 1]] = toLocal(segment.tip, frames[f].root) })
    limb.joints.forEach((joint, i) => {
      const bone = segments[Math.min(i, segments.length - 1)]
      transforms[f][joint] = transformTo(multiply(unyaw, bone.frame), rest[joint], poses[f][joint])
    })
  }
  startChain(chain, baseAt(0), bodyFrame(start.yaw, rotationAt(0)), 0, startVelocity)
  record(0)
  const dt = 1 / (fps * substeps)
  for (let f = 1; f < frames.length; f++) {
    const [from, to] = [baseAt(f - 1), baseAt(f)]
    const [yawFrom, yawTo] = [frames[f - 1].root.yaw, frames[f].root.yaw]
    const [turnFrom, turnTo] = [rotationAt(f - 1), rotationAt(f)]
    for (let s = 1; s <= substeps; s++) {
      const u = s / substeps
      const body = bodyFrame(yawFrom + (yawTo - yawFrom) * u, parentRotation(turnFrom, turnTo, u))
      stepChain(chain, lerp(from, to, u), body, (f - 1 + u) / fps, dt)
    }
    record(f)
  }
}

/**
 * Moves the joints of every appendage in the body-local poses and transforms (one per frame, from poseAt) with a
 * damped angular spring toward each segment's rest direction relative to its parent, plus the optional oscillator on
 * the first segment. The first segment's parent is the joint the appendage hangs from, so it turns with that joint.
 * Each segment carries the rotation from rest to its current direction (its target's rotation followed by the
 * smallest swing to where the spring put it), and its children aim through that rotation. The tips are integrated in
 * world space at `substeps` steps per frame, with the root joint, the parent's rotation and yaw interpolated between
 * frames, and each tip is projected back to its bone length. Every appendage joint turns with the segment that leaves
 * it (the tip with the last segment), as leg joints do. Appendages run parents first; after each, the joints attached
 * below it are placed again. An appendage on a joint that turns starts moving with that joint's first-frame velocity.
 * Deterministic; changes the poses and transforms in place.
 */
export function animateAppendages (sequence: Sequence, options: Options): void {
  const { rig, rest } = options
  const appendages = rig.limbs.filter((limb): limb is AppendageLimb => limb.kind === 'appendage')
  if (appendages.length === 0 || sequence.frames.length === 0) return
  const parents = parentsOf(rig)
  const order = hierarchyOrder(parents)
  const undriven = new Set(Object.keys(rest).filter(joint => {
    return rig.attached?.[joint] !== undefined || appendages.some(limb => limb.joints[0] === joint)
  }))
  const driven = new Set(order.filter(joint => !undriven.has(joint)))
  const sorted = [...appendages].sort((a, b) => order.indexOf(a.joints[0]) - order.indexOf(b.joints[0]))
  for (const limb of sorted) {
    sequence.poses.forEach((pose, f) => {
      inherit(pose, sequence.transforms[f], { rest, parents, order, driven })
    })
    animate(limb, sequence, parents[limb.joints[0]] ?? rig.pelvis, options)
    driven.add(limb.joints[0])
  }
  if (rig.attached === undefined) return
  sequence.poses.forEach((pose, f) => { inherit(pose, sequence.transforms[f], { rest, parents, order, driven }) })
}
