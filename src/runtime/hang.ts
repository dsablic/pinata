import { add, dot, length, normalize, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { between, multiply, yawMatrix } from '../math/matrix.ts'
import type { Matrix } from '../math/matrix.ts'

export type HangSettings = {
  rope: number
  swingDamping: number
  twistStiffness: number
  twistDamping: number
  gravity: number
}
export type HangState = { anchor: Vec3, hook: Vec3, velocity: Vec3, twist: number, twistRate: number }
export type HangForces = { push: Vec3, torque: number }

const UP: Vec3 = [0, 1, 0]

export function restingHang (anchor: Vec3, settings: HangSettings): HangState {
  return { anchor, hook: sub(anchor, [0, settings.rope, 0]), velocity: [0, 0, 0], twist: 0, twistRate: 0 }
}

function taut (state: HangState, rope: number): void {
  const out = sub(state.hook, state.anchor)
  const along = length(out) > 0 ? normalize(out) : [0, -1, 0] as Vec3
  state.hook = add(state.anchor, scale(along, rope))
  state.velocity = sub(state.velocity, scale(along, dot(state.velocity, along)))
}

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

export function kick (state: HangState, impulse: Vec3, spin: number, settings: HangSettings): void {
  state.velocity = add(state.velocity, impulse)
  state.twistRate += spin
  taut(state, settings.rope)
}

export function hold (state: HangState, point: Vec3, settings: HangSettings): void {
  state.hook = point
  state.velocity = [0, 0, 0]
  taut(state, settings.rope)
}

export function hangRotation (state: HangState): Matrix {
  return multiply(between(UP, normalize(sub(state.anchor, state.hook))), yawMatrix(state.twist))
}

export function swingDegrees (state: HangState): number {
  const down = normalize(sub(state.hook, state.anchor))
  return Math.acos(Math.min(1, Math.max(-1, -down[1]))) * 180 / Math.PI
}
