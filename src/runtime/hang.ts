import { add, dot, length, normalize, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { between, multiply, yawMatrix } from '../math/matrix.ts'
import type { Matrix } from '../math/matrix.ts'

/** A body hanging from a fixed anchor on a taut rope, with a twist spring about the rope. */
export type HangSettings = {
  /** Rope length in metres, from the anchor to the hook on the body. */
  rope: number
  /** Swing damping per second. */
  swingDamping: number
  /** Twist spring stiffness (per second squared) and damping (per second) about the rope. */
  twistStiffness: number
  twistDamping: number
  gravity: number
}
export type HangState = { anchor: Vec3, hook: Vec3, velocity: Vec3, twist: number, twistRate: number }
/** Extra horizontal acceleration on the hook (m/s^2) and twist acceleration (rad/s^2) for one step. */
export type HangForces = { push: Vec3, torque: number }

const UP: Vec3 = [0, 1, 0]

export function restingHang (anchor: Vec3, settings: HangSettings): HangState {
  return { anchor, hook: sub(anchor, [0, settings.rope, 0]), velocity: [0, 0, 0], twist: 0, twistRate: 0 }
}

/** Keeps the hook on the rope's sphere and removes the velocity along the rope. */
function taut (state: HangState, rope: number): void {
  const out = sub(state.hook, state.anchor)
  const along = length(out) > 0 ? normalize(out) : [0, -1, 0] as Vec3
  state.hook = add(state.anchor, scale(along, rope))
  state.velocity = sub(state.velocity, scale(along, dot(state.velocity, along)))
}

/** Advances the swing and the twist by dt seconds (semi-implicit Euler, then the rope constraint). */
export function stepHang (state: HangState, settings: HangSettings, forces: HangForces, dt: number): void {
  const gravity: Vec3 = [0, -settings.gravity, 0]
  const acceleration = add(gravity, forces.push)
  const keep = Math.exp(-settings.swingDamping * dt)
  state.velocity = scale(add(state.velocity, scale(acceleration, dt)), keep)
  const before = state.hook
  state.hook = add(state.hook, scale(state.velocity, dt))
  taut(state, settings.rope)
  state.velocity = scale(sub(state.hook, before), 1 / dt)
  const twistAcceleration = -settings.twistStiffness * state.twist - settings.twistDamping * state.twistRate +
    forces.torque
  state.twistRate += twistAcceleration * dt
  state.twist += state.twistRate * dt
}

/** An instant change of the hook's velocity (m/s) and of the twist rate (rad/s), as from a hit. */
export function kick (state: HangState, impulse: Vec3, spin: number, settings: HangSettings): void {
  state.velocity = add(state.velocity, impulse)
  state.twistRate += spin
  taut(state, settings.rope)
}

/** Moves the hook toward a held point on the rope's sphere and stops it there, as when the body is dragged. */
export function hold (state: HangState, point: Vec3, settings: HangSettings): void {
  state.hook = point
  state.velocity = [0, 0, 0]
  taut(state, settings.rope)
}

/** The body's rotation: the rope tilts the body's up axis toward the anchor, after the twist about it. */
export function hangRotation (state: HangState): Matrix {
  return multiply(between(UP, normalize(sub(state.anchor, state.hook))), yawMatrix(state.twist))
}

/** Swing angle of the rope from the vertical, in degrees. */
export function swingDegrees (state: HangState): number {
  const down = normalize(sub(state.hook, state.anchor))
  return Math.acos(Math.min(1, Math.max(-1, -down[1]))) * 180 / Math.PI
}
