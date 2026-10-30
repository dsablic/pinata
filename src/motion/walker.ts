import type { Mannequin } from '../formats/mannequin.ts'
import { legPhases, legsOf } from '../formats/rig.ts'
import type { Rig } from '../formats/rig.ts'
import { add, length, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import type { FootState, GaitFrame } from './gait.ts'
import { chainLength, soleHeight } from './pose.ts'
import type { Pose } from './pose.ts'

/** What the walker wants: a forward speed along a heading (radians, as yaw), or to stand still facing it. */
export type Command = { speed: number, heading: number }
/** Tuning of the body's control: how hard it tracks speed and heading, and how its torso tilts. */
export type WalkerTuning = {
  /** Most horizontal acceleration the legs can give with every foot planted, m/s^2. */
  traction: number
  /** How fast the speed error closes, per second. */
  speedGain: number
  /** Heading spring (Hz) and damping ratio. */
  turn: { frequency: number, damping: number }
  /** Ride height spring (Hz) and damping ratio, on the planted legs. */
  ride: { frequency: number, damping: number }
  /** Torso pitch spring (Hz), damping, and degrees of lean per m/s^2 of acceleration. */
  tilt: { frequency: number, damping: number, perAcceleration: number }
  /** Wind drag on the body, per second. */
  drag: number
  /** A foot steps when it is this far from its target, as a fraction of the stride. */
  trigger: number
}
export type WalkerOptions = {
  rig: Rig
  rest: Pose
  mannequin: Mannequin
  fps: number
  substeps: number
  tuning: WalkerTuning
  ground?: (x: number, z: number) => number
}
export type Walker = {
  command: (command: Command) => void
  /** An instant change of the body's velocity (m/s), as from a shove. */
  push: (impulse: Vec3) => void
  /** Wind velocity felt by the body (m/s), read every substep. */
  wind: Vec3
  step: () => GaitFrame
}

type Foot = {
  ankle: Vec3
  planted: boolean
  swing?: { from: Vec3, start: number, seconds: number, target: Vec3 }
  restAnkle: Vec3
  restHip: Vec3
  sole: number
  reach: number
  group: number
  yaw: number
}

const GRAVITY = 9.81
const MIN_TRACTION = 0.15
const SWING_FRACTION = 0.5
const MIN_SWING_SECONDS = 0.18
const MAX_SWING_SECONDS = 0.5
const FREEZE_TARGET = 0.7
const REACH_LIMIT = 0.97
const STAND_SPEED = 0.05

function smoothstep (u: number): number {
  const c = Math.min(1, Math.max(0, u))
  return c * c * (3 - 2 * c)
}

function turnBetween (a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a))
}

/** A body-local offset turned by yaw, as toWorld does. */
function turned (v: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]
}

/**
 * A walking character as a physical body: it has mass and momentum, planted legs hold it up and push it toward the
 * commanded velocity (harder the more feet are down), it turns with a heading spring, its torso pitches with its
 * acceleration, and wind and shoves move it. Each foot aims under its hip plus half a stance of travel, and lifts
 * when it falls too far from that aim or its leg nears full reach, provided no other gait group is mid-swing (legs
 * with the same phase swing together). Each frame becomes a GaitFrame, so posing, IK and everything downstream work as
 * for planned walking. Deterministic.
 */
