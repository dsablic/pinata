import { armsOf, legsOf } from '../formats/rig.ts'
import type { Rig } from '../formats/rig.ts'
import { apply, between, IDENTITY, interpolate, multiply, toAxisAngle, transpose } from '../math/matrix.ts'
import type { Matrix } from '../math/matrix.ts'
import { add, normalize, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { turnBetween, turnToLocal, turnToWorld } from '../world/yaw.ts'
import { spanKey } from './span.ts'
import type { BodyFrame } from './retarget.ts'

export type Cycle = { from: number, to: number }
export type ClosedCycle = { frames: BodyFrame[], travel: Vec3 }
export type Mirror = { joints: Record<string, string>, legs: number[], aims: Record<string, Vec3> }

const SHORTEST_CYCLE_SECONDS = 0.5
const SHORTER_CYCLE_SLACK = 1.5
const SHORTEST_RUN = 3
const FLIP: Matrix = [[-1, 0, 0], [0, 1, 0], [0, 0, 1]]

export function sampleFrame (frames: BodyFrame[], t: number): BodyFrame {
  const i = Math.floor(t)
  const a = frames[Math.min(Math.max(i, 0), frames.length - 1)]
  const b = frames[Math.min(Math.max(i + 1, 0), frames.length - 1)]
  const u = t - i
  if (u <= 0 || a === b) return a
  const rotations: Record<string, Matrix> = {}
  for (const joint of Object.keys(a.rotations)) {
    rotations[joint] = interpolate(a.rotations[joint], b.rotations[joint], u)
  }
  return {
    rotations,
    root: {
      position: add(a.root.position, scale(sub(b.root.position, a.root.position), u)),
      yaw: a.root.yaw + turnBetween(a.root.yaw, b.root.yaw) * u,
      velocity: add(a.root.velocity, scale(sub(b.root.velocity, a.root.velocity), u)),
      angularVelocity: a.root.angularVelocity + (b.root.angularVelocity - a.root.angularVelocity) * u
    },
    clearance: {
      left: a.clearance.left + (b.clearance.left - a.clearance.left) * u,
      right: a.clearance.right + (b.clearance.right - a.clearance.right) * u
    },
    contact: u < 0.5 ? a.contact : b.contact
  }
}

function turnApart (a: BodyFrame, b: BodyFrame): number {
  let sum = 0
  for (const [joint, rotation] of Object.entries(a.rotations)) {
    sum += toAxisAngle(multiply(b.rotations[joint], transpose(rotation))).angle ** 2
  }
  return sum
}

function sameContact (a: BodyFrame, b: BodyFrame): boolean {
  return a.contact.every((down, k) => down === b.contact[k])
}

function miss (frames: BodyFrame[], from: number, to: number): number {
  return turnApart(frames[from], frames[to]) + turnApart(frames[from + 1], frames[to + 1])
}

export function cycleOf (frames: BodyFrame[], fps: number): Cycle {
  const shortest = Math.round(SHORTEST_CYCLE_SECONDS * fps)
  const found: Array<Cycle & { miss: number }> = []
  for (let from = 0; from + shortest + 1 < frames.length; from++) {
    for (let to = from + shortest; to + 1 < frames.length; to++) {
      const phased = sameContact(frames[from], frames[to]) && sameContact(frames[from + 1], frames[to + 1])
      if (phased) found.push({ from, to, miss: miss(frames, from, to) })
    }
  }
  if (found.length === 0) throw new Error('a looping take needs two frames a cycle apart in the same stance')
  const best = Math.min(...found.map(c => c.miss))
  const near = found.filter(c => c.miss <= best * SHORTER_CYCLE_SLACK)
  const chosen = near.reduce((a, b) => {
    const [la, lb] = [a.to - a.from, b.to - b.from]
    return lb < la || (lb === la && b.miss < a.miss) ? b : a
  })
  return { from: chosen.from, to: chosen.to }
}

function closedRoots (frames: BodyFrame[], drift: number, fps: number): Array<BodyFrame['root']> {
  const last = frames.length - 1
  const yaws = frames.map((frame, k) => frame.root.yaw + drift * k / last)
  const steps = frames.slice(1).map((frame, k) => {
    return turnToLocal(sub(frame.root.position, frames[k].root.position), frames[k].root.yaw)
  })
  return rootsAlong(steps, yaws, frames[0].root.position, fps)
}

function rootsAlong (steps: Vec3[], yaws: number[], start: Vec3, fps: number): Array<BodyFrame['root']> {
  const last = yaws.length - 1
  const positions: Vec3[] = [start]
  for (let k = 1; k <= last; k++) positions.push(add(positions[k - 1], turnToWorld(steps[k - 1], yaws[k - 1])))
  const travel = sub(positions[last], positions[0])
  const at = (k: number): Vec3 => k < 0 ? sub(positions[last + k], travel)
    : k > last ? add(positions[k - last], travel) : positions[k]
  const yawAt = (k: number): number => yaws[((k % last) + last) % last]
  return yaws.map((_, k) => ({
    position: positions[k],
    yaw: yaws[k],
    velocity: scale(sub(at(k + 1), at(k - 1)), fps / 2),
    angularVelocity: turnBetween(yawAt(k - 1), yawAt(k + 1)) * fps / 2
  }))
}

export function closedCycle (frames: BodyFrame[], { from, to }: Cycle, fps: number): ClosedCycle {
  const span = frames.slice(from, to + 1)
  const last = span.length - 1
  const [first, end] = [span[0], span[last]]
  const turns = Object.fromEntries(Object.keys(first.rotations).map(joint => {
    return [joint, multiply(first.rotations[joint], transpose(end.rotations[joint]))]
  }))
  const roots = closedRoots(span, turnBetween(end.root.yaw, first.root.yaw), fps)
  const closed = span.map((frame, k): BodyFrame => {
    const u = k / last
    const rotations = Object.fromEntries(Object.entries(frame.rotations).map(([joint, rotation]) => {
      return [joint, multiply(interpolate(IDENTITY, turns[joint], u), rotation)]
    }))
    const side = (key: 'left' | 'right'): number => {
      return frame.clearance[key] + (first.clearance[key] - end.clearance[key]) * u
    }
    const clearance = { left: side('left'), right: side('right') }
    return { rotations, root: roots[k], clearance, contact: frame.contact }
  })
  return { frames: closed, travel: sub(roots[last].position, roots[0].position) }
}

export function mirrorOf (rig: Rig, aims: Record<string, Vec3> = {}): Mirror | undefined {
  const joints: Record<string, string> = {}
  const pair = <T extends { side: string, joints: string[] }>(limbs: T[]): boolean => {
    const [left, right] = (['left', 'right'] as const).map(side => limbs.filter(limb => limb.side === side))
    if (left.length !== right.length || left.length + right.length !== limbs.length) return false
    left.forEach((limb, i) => limb.joints.forEach((joint, k) => {
      const other = right[i].joints[k]
      if (other === undefined) return
      for (const [a, b] of [[joint, other], [spanKey(joint), spanKey(other)]]) Object.assign(joints, { [a]: b, [b]: a })
    }))
    return left.every((limb, i) => limb.joints.length === right[i].joints.length)
  }
  const legs = legsOf(rig)
  if (!pair(legs) || !pair(armsOf(rig))) return undefined
  return { joints, legs: legs.map(leg => legs.findIndex(other => other.hip === joints[leg.hip])), aims }
}

function mirrored (frame: BodyFrame, mirror: Mirror): BodyFrame {
  const rotations: Record<string, Matrix> = {}
  for (const [joint, rotation] of Object.entries(frame.rotations)) {
    const other = mirror.joints[joint] ?? joint
    const [from, to] = [mirror.aims[joint], mirror.aims[other]]
    rotations[other] = from === undefined || to === undefined
      ? multiply(FLIP, multiply(rotation, FLIP))
      : between(to, normalize(flipped(apply(rotation, from))))
  }
  const clearance = { left: frame.clearance.right, right: frame.clearance.left }
  return { ...frame, rotations, clearance, contact: mirror.legs.map(k => frame.contact[k]) }
}

function flipped (v: Vec3): Vec3 {
  return [-v[0], v[1], v[2]]
}

export function symmetricCycle ({ frames, travel }: ClosedCycle, mirror: Mirror, fps: number): ClosedCycle {
  const last = frames.length - 1
  const even = 2 * Math.round(last / 2)
  const half = even / 2
  const at = (k: number): BodyFrame => sampleFrame(frames, ((((k % even) + even) % even) * last) / even)
  const shift = (k: number): Vec3 => {
    const wrapped = ((k % even) + even) % even
    return add(at(wrapped).root.position, scale(travel, Math.floor(k / even)))
  }
  const yaw = frames[0].root.yaw
  const turnOf = (k: number): number => turnBetween(yaw, at(k).root.yaw)
  const yaws = Array.from({ length: even + 1 }, (_, k) => yaw + (turnOf(k) - turnOf(k - half)) / 2)
  const stepOf = (k: number): Vec3 => turnToLocal(sub(shift(k + 1), shift(k)), at(k).root.yaw)
  const steps = Array.from({ length: even }, (_, k) => scale(add(stepOf(k), flipped(stepOf(k - half))), 0.5))
  const roots = rootsAlong(steps, yaws, frames[0].root.position, fps)
  const cycle = roots.map((root, k): BodyFrame => {
    const own = at(k)
    const other = mirrored(at(k - half), mirror)
    const rotations = Object.fromEntries(Object.entries(own.rotations).map(([joint, rotation]) => {
      return [joint, interpolate(rotation, other.rotations[joint], 0.5)]
    }))
    const side = (key: 'left' | 'right'): number => (own.clearance[key] + other.clearance[key]) / 2
    const contact = own.contact.map((down, leg) => down && other.contact[leg])
    return { rotations, root, clearance: { left: side('left'), right: side('right') }, contact }
  })
  return { frames: steadied(cycle), travel: sub(roots[even].position, roots[0].position) }
}

function flipShort (flags: boolean[], value: boolean): boolean[] {
  const count = flags.length
  const start = flags.findIndex((flag, i) => flag !== flags[(i + count - 1) % count])
  if (start < 0) return flags
  const out = [...flags]
  for (let from = start; from < start + count;) {
    let to = from
    while (to < start + count && flags[to % count] === flags[from % count]) to++
    if (flags[from % count] === value && to - from < SHORTEST_RUN) {
      for (let i = from; i < to; i++) out[i % count] = !value
    }
    from = to
  }
  return out
}

function steadied (frames: BodyFrame[]): BodyFrame[] {
  const lap = frames.slice(0, -1)
  const legs = lap[0].contact.map((_, leg) => {
    return flipShort(flipShort(lap.map(frame => frame.contact[leg]), false), true)
  })
  const contact = (i: number): boolean[] => legs.map(flags => flags[i % lap.length])
  return frames.map((frame, i) => ({ ...frame, contact: contact(i) }))
}
