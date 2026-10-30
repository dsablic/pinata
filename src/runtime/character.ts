import type { Mannequin } from '../formats/mannequin.ts'
import type { AppendageLimb, Rig } from '../formats/rig.ts'
import { add, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { apply } from '../math/matrix.ts'
import type { Matrix } from '../math/matrix.ts'
import { createSpringChain, startChain, stepChain } from '../motion/appendages.ts'
import type { SpringChain } from '../motion/appendages.ts'
import type { Pose } from '../motion/pose.ts'
import { hierarchyOrder, parentsOf } from '../motion/skeleton.ts'
import type { Parents } from '../motion/skeleton.ts'
import type { Behaviours, Event } from './behaviours.ts'
import { createDirector } from './director.ts'
import type { Directions } from './director.ts'
import { hangRotation, hold, kick, restingHang, stepHang, swingDegrees } from './hang.ts'
import type { HangSettings, HangState } from './hang.ts'

export type LiveOptions = {
  fps: number
  substeps: number
  reduced: boolean
  /** Where the rope is tied, in world space. */
  anchor: Vec3
  gravity: number
  /** Steady wind acceleration on the hook, m/s^2. */
  wind: Vec3
}
export type LiveFrame = {
  index: number
  time: number
  joints: Pose
  rotation: Matrix
  anchor: Vec3
  hook: Vec3
  swing: number
  twist: number
  behaviour: string
}
/** Tweakable settings, read every step (a demo page can change them live). */
export type LiveSettings = HangSettings & { wind: Vec3, limbStiffness: number, limbDamping: number }

export type Live = {
  settings: LiveSettings
  step: () => LiveFrame
  play: (name: string, blend?: number) => void
  dispatch: (event: string) => boolean
  hit: (impulse?: Vec3, spin?: number) => void
  /** Holds the hook at a point (dragging), or lets go with undefined. */
  grab: (point: Vec3 | undefined) => void
  frame: () => LiveFrame
}

const SPIN_GAIN = 8
const DEFAULT_BLEND = 0.3
const DEFAULT_HIT: Event = { at: 0, do: 'hit', impulse: [1.3, 0, 0], spin: 2.2 }

/** Joints a mask names: 'body' is the pelvis and upperBody, a limb name its joints, a joint name its subtree. */
export function maskJoints (mask: readonly string[], rig: Rig, parents: Parents): Set<string> {
  const joints = new Set<string>()
  const below = (joint: string): boolean => {
    for (let j: string | undefined = joint; j !== undefined; j = parents[j]) if (mask.includes(j)) return true
    return false
  }
  for (const name of mask) {
    if (name === 'body') for (const j of [rig.pelvis, ...rig.upperBody]) joints.add(j)
    const limb = rig.limbs.find(l => l.name === name)
    if (limb !== undefined) for (const j of limb.joints) joints.add(j)
  }
  for (const joint of Object.keys(parents)) if (below(joint)) joints.add(joint)
  return joints
}

/** Every leg and arm hangs limp: it becomes a spring chain from its first joint, like an appendage. */
function hangingChains (rig: Rig, settings: LiveSettings): AppendageLimb[] {
  return rig.limbs.map(limb => {
    if (limb.kind === 'appendage') return limb
    return {
      kind: 'appendage', name: limb.name, joints: limb.joints, stiffness: settings.limbStiffness,
      damping: settings.limbDamping
    }
  })
}

/**
 * A character hanging from a rope, driven live one frame at a time by a behaviours file: swing and twist from the
 * rope, limp legs, mane and tail as spring chains, behaviours as forces and offsets, and events such as hits.
 * Deterministic: the same calls in the same frames give the same frames.
 */
export function createLive (
  character: { mannequin: Mannequin, rig: Rig },
  spec: Behaviours,
  options: LiveOptions
): Live {
  const { mannequin, rig } = character
  const rest = mannequin.joints
  const hookRest = add(rest[spec.hang.joint], spec.hang.offset)
  const settings: LiveSettings = {
    rope: spec.hang.rope,
    swingDamping: spec.hang.swingDamping,
    twistStiffness: spec.hang.twistStiffness,
    twistDamping: spec.hang.twistDamping,
    gravity: options.gravity,
    wind: options.wind,
    limbStiffness: spec.hang.limbStiffness,
    limbDamping: spec.hang.limbDamping
  }
  const director = createDirector(spec, { reduced: options.reduced })
  const parents = parentsOf(rig)
  const order = hierarchyOrder(parents)
  const rigid = new Set([rig.pelvis, ...rig.upperBody])
  const limbs = hangingChains(rig, settings)
  const chains = new Map<string, SpringChain>(limbs.map(limb => [limb.joints[0], createSpringChain(limb, rest)]))
  const chainJoints = new Set(limbs.flatMap(limb => limb.joints.slice(1)))
  const masks = new Map<string[], Set<string>>()
  const state: HangState = restingHang(options.anchor, settings)
  const dt = 1 / (options.fps * options.substeps)
  let index = 0
  let held: Vec3 | undefined
  let pending: Event[] = []
  let directions: Directions = director.update(0)
  let started = false

  const maskOf = (mask: string[]): Set<string> => {
    let joints = masks.get(mask)
    if (joints === undefined) {
      joints = maskJoints(mask, rig, parents)
      masks.set(mask, joints)
    }
    return joints
  }

  /** World positions and rotations of every joint for the current hang state, stepping the chains by `step`. */
  const place = (time: number, step: number | undefined): { joints: Pose, rotation: Matrix } => {
    const rotation = hangRotation(state)
    const along = scale(sub(state.anchor, state.hook), 1 / settings.rope)
    const origin = add(state.hook, scale(along, directions.bounce))
    const up = apply(rotation, [0, 1, 0])
    const joints: Pose = {}
    const turns: Record<string, Matrix> = {}
    const breathe = (joint: string): Vec3 => {
      let offset = 0
      for (const b of directions.breathe) if (maskOf(b.mask).has(joint)) offset += b.offset
      return scale(up, offset)
    }
    for (const joint of order) {
      if (chainJoints.has(joint)) continue
      const parent = parents[joint]
      if (rigid.has(joint) || parent === undefined) {
        joints[joint] = add(add(origin, apply(rotation, sub(rest[joint], hookRest))), breathe(joint))
        turns[joint] = rotation
      } else {
        const turn = turns[parent]
        joints[joint] = add(add(joints[parent], apply(turn, sub(rest[joint], rest[parent]))), breathe(joint))
        turns[joint] = turn
      }
      const chain = chains.get(joint)
      if (chain === undefined) continue
      if (step === undefined) startChain(chain, joints[joint], turns[joint], time, () => [0, 0, 0])
      else stepChain(chain, joints[joint], turns[joint], time, step)
      chain.segments.forEach((segment, i) => {
        const tip = chain.limb.joints[i + 1]
        joints[tip] = segment.tip
        turns[tip] = segment.frame
      })
    }
    return { joints, rotation }
  }

  const snapshot = (time: number, placed: { joints: Pose, rotation: Matrix }): LiveFrame => ({
    index,
    time,
    joints: placed.joints,
    rotation: placed.rotation,
    anchor: state.anchor,
    hook: state.hook,
    swing: swingDegrees(state),
    twist: state.twist,
    behaviour: director.current()
  })
  let last: LiveFrame = snapshot(0, place(0, undefined))
  started = true

  return {
    settings,
    play: (name, blend = DEFAULT_BLEND) => { director.play(name, blend, index / options.fps) },
    dispatch: event => director.dispatch(event, index / options.fps),
    hit: (impulse = DEFAULT_HIT.impulse, spin = DEFAULT_HIT.spin) => {
      const factor = options.reduced ? 0.4 : 1
      pending.push({ at: 0, do: 'hit', impulse: scale(impulse, factor), spin: spin * factor })
    },
    grab: point => { held = point },
    frame: () => last,
    step: () => {
      if (!started) throw new Error('not started')
      index++
      const time = index / options.fps
      directions = director.update(time)
      for (const event of [...directions.events, ...pending]) kick(state, event.impulse, event.spin, settings)
      pending = []
      let placed = { joints: last.joints, rotation: last.rotation }
      for (let s = 1; s <= options.substeps; s++) {
        const t = (index - 1 + s / options.substeps) / options.fps
        const { spin } = directions
        const drive = SPIN_GAIN * (spin.rate - state.twistRate) + settings.twistStiffness * state.twist
        const torque = spin.weight * drive
        const push = add(directions.push, settings.wind)
        if (held === undefined) stepHang(state, settings, { push, torque }, dt)
        else hold(state, held, settings)
        placed = place(t, dt)
      }
      last = snapshot(time, placed)
      return last
    }
  }
}