export function createWalker (options: WalkerOptions, start: { position: Vec3, yaw: number }): Walker {
  const { rig, rest, mannequin, fps, substeps, tuning } = options
  const ground = options.ground ?? (() => 0)
  const legs = legsOf(rig)
  const phases = legPhases(rig)
  const groups = [...new Set(phases.map(p => Math.round(p * 100)))]
  const pelvis = rest[rig.pelvis]
  const restSole = Math.min(...legs.map(leg => soleHeight(leg, rest, mannequin)))
  const ride = pelvis[1] - restSole
  const stride = rig.gait.strideLength
  const dt = 1 / (fps * substeps)
  const wind: Vec3 = [0, 0, 0]
  const body = {
    position: [start.position[0], ground(start.position[0], start.position[2]) + ride, start.position[2]] as Vec3,
    velocity: [0, 0, 0] as Vec3,
    yaw: start.yaw,
    yawRate: 0,
    pitch: 0,
    pitchRate: 0
  }
  let command: Command = { speed: 0, heading: start.yaw }
  let time = 0
  const feet: Foot[] = legs.map((leg, k) => {
    const sole = rest[leg.ankle][1] - soleHeight(leg, rest, mannequin)
    const local = sub(rest[leg.ankle], [pelvis[0], 0, pelvis[2]])
    const at = add([start.position[0], 0, start.position[2]], turned([local[0], 0, local[2]], start.yaw))
    return {
      ankle: [at[0], ground(at[0], at[2]) + sole, at[2]],
      planted: true,
      restAnkle: local,
      restHip: sub(rest[leg.hip], [pelvis[0], 0, pelvis[2]]),
      sole,
      reach: chainLength(leg.chain, rest),
      group: groups.indexOf(Math.round(phases[k] * 100)),
      yaw: start.yaw
    }
  })

  const forward = (): Vec3 => [Math.sin(body.yaw), 0, Math.cos(body.yaw)]
  const horizontal = (v: Vec3): Vec3 => [v[0], 0, v[2]]
  const swingSeconds = (): number => {
    const speed = Math.max(length(horizontal(body.velocity)), STAND_SPEED)
    return Math.min(MAX_SWING_SECONDS, Math.max(MIN_SWING_SECONDS, SWING_FRACTION * stride / 2 / speed))
  }
  const stanceSeconds = (): number => swingSeconds() * rig.gait.stanceFraction / (1 - rig.gait.stanceFraction)
  /** Where a foot wants to land: under its hip, plus half a stance of travel, on the ground. */
  const targetOf = (foot: Foot): Vec3 => {
    const under = add(horizontal(body.position), turned([foot.restAnkle[0], 0, foot.restAnkle[2]], body.yaw))
    const lead = scale(horizontal(body.velocity), stanceSeconds() / 2)
    const at = add(under, lead)
    return [at[0], ground(at[0], at[2]) + foot.sole, at[2]]
  }
  const hipOf = (foot: Foot): Vec3 => add(body.position, turned([foot.restHip[0], 0, foot.restHip[2]], body.yaw))

  const stepFeet = (): void => {
    for (const foot of feet) {
      const { swing } = foot
      if (swing === undefined) continue
      const u = (time - swing.start) / swing.seconds
      if (u < FREEZE_TARGET) swing.target = targetOf(foot)
      if (u >= 1) {
        foot.ankle = swing.target
        foot.planted = true
        foot.swing = undefined
        foot.yaw = body.yaw
        continue
      }
      const h = smoothstep(u)
      const lift = Math.sin(Math.PI * u)
      const level = swing.from[1] + (swing.target[1] - swing.from[1]) * h
      foot.ankle = [
        swing.from[0] + (swing.target[0] - swing.from[0]) * h,
        level + rig.gait.stepHeight * lift,
        swing.from[2] + (swing.target[2] - swing.from[2]) * h
      ]
    }
    const swinging = new Set(feet.filter(f => !f.planted).map(f => f.group))
    if (swinging.size > 0) return
    const errors = feet.map(foot => {
      const off = length(horizontal(sub(targetOf(foot), foot.ankle)))
      const stretched = length(sub(hipOf(foot), foot.ankle)) > REACH_LIMIT * foot.reach
      return stretched ? Infinity : off
    })
    const threshold = tuning.trigger * stride
    let best = -1
    let worst = threshold
    errors.forEach((error, k) => {
      if (error > worst) {
        worst = error
        best = feet[k].group
      }
    })
    if (best < 0) return
    for (const foot of feet) {
      if (foot.group !== best) continue
      foot.planted = false
      foot.swing = { from: foot.ankle, start: time, seconds: swingSeconds(), target: targetOf(foot) }
    }
  }

  const stepBody = (): void => {
    const planted = feet.filter(f => f.planted)
    const share = planted.length / feet.length
    const grip = planted.length === 0 ? 0 : Math.max(MIN_TRACTION, share)
    const want = scale([Math.sin(command.heading), 0, Math.cos(command.heading)], command.speed)
    const error = sub(want, horizontal(body.velocity))
    const push = scale(error, tuning.speedGain)
    const limit = tuning.traction * grip
    const size = length(push)
    const drive = size > limit ? scale(push, limit / size) : push
    const drag = scale(sub(wind, horizontal(body.velocity)), tuning.drag)
    let vertical = -GRAVITY
    if (planted.length > 0) {
      const level = planted.reduce((sum, f) => sum + f.ankle[1] - f.sole, 0) / planted.length + ride
      const omega = 2 * Math.PI * tuning.ride.frequency
      vertical = omega * omega * (level - body.position[1]) - 2 * tuning.ride.damping * omega * body.velocity[1]
    }
    const acceleration: Vec3 = [drive[0] + drag[0], vertical, drive[2] + drag[2]]
    body.velocity = add(body.velocity, scale(acceleration, dt))
    body.position = add(body.position, scale(body.velocity, dt))
    const turnOmega = 2 * Math.PI * tuning.turn.frequency * Math.max(grip, MIN_TRACTION)
    const yawAcceleration = turnOmega * turnOmega * turnBetween(body.yaw, command.heading) -
      2 * tuning.turn.damping * turnOmega * body.yawRate
    body.yawRate += yawAcceleration * dt
    body.yaw += body.yawRate * dt
    const ahead = acceleration[0] * Math.sin(body.yaw) + acceleration[2] * Math.cos(body.yaw)
    const tiltOmega = 2 * Math.PI * tuning.tilt.frequency
    const tiltTarget = -ahead * tuning.tilt.perAcceleration * Math.PI / 180
    body.pitchRate += (tiltOmega * tiltOmega * (tiltTarget - body.pitch) - 2 * tuning.tilt.damping * tiltOmega *
      body.pitchRate) * dt
    body.pitch += body.pitchRate * dt
  }

  const frame = (): GaitFrame => {
    const footStates: FootState[] = legs.map((leg, k) => {
      const foot = feet[k]
      const u = foot.swing === undefined ? 0 : (time - foot.swing.start) / foot.swing.seconds
      const lift = foot.planted ? 0 : Math.sin(Math.PI * Math.min(1, u))
      return {
        side: leg.side, ankle: foot.ankle, toeYaw: foot.planted ? foot.yaw : body.yaw, planted: foot.planted, lift,
        toePitch: lift
      }
    })
    const half = stride / 2
    const armSwings = feet.map(foot => {
      const offset = turned(sub(foot.ankle, hipOf(foot)), -body.yaw)[2]
      return rig.gait.armSwingDegrees * Math.max(-1, Math.min(1, offset / half))
    })
    const speed = length(horizontal(body.velocity))
    return {
      root: {
        position: [body.position[0], 0, body.position[2]],
        yaw: body.yaw,
        velocity: horizontal(body.velocity),
        angularVelocity: body.yawRate
      },
      pelvisOffset: [0, body.position[1] - pelvis[1], 0],
      feet: footStates,
      armSwings,
      phase: speed,
      pelvisPitch: body.pitch
    }
  }

  return {
    wind,
    command: next => { command = next },
    push: impulse => { body.velocity = add(body.velocity, impulse) },
    step: () => {
      for (let s = 0; s < substeps; s++) {
        stepBody()
        time += dt
      }
      stepFeet()
      return frame()
    }
  }
}
