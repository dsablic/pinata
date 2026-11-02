import type { Mannequin } from '../formats/mannequin.ts'
import type { AppendageLimb, Rig } from '../formats/rig.ts'
import type { Scenario, SimMaterial, Wind } from '../formats/sim.ts'
import { add, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { toWorld } from '../sim/body.ts'
import { buildClothSystem } from '../sim/cloth.ts'
import type { System } from '../sim/cloth.ts'
import { settle, step as stepCloth, windAt } from '../sim/solver.ts'
import type { StepOptions } from '../sim/solver.ts'
import { turnBetween } from '../world/yaw.ts'
import { bodyFrame, createSpringChain, startChain, stepChain } from './appendages.ts'
import type { SpringChain } from './appendages.ts'
import { restPose } from './pose.ts'
import type { Pose } from './pose.ts'
import type { RootState } from './script.ts'
import { parentsOf } from './skeleton.ts'
import type { Transforms } from './skeleton.ts'

export type SecondaryEnvironment = {
  gravity: number
  wind: Wind
  clothSubsteps: number
  springs: { gravity: number, windDrag: number }
}
export type Dressed = { mannequin: Mannequin, rig: Rig, cloth?: { scenario: Scenario, materials: SimMaterial[] } }
export type SecondaryOptions = {
  fps: number
  springSubsteps: number
  environment: () => SecondaryEnvironment
  collisionPasses?: number
  settlePasses?: number
  settleOnStart?: boolean
}
export type Secondary = {
  step: (frame: number, root: RootState, joints: Pose, body: Pose, transforms: Transforms) => Float64Array | undefined
  reset: () => void
  shift: (by: Vec3) => void
  system: System | undefined
}

type Chain = { chain: SpringChain, parent: string, started: boolean, base: Vec3, yaw: number }
type Cloth = { system: System, scenario: Scenario, previous?: RootState }

export function createSecondary (member: Dressed, settings: SecondaryOptions): Secondary {
  const { fps, springSubsteps } = settings
  const parents = parentsOf(member.rig)
  const chains: Chain[] = member.rig.limbs.filter((l): l is AppendageLimb => l.kind === 'appendage').map(limb => ({
    chain: createSpringChain(limb, restPose(member.mannequin)),
    parent: parents[limb.joints[0]] ?? member.rig.pelvis,
    started: false,
    base: [0, 0, 0],
    yaw: 0
  }))
  const cloth: Cloth | undefined = member.cloth === undefined ? undefined : {
    system: buildClothSystem({ mannequin: member.mannequin, ...member.cloth }), scenario: member.cloth.scenario
  }
  const resting = cloth === undefined ? undefined : {
    position: cloth.system.particles.position.slice(), previous: cloth.system.particles.previous.slice()
  }

  const springs = (frameIndex: number, body: RootState, joints: Pose, transforms: Transforms): void => {
    const environment = settings.environment()
    const dt = 1 / (fps * springSubsteps)
    for (const entry of chains) {
      const root = entry.chain.limb.joints[0]
      const base = joints[root]
      const rotation = transforms[entry.parent]?.rotation
      if (!entry.started) {
        startChain(entry.chain, base, bodyFrame(body.yaw, rotation), frameIndex / fps, () => [0, 0, 0])
        entry.started = true
      } else {
        for (let s = 1; s <= springSubsteps; s++) {
          const u = s / springSubsteps
          const at = add(entry.base, scale(sub(base, entry.base), u))
          const yaw = entry.yaw + turnBetween(entry.yaw, body.yaw) * u
          const t = (frameIndex - 1 + u) / fps
          const wind = windAt(environment.wind, t)
          const { gravity, windDrag } = environment.springs
          const force = (velocity: Vec3): Vec3 => {
            return add([0, -environment.gravity * gravity, 0], scale(sub(wind, velocity), windDrag))
          }
          stepChain(entry.chain, at, bodyFrame(yaw, rotation), t, dt, force)
        }
      }
      entry.base = base
      entry.yaw = body.yaw
      entry.chain.segments.forEach((segment, i) => { joints[entry.chain.limb.joints[i + 1]] = segment.tip })
    }
  }

  const weather = (
    frameIndex: number,
    root: RootState,
    pose: Pose,
    transforms: Transforms
  ): Float64Array | undefined => {
    if (cloth === undefined) return undefined
    const environment = settings.environment()
    const { particles } = cloth.system
    const starting = cloth.previous === undefined
    if (starting) {
      for (let i = 0; i < particles.count; i++) {
        const at: Vec3 = [particles.position[3 * i], particles.position[3 * i + 1], particles.position[3 * i + 2]]
        const p = toWorld(at, root)
        particles.position.set(p, 3 * i)
        particles.previous.set(p, 3 * i)
      }
    }
    if (!starting || settings.settleOnStart === true) {
      const from = cloth.previous ?? root
      const substeps = environment.clothSubsteps
      const env = {
        gravity: [0, -environment.gravity, 0] as Vec3,
        wind: environment.wind,
        particleRadius: cloth.scenario.particleRadius
      }
      const track = (t: number): RootState => {
        const u = Math.min(1, Math.max(0, t * fps - (frameIndex - 1)))
        return {
          position: add(from.position, scale(sub(root.position, from.position), u)),
          yaw: from.yaw + turnBetween(from.yaw, root.yaw) * u,
          velocity: root.velocity,
          angularVelocity: root.angularVelocity
        }
      }
      const options = (s: number): StepOptions => ({
        env, body: member.mannequin, exclude: cloth.scenario.bodyExcludeParts, track,
        pose: () => pose,
        transforms: () => transforms,
        t: (frameIndex - 1 + s / substeps) / fps,
        dt: 1 / (fps * substeps),
        ...(settings.collisionPasses === undefined ? {} : { collisionPasses: settings.collisionPasses })
      })
      for (let s = 1; s <= substeps; s++) stepCloth(cloth.system, options(s))
      if (settings.settlePasses !== undefined) settle(cloth.system, options(substeps), settings.settlePasses)
    }
    cloth.previous = root
    return particles.position.slice(0, 3 * particles.count)
  }

  return {
    step: (frameIndex, root, joints, body, transforms) => {
      springs(frameIndex, root, joints, transforms)
      return weather(frameIndex, root, body, transforms)
    },
    reset: () => {
      for (const entry of chains) entry.started = false
      if (cloth === undefined || resting === undefined) return
      cloth.system.particles.position.set(resting.position)
      cloth.system.particles.previous.set(resting.previous)
      cloth.previous = undefined
    },
    shift: by => {
      for (const entry of chains) {
        entry.base = add(entry.base, by)
        for (const segment of entry.chain.segments) {
          segment.tip = add(segment.tip, by)
          segment.target = add(segment.target, by)
        }
      }
      if (cloth === undefined) return
      const { particles } = cloth.system
      for (let i = 0; i < particles.count; i++) {
        for (let k = 0; k < 3; k++) {
          particles.position[3 * i + k] += by[k]
          particles.previous[3 * i + k] += by[k]
        }
      }
      const previous = cloth.previous
      if (previous !== undefined) cloth.previous = { ...previous, position: add(previous.position, by) }
    },
    system: cloth?.system
  }
}
