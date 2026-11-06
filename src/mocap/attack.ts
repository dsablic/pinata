import { armsOf } from '../formats/rig.ts'
import type { Arm } from '../formats/limbs.ts'
import { axisAngle, between, interpolate, multiply } from '../math/matrix.ts'
import type { Matrix } from '../math/matrix.ts'
import { normalize, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import type { AttackKind } from './clip.ts'
import type { PerformanceTake } from './database.ts'
import { spanKey } from './span.ts'
import type { BodyFrame, RetargetOptions } from './retarget.ts'

type Reach = { upper: Vec3, fore: Vec3 }
type Key = { at: number, lean: number, arms: 'base' | 'draw' | 'strike' }
type Plan = { draw: Reach, strike: Reach, arms: (arms: Arm[]) => Arm[] }

const DEGREES = Math.PI / 180
const KEYS: Key[] = [
  { at: 0, lean: 0, arms: 'base' },
  { at: 0.35, lean: -8, arms: 'draw' },
  { at: 0.45, lean: -8, arms: 'draw' },
  { at: 0.6, lean: 10, arms: 'strike' },
  { at: 0.95, lean: 10, arms: 'strike' },
  { at: 1.5, lean: 0, arms: 'base' }
]
const STRIKE: Reach = { upper: [-0.12, 0.15, 1], fore: [-0.12, 0.2, 1] }
const PLANS: Partial<Record<AttackKind, Plan>> = {
  cast: { draw: { upper: [0.35, -0.55, -0.75], fore: [0.1, 0.85, 0.5] }, strike: STRIKE, arms: arms => arms },
  thrust: { draw: { upper: [0.2, -0.6, -0.75], fore: [0, 0.1, 1] }, strike: STRIKE, arms: arms => [weaponArm(arms)] }
}

function weaponArm (arms: Arm[]): Arm {
  return arms.find(arm => (arm.carried?.length ?? 0) > 0) ?? arms.find(arm => arm.side === 'right') ?? arms[0]
}

function sided (v: Vec3, arm: Arm): Vec3 {
  return normalize([arm.side === 'right' ? -v[0] : v[0], v[1], v[2]])
}

function smooth (u: number): number {
  return u * u * (3 - 2 * u)
}

function armTurns (arm: Arm, reach: Reach, options: RetargetOptions): Record<string, Matrix> {
  const { rest, map } = options
  const turns: Record<string, Matrix> = {}
  arm.joints.slice(0, -1).forEach((joint, i) => {
    if (map.aim[joint] === undefined) return
    const next = arm.joints[i + 1]
    turns[joint] = between(normalize(sub(rest[next], rest[joint])), sided(i === 0 ? reach.upper : reach.fore, arm))
  })
  return turns
}

function posed (base: BodyFrame, key: Key, turns: Record<string, Matrix>): Record<string, Matrix> {
  const rotations = { ...base.rotations }
  if (key.arms !== 'base') Object.assign(rotations, turns)
  return rotations
}

function leaned (rotations: Record<string, Matrix>, joints: string[], degrees: number): Record<string, Matrix> {
  const tilt = axisAngle([1, 0, 0], degrees * DEGREES)
  const out = { ...rotations }
  for (const joint of joints) if (out[joint] !== undefined) out[joint] = multiply(tilt, out[joint])
  return out
}

function frameAt (seconds: number, base: BodyFrame, keys: Array<Key & { turns: Record<string, Matrix> }>,
  torso: string[]): BodyFrame {
  const after = keys.findIndex(key => key.at > seconds)
  const next = after < 0 ? keys.length - 1 : Math.max(1, after)
  const [a, b] = [keys[next - 1], keys[next]]
  const u = smooth(Math.min(1, (seconds - a.at) / (b.at - a.at)))
  const from = leaned(posed(base, a, a.turns), torso, a.lean)
  const to = leaned(posed(base, b, b.turns), torso, b.lean)
  const rotations = Object.fromEntries(Object.keys(base.rotations).map(joint => {
    return [joint, interpolate(from[joint], to[joint], u)]
  }))
  return { ...base, rotations }
}

export function composedAttack (
  takes: PerformanceTake[], options: RetargetOptions, attack: AttackKind
): PerformanceTake | undefined {
  const plan = PLANS[attack]
  const idle = takes.find(take => take.kind === 'idle')
  if (plan === undefined || idle === undefined) return undefined
  const all = armsOf(options.rig)
  if (all.length === 0) return undefined
  const arms = plan.arms(all)
  const turnsOf = (reach: Reach): Record<string, Matrix> => {
    return Object.assign({}, ...arms.map(arm => armTurns(arm, reach, options)))
  }
  const keys = KEYS.map(key => ({ ...key, turns: key.arms === 'draw' ? turnsOf(plan.draw) : turnsOf(plan.strike) }))
  const chest = Object.entries(options.map.turn).find(([joint]) => options.map.span?.[joint] !== undefined)?.[0]
  const torso = chest === undefined ? [] : [chest, spanKey(chest)]
  const count = Math.round(KEYS[KEYS.length - 1].at * idle.fps) + 1
  const loop = idle.frames.length - 1
  const frames = Array.from({ length: count }, (_, k) => frameAt(k / idle.fps, idle.frames[k % loop], keys, torso))
  return { name: `attack-${attack}`, kind: 'attack', fps: idle.fps, frames, attack }
}
