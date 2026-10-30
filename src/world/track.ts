import type { Vec3 } from '../math/vec.ts'
import type { RootState } from '../motion/script.ts'

/** One piece of a root's motion: turn in place to a yaw, walk straight to a point on the x axis, or stand. */
export type Move =
  | { kind: 'turn', yaw: number, seconds: number }
  | { kind: 'walk', x: number, speed: number }
  | { kind: 'stand', seconds: number }

type Piece = { start: number, end: number, from: RootState, move: Move, ease: number }

const ACCEL_SECONDS = 0.6

function smoothstep (u: number): number {
  const c = Math.min(1, Math.max(0, u))
  return c * c * (3 - 2 * c)
}

/** Integral of smoothstep from 0 to u, for u in [0, 1]. */
function smoothstepArea (u: number): number {
  const c = Math.min(1, Math.max(0, u))
  return c * c * c - c * c * c * c / 2
}

/** The shortest signed angle from a to b. */
export function turnBetween (a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a))
}

/** The easing time of a walk: ACCEL_SECONDS, or less for a walk too short to reach its speed. */
function easeOf (distance: number, speed: number): number {
  return Math.min(ACCEL_SECONDS, distance / speed)
}

function stateIn (piece: Piece, t: number): RootState {
  const { from, move } = piece
  const local = Math.min(Math.max(t - piece.start, 0), piece.end - piece.start)
  if (move.kind === 'stand') return { ...from, velocity: [0, 0, 0], angularVelocity: 0 }
  if (move.kind === 'turn') {
    const turn = turnBetween(from.yaw, move.yaw)
    const u = local / move.seconds
    const rate = turn * (6 * u * (1 - u)) / move.seconds
    return { position: from.position, yaw: from.yaw + turn * smoothstep(u), velocity: [0, 0, 0], angularVelocity: rate }
  }
  const total = piece.end - piece.start
  const sign = Math.sign(move.x - from.position[0])
  const { ease } = piece
  const ramp = (u: number): number => ease > 0 ? smoothstep(u / ease) : 1
  const speed = move.speed * Math.min(ramp(local), ramp(total - local))
  const travelled = ease === 0 ? move.speed * local : move.speed * (
    local <= ease ? ease * smoothstepArea(local / ease)
      : local <= total - ease ? ease / 2 + (local - ease)
        : total - ease - ease * smoothstepArea((total - local) / ease)
  )
  const position: Vec3 = [from.position[0] + sign * travelled, from.position[1], from.position[2]]
  return { position, yaw: from.yaw, velocity: [sign * speed, 0, 0], angularVelocity: 0 }
}

/**
 * A root track through a list of moves from a starting state, and its length in seconds. Walks ease in and out, so a
 * walk of distance d at speed v takes d / v + e seconds (e is 0.6 s, or d / v if shorter) and covers exactly d; turns
 * ease over their seconds.
 */
export function trackOf (start: RootState, moves: Move[]): { track: (t: number) => RootState, seconds: number } {
  const pieces: Piece[] = []
  let time = 0
  let state: RootState = { ...start, velocity: [0, 0, 0], angularVelocity: 0 }
  for (const move of moves) {
    const distance = move.kind === 'walk' ? Math.abs(move.x - state.position[0]) : 0
    const ease = move.kind === 'walk' ? easeOf(distance, move.speed) : 0
    const seconds = move.kind === 'walk' ? distance / move.speed + ease : move.seconds
    if (seconds <= 0) continue
    const piece: Piece = { start: time, end: time + seconds, from: state, move, ease }
    pieces.push(piece)
    time += seconds
    state = stateIn(piece, piece.end)
  }
  const last = state
  const track = (t: number): RootState => {
    const piece = pieces.find(p => t < p.end)
    return piece === undefined ? last : stateIn(piece, t)
  }
  return { track, seconds: time }
}
