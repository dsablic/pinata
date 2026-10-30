import type { Vec3 } from '../math/vec.ts'

export type Segment =
  | { action: 'move', speed: number, duration: number }
  | { action: 'turn', degrees: number, duration: number }
  | { action: 'hold', duration: number }

export type Script = { segments: Segment[], accelSeconds: number }

export type RootState = { position: Vec3, yaw: number, velocity: Vec3, angularVelocity: number }

const STEP = 1 / 960

type SpeedChange = { start: number, from: number, to: number }
type Turn = { start: number, duration: number, radians: number }

export function scriptDuration (script: Script): number {
  return script.segments.reduce((total, segment) => total + segment.duration, 0)
}

function smoothstep (x: number): number {
  const c = Math.min(1, Math.max(0, x))
  return c * c * (3 - 2 * c)
}

function smoothstepSlope (x: number): number {
  return x <= 0 || x >= 1 ? 0 : 6 * x * (1 - x)
}

function easing (change: SpeedChange, t: number, accelSeconds: number): number {
  if (accelSeconds <= 0) return t >= change.start ? change.to : change.from
  return smoothstep((t - change.start) / accelSeconds)
}

function speedAt (changes: SpeedChange[], t: number, accelSeconds: number): number {
  let current: SpeedChange | undefined
  for (const change of changes) {
    if (change.start <= t) current = change
  }
  if (current === undefined) return 0
  return current.from + (current.to - current.from) * easing(current, t, accelSeconds)
}

function plan (script: Script): { changes: SpeedChange[], turns: Turn[] } {
  const changes: SpeedChange[] = []
  const turns: Turn[] = []
  let start = 0
  for (const segment of script.segments) {
    if (segment.action === 'turn') {
      turns.push({ start, duration: segment.duration, radians: segment.degrees * Math.PI / 180 })
    } else {
      const to = segment.action === 'move' ? segment.speed : 0
      changes.push({ start, from: speedAt(changes, start, script.accelSeconds), to })
    }
    start += segment.duration
  }
  return { changes, turns }
}

function yawAt (turns: Turn[], t: number): number {
  return turns.reduce((yaw, turn) => yaw + turn.radians * smoothstep((t - turn.start) / turn.duration), 0)
}

function yawRateAt (turns: Turn[], t: number): number {
  return turns.reduce((rate, turn) => {
    return rate + turn.radians * smoothstepSlope((t - turn.start) / turn.duration) / turn.duration
  }, 0)
}

export function rootAt (script: Script, t: number): RootState {
  const { changes, turns } = plan(script)
  const duration = scriptDuration(script)
  const end = Math.min(Math.max(t, 0), duration)
  let x = 0
  let z = 0
  for (let time = 0; time < end; time += STEP) {
    const h = Math.min(STEP, end - time)
    const mid = time + h / 2
    const speed = speedAt(changes, mid, script.accelSeconds)
    const yaw = yawAt(turns, mid)
    x += speed * Math.sin(yaw) * h
    z += speed * Math.cos(yaw) * h
  }
  const yaw = yawAt(turns, end)
  if (t >= duration) return { position: [x, 0, z], yaw, velocity: [0, 0, 0], angularVelocity: 0 }
  const speed = speedAt(changes, end, script.accelSeconds)
  return {
    position: [x, 0, z],
    yaw,
    velocity: [speed * Math.sin(yaw), 0, speed * Math.cos(yaw)],
    angularVelocity: yawRateAt(turns, end)
  }
}
