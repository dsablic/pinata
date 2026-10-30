import { legsOf } from '../formats/rig.ts'
import type { Leg } from '../formats/rig.ts'
import { apply, axisAngle, between, IDENTITY, interpolate, multiply, transpose, yawMatrix } from '../math/matrix.ts'
import type { Matrix } from '../math/matrix.ts'
import { add, cross, length, normalize, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { chainIk, MAX_FLEXION_DEGREES } from '../motion/ik.ts'
import { chainLength, footRadii } from '../motion/pose.ts'
import type { Pose } from '../motion/pose.ts'
import type { RootState } from '../motion/script.ts'
import { transformTo } from '../motion/skeleton.ts'
import type { Transforms } from '../motion/skeleton.ts'
import { ankleVelocity, featureOf, featureWeights, HORIZONS, toLocal } from './database.ts'
import type { MotionDatabase } from './database.ts'
import { assemble } from './retarget.ts'
import type { BodyFrame } from './retarget.ts'

/** What a character wants: to move at a speed (m/s) along a heading (radians, as yaw), or to stand facing it. */
export type Command = { speed: number, heading: number }
/** How the physical body follows commands and the world. */
export type BodyTuning = {
  /** How fast speed errors close, per second, and the largest acceleration the legs give, m/s^2. */
  speedGain: number
  maxAcceleration: number
  /** How fast heading errors close, per second. */
  turnGain: number
  /** Drag of the air on the body: acceleration per (m/s)^2 of wind relative to the body. */
  drag: number
}
export type PlayerOptions = {
  database: MotionDatabase
  fps: number
  ground: (x: number, z: number) => number
  tuning?: Partial<BodyTuning>
}
/** One frame of playback: the root, body-local joints and transforms, and which feet are held on the ground. */
export type PlayerFrame = {
  root: RootState
  pose: Pose
  transforms: Transforms
  planted: boolean[]
  /** A clip or a jump within one started at this frame. */
  switched: boolean
  /** Legs whose IK target was out of reach or past a knee limit. */
  clamped: number
  /** The clip and frame playing. */
  clip: string
  frame: number
}
export type Player = {
  command: (command: Command) => void
  /** An instant change of the body's velocity (m/s), as from a shove. */
  push: (impulse: Vec3) => void
  /** Wind velocity felt by the body (m/s). */
  wind: Vec3
  step: () => PlayerFrame
}

const DEFAULT_TUNING: BodyTuning = { speedGain: 3, maxAcceleration: 3, turnGain: 4, drag: 0.03 }
/** Most of the legs' acceleration the wind can take, and how much harder a standing body holds its place. */
const WIND_SHARE = 0.8
const STAND_GAIN = 3
/** Matching runs every this many frames, and when a clip runs out. */
const SEARCH_EVERY = 5
/** A jump closer than this many frames to the frame playing is not taken. */
const SAME_FRAME = 3
/** The playing frame's cost is lowered by this much, so playback does not jump for nothing. */
const STAY_BONUS = 0.15
/** Seconds over which a switch's old motion runs on and fades into the new clip (dead blending). */
const BLEND_SECONDS = 0.2
/** How far playback speed may stretch to follow the body. */
const RATE_RANGE: [number, number] = [0.8, 1.25]
/** Share of the gap to the body the animated root closes each frame, in position and heading. */
const SYNC = 0.12
/** A sole point this close to the ground (metres) is held where it is. */
const HOLD_HEIGHT = 0.025
/** Least height of a swinging foot's ends above the ground, metres (real toes clear it by 1 to 3 cm). */
const SWING_CLEARANCE = 0.03
/** How fast that clearance comes and goes, m/s. */
const CLEARANCE_SPEED = 0.4
/** Ends that stay this close to the ground from one frame to the next are kept from moving across it. */
const PIN_HEIGHT = 0.021
/** Seconds over which a released foot rejoins its animation; a foot pulled off the ground steps over a longer time. */
const RELEASE_SECONDS = 0.25
const STEP_SECONDS = 0.25
/** A held foot further than this share of its leg's reach from its animation is pulled off and steps across. */
const RELEASE_SHARE = 0.15
/** Height of that step, as a share of the leg's reach. */
const STEP_HEIGHT_SHARE = 0.15
/** Seconds of the swing path ahead whose ground a swinging foot rises to clear. */
const LOOKAHEAD_SECONDS = 0.2
/** Fastest a swinging foot's ground reference sinks and rises, m/s. */
const SINK_SPEED = 1.2
const RISE_SPEED = 1.5
/** Time constant of the pelvis following the feet's ground, and of it lowering for a foot in the air, seconds. */
const BASE_SECONDS = 0.12
const LOWER_SECONDS = 0.06
/** Most knee flexion the body allows before it rises, and that a foot in the air may reach, degrees (limit 150). */
const FOLD_DEGREES = 140
const TUCK_DEGREES = 148
/** Share of the reach a foot in the air out of reach across the ground is drawn in to. */
const REACH_INSIDE = 0.97
/** Share of the leg's reach the body lowers to keep each foot within. */
const REACH_SHARE = 0.985
/** Steepest ground a foot tilts to; steeper is a stair edge. */
const MAX_GRADE = Math.tan(60 * Math.PI / 180)
const FORWARD: Vec3 = [0, 0, 1]
const UP: Vec3 = [0, 1, 0]

type Foot = {
  heel?: Vec3
  toe?: Vec3
  /** Foot rotation (world) frozen while both ends are held. */
  frozen?: Matrix
  /** Ground under the foot that its animation is measured from. */
  reference: number
  /** How far it keeps its ends clear of the ground, easing to SWING_CLEARANCE while the clip swings it. */
  clearance: number
  release?: { offset: Vec3, turn: Matrix, start: number, step: boolean, from: number }
  /** Where the animation put the ankle last frame (world, before the ground). */
  animated?: Vec3
  /** Where the animation puts the ankle this frame, on the foot's ground, and the foot's rotation. */
  target?: { ankle: Vec3, rotation: Matrix }
  /** Where the foot was placed the frame before this one, kept while this frame is placed. */
  prior?: { ankle: Vec3, rotation: Matrix }
  /** Where the foot was placed last frame. */
  last?: { ankle: Vec3, rotation: Matrix }
}

function turnBetween (a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a))
}

function clamp (v: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, v))
}

/** Height of a step through it, 0 to 1: up quickly off the ground, then down to touch with zero slope. */
function stepLift (u: number): number {
  const s = Math.sin(Math.PI * clamp(u, 0, 1))
  return u < 0.5 ? Math.sqrt(s) : s * s
}

function sampleFrame (frames: BodyFrame[], t: number): BodyFrame {
  const i = Math.floor(t)
  const a = frames[clamp(i, 0, frames.length - 1)]
  const b = frames[clamp(i + 1, 0, frames.length - 1)]
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

/**
 * Plays a character's motion database live. A light physical body (velocity and heading with gains, drag from the
 * wind, shoves) follows the commands; motion matching picks the clip frame whose path ahead, velocity and feet best
 * fit what the body is about to do, and switches blend out over 0.2 s. The animated root moves by the clip's own
 * root motion, stretched to the body's speed and drawn toward the body each frame. Each foot's sole points are held
 * where they touch the ground, the feet stand on the terrain under them (tilted on ramps, lifted over stair edges
 * ahead), the pelvis follows the feet and lowers where a leg could not reach, and the legs are solved by IK.
 */
export function createPlayer (options: PlayerOptions, start: { position: Vec3, yaw: number }): Player {
  const { database, fps, ground } = options
  const { entries, candidates, scales, hierarchy } = database
  const { rig, rest, mannequin } = database.options
  const tuning = { ...DEFAULT_TUNING, ...options.tuning }
  const rate = database.options.style?.rate ?? 1
  const dt = 1 / fps
  const legs = legsOf(rig)
  const weights = featureWeights(legs.length)
  const reach = legs.map(leg => chainLength(leg.chain, rest))
  const radii = legs.map(leg => footRadii(leg, mannequin))
  /** Shortest hip-to-ankle distance, at FOLD_DEGREES of knee flexion, per leg (legs of more bones: a quarter reach). */
  const foldedAt = (degrees: number): number[] => legs.map((leg, k) => {
    if (leg.chain.length !== 3) return reach[k] / 4
    const a = length(sub(rest[leg.chain[1]], rest[leg.chain[0]]))
    const b = length(sub(rest[leg.chain[2]], rest[leg.chain[1]]))
    const inner = (180 - degrees) * Math.PI / 180
    return Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(inner))
  })
  const folded = foldedAt(FOLD_DEGREES)
  const tucked = foldedAt(TUCK_DEGREES)
  const toeOffset = legs.map(leg => sub(rest[leg.toe], rest[leg.ankle]))
  const wind: Vec3 = [0, 0, 0]

  const body = {
    position: [start.position[0], 0, start.position[2]] as Vec3,
    velocity: [0, 0, 0] as Vec3,
    yaw: start.yaw
  }
  const root = { position: [...body.position] as Vec3, yaw: start.yaw }
  let command: Command = { speed: 0, heading: start.yaw }
  let entry = Math.max(0, entries.findIndex(e => e.endsAtRest))
  let t = entries[entry].frames.length - 1
  let frameCount = 0
  /** A switch's old motion: its last rotations and clearances, how they were changing per frame, and when. */
  type Blend = {
    rotations: Record<string, Matrix>
    turning: Record<string, Matrix>
    clearance: { left: number, right: number }
    rising: { left: number, right: number }
    start: number
  }
  let blend: Blend | undefined
  let last: BodyFrame | undefined
  let before: BodyFrame | undefined
  let switched = false
  const startGround = ground(body.position[0], body.position[2])
  let base = startGround
  /** The body's rise for folded legs, eased in and out. */
  let settle = 0
  const feet: Foot[] = legs.map(() => ({ reference: startGround, clearance: 0 }))

  const stepBody = (): void => {
    const want: Vec3 = [Math.sin(command.heading) * command.speed, 0, Math.cos(command.heading) * command.speed]
    const relative = sub(wind, body.velocity)
    let drag = scale([relative[0], 0, relative[2]], tuning.drag * length([relative[0], 0, relative[2]]))
    // the legs can always out-push the wind, and a body told to stand braces against it
    const most = WIND_SHARE * tuning.maxAcceleration
    if (length(drag) > most) drag = scale(drag, most / length(drag))
    const gain = command.speed > 0 ? tuning.speedGain : STAND_GAIN * tuning.speedGain
    let push = scale(sub(want, body.velocity), gain)
    if (length(push) > tuning.maxAcceleration) push = scale(push, tuning.maxAcceleration / length(push))
    body.velocity = add(body.velocity, scale(add(push, drag), dt))
    body.velocity[1] = 0
    body.position = add(body.position, scale(body.velocity, dt))
    const facing = command.speed > 0.05 && length(body.velocity) > 0.05
      ? Math.atan2(body.velocity[0], body.velocity[2])
      : command.heading
    body.yaw += turnBetween(body.yaw, facing) * (1 - Math.exp(-tuning.turnGain * dt))
  }

  /** The features playback wants: the body's predicted path and facing, its velocity, the playing frame's feet. */
  const query = (): number[] => {
    const want: Vec3 = [Math.sin(command.heading) * command.speed, 0, Math.cos(command.heading) * command.speed]
    const facing = command.speed > 0.05 ? Math.atan2(want[0], want[2]) : command.heading
    const k = tuning.speedGain
    const path = [0, ...HORIZONS].map(h => {
      const tau = h / fps
      const drift = scale(sub(body.velocity, want), (1 - Math.exp(-k * tau)) / k)
      const position = add(add(body.position, scale(want, tau)), drift)
      const yaw = facing + turnBetween(facing, body.yaw) * Math.exp(-tuning.turnGain * tau)
      return h === 0 ? { position: root.position, yaw: root.yaw } : { position, yaw }
    })
    const playing = entries[entry]
    const i = clamp(Math.round(t), 0, playing.frames.length - 1)
    const velocities = legs.map((_, leg) => ankleVelocity(playing, i, leg))
    return featureOf(path, body.velocity, playing.ankles[i], velocities)
  }

  const search = (forced: boolean): void => {
    const wanted = query()
    let best = -1
    let bestCost = Infinity
    candidates.forEach((candidate, c) => {
      let cost = 0
      for (let d = 0; d < wanted.length; d++) {
        const e = (wanted[d] - candidate.feature[d]) / scales[d]
        cost += weights[d] * e * e
        if (cost >= bestCost + STAY_BONUS) return
      }
      const playing = candidate.entry === entry && Math.abs(candidate.frame - t) < SAME_FRAME
      if (playing && forced) return
      if (playing) cost -= STAY_BONUS
      if (cost < bestCost) {
        bestCost = cost
        best = c
      }
    })
    if (best < 0) return
    const chosen = candidates[best]
    if (chosen.entry === entry && Math.abs(chosen.frame - t) < SAME_FRAME) return
    if (last !== undefined) {
      const from = before ?? last
      const turning: Record<string, Matrix> = {}
      for (const joint of Object.keys(last.rotations)) {
        turning[joint] = multiply(last.rotations[joint], transpose(from.rotations[joint]))
      }
      blend = {
        rotations: last.rotations,
        turning,
        clearance: last.clearance,
        rising: {
          left: last.clearance.left - from.clearance.left,
          right: last.clearance.right - from.clearance.right
        },
        start: frameCount
      }
    }
    entry = chosen.entry
    t = chosen.frame
    switched = true
  }

  /**
   * The clip frame playing. After a switch (dead blending), the old motion carries on from its last frame at its own
   * velocity, slowing to a stop over BLEND_SECONDS, and fades into the new clip, so neither pose nor velocity jumps.
   */
  const playing = (): BodyFrame => {
    const frame = sampleFrame(entries[entry].frames, t)
    if (blend === undefined) return frame
    const span = BLEND_SECONDS * fps
    const n = frameCount - blend.start + 1
    if (n >= span) {
      blend = undefined
      return frame
    }
    const carried = n - n * n / (2 * span)
    const u = n / span
    const w = u * u * (3 - 2 * u)
    const rotations: Record<string, Matrix> = {}
    for (const [joint, rotation] of Object.entries(frame.rotations)) {
      const old = multiply(interpolate(IDENTITY, blend.turning[joint], carried), blend.rotations[joint])
      rotations[joint] = interpolate(old, rotation, w)
    }
    const side = (key: 'left' | 'right'): number => {
      const old = blend!.clearance[key] + blend!.rising[key] * carried
      return old + (frame.clearance[key] - old) * w
    }
    return { ...frame, rotations, clearance: { left: side('left'), right: side('right') } }
  }

  const advance = (): void => {
    const frames = entries[entry].frames
    const clipSpeed = length(sampleFrame(frames, t).root.velocity)
    const bodySpeed = length(body.velocity)
    const stretch = clipSpeed > 0.3 && bodySpeed > 0.1 ? clamp(bodySpeed / clipSpeed, ...RATE_RANGE) : 1
    const step = rate * stretch
    const from = sampleFrame(frames, t)
    const next = Math.min(frames.length - 1, t + step)
    const to = sampleFrame(frames, next)
    const delta = toLocal(sub(to.root.position, from.root.position), from.root.yaw)
    root.position = add(root.position, toWorldTurn(delta, root.yaw))
    root.yaw += turnBetween(from.root.yaw, to.root.yaw)
    root.position = add(root.position, scale(sub(body.position, root.position), SYNC))
    root.yaw += turnBetween(root.yaw, body.yaw) * SYNC
    t = next
  }

  const soles = (ankle: Vec3, rotation: Matrix, k: number): { heel: Vec3, toe: Vec3 } => {
    const toe = add(ankle, apply(rotation, toeOffset[k]))
    return {
      heel: [ankle[0], ankle[1] - radii[k].ankle, ankle[2]],
      toe: [toe[0], toe[1] - radii[k].toe, toe[2]]
    }
  }

  /** The foot tilted to the ground under it on a ramp (not over a stair edge), about its heel. */
  const tilted = (ankle: Vec3, rotation: Matrix, k: number, weight: number): Matrix => {
    if (weight <= 0) return rotation
    const { heel, toe } = soles(ankle, rotation, k)
    const run = Math.hypot(toe[0] - heel[0], toe[2] - heel[2])
    if (run < 1e-6) return rotation
    const rise = ground(toe[0], toe[2]) - ground(heel[0], heel[2])
    if (Math.abs(rise) > MAX_GRADE * run) return rotation
    const along = normalize([toe[0] - heel[0], 0, toe[2] - heel[2]])
    const axis = cross(along, UP)
    return multiply(axisAngle(normalize(axis), -Math.atan2(rise, run) * weight), rotation)
  }

  /**
   * Places one foot: the animated ankle and foot rotation in the world, its height measured from its ground
   * reference, then held ends kept where they touched down, ends that come within HOLD_HEIGHT of the ground held, and
   * the foot lifted to stand on the ground under both ends.
   */
  const placeFoot = (k: number, animated: Vec3, local: Matrix, contact: boolean): { ankle: Vec3, rotation: Matrix } => {
    const foot = feet[k]
    foot.prior = foot.last
    const turn = multiply(yawMatrix(root.yaw), local)
    const height = animated[1]
    const world = toWorldPoint(animated)
    const near = height < 0.12 ? 1 - height / 0.12 : 0
    const rotation = tilted(world, turn, k, near)
    const held = foot.heel !== undefined || foot.toe !== undefined
    // the ground reference: under the held end, else the highest ground just ahead of a swing, sinking gradually
    const velocity = foot.animated === undefined ? [0, 0, 0] : scale(sub(world, foot.animated), fps)
    foot.animated = world
    const ahead = add(world, scale([velocity[0], 0, velocity[2]], LOOKAHEAD_SECONDS))
    const ends = soles(world, rotation, k)
    const aheadEnds = soles(ahead, rotation, k)
    const highest = Math.max(...[ends.heel, ends.toe, aheadEnds.heel, aheadEnds.toe].map(p => ground(p[0], p[2])))
    if (held) {
      const end = foot.heel ?? foot.toe as Vec3
      foot.reference = ground(end[0], end[2])
    } else {
      // rises toward the highest ground just ahead and sinks toward it, both at a limited speed (where the foot
      // actually is, the ground is kept below it when it is placed)
      const rising = Math.min(highest, foot.reference + RISE_SPEED * dt)
      const sinking = Math.max(highest, foot.reference - SINK_SPEED * dt)
      foot.reference = highest >= foot.reference ? rising : sinking
    }
    const animatedAnkle: Vec3 = [world[0], foot.reference + height, world[2]]
    foot.target = { ankle: animatedAnkle, rotation }
    let ankle = animatedAnkle
    let turned = rotation
    let stepping = false
    if (foot.release !== undefined) {
      const { offset, turn: offsetTurn, start, step, from } = foot.release
      const u = clamp((frameCount - start) * dt / (step ? STEP_SECONDS : RELEASE_SECONDS), 0, 1)
      if (u >= 1) foot.release = undefined
      const w = 1 - u * u * (3 - 2 * u)
      const bump = step ? STEP_HEIGHT_SHARE * reach[k] * stepLift(u) : 0
      ankle = add(ankle, [offset[0] * w, offset[1] * w + bump, offset[2] * w])
      // a step clears the ground it left as well as the ground it goes to, the first fading into the second
      if (step) ankle = [ankle[0], Math.max(ankle[1], from * w + animatedAnkle[1] * (1 - w) + bump), ankle[2]]
      turned = multiply(interpolate(IDENTITY, offsetTurn, w), rotation)
      stepping = step && u < 1
    }
    // which ends touch, measured on the animated foot; a held end that drifted too far from it is let go
    const free = soles(ankle, turned, k)
    const above = (p: Vec3): number => p[1] - ground(p[0], p[2])
    const drift = (end: Vec3 | undefined, now: Vec3): number => {
      return end === undefined ? 0 : Math.hypot(end[0] - now[0], end[2] - now[2])
    }
    const pulled = Math.max(drift(foot.heel, free.heel), drift(foot.toe, free.toe)) > RELEASE_SHARE * reach[k]
    // the clip says when a foot is on the ground; the height says which ends touch
    const heelDown = contact && !stepping && !pulled && above(free.heel) <= HOLD_HEIGHT
    const toeDown = contact && !stepping && !pulled && above(free.toe) <= HOLD_HEIGHT
    const wasHeld = foot.heel !== undefined || foot.toe !== undefined
    const before = foot.last === undefined ? undefined : soles(foot.last.ankle, foot.last.rotation, k)
    if (!heelDown) foot.heel = undefined
    else if (foot.heel === undefined) foot.heel = before?.heel ?? free.heel
    if (!toeDown) foot.toe = undefined
    else if (foot.toe === undefined) foot.toe = before?.toe ?? free.toe
    if (foot.heel === undefined || foot.toe === undefined) foot.frozen = undefined
    else foot.frozen ??= foot.last?.rotation ?? turned
    let final = foot.frozen ?? turned
    if (foot.heel !== undefined) ankle = [foot.heel[0], ankle[1], foot.heel[2]]
    else if (foot.toe !== undefined) {
      const along = apply(final, toeOffset[k])
      ankle = [foot.toe[0] - along[0], ankle[1], foot.toe[2] - along[2]]
    } else if (wasHeld && foot.last !== undefined) {
      foot.release = {
        offset: sub(foot.last.ankle, animatedAnkle),
        turn: multiply(foot.last.rotation, transpose(rotation)),
        start: frameCount,
        step: pulled,
        from: foot.last.ankle[1]
      }
      ankle = foot.last.ankle
      final = foot.last.rotation
    }
    // stand on the ground under both ends; a foot the clip swings keeps clear of it
    const wanted = !contact && foot.heel === undefined && foot.toe === undefined ? SWING_CLEARANCE : 0
    const step = CLEARANCE_SPEED * dt
    foot.clearance = Math.min(foot.clearance + step, Math.max(foot.clearance - step, wanted))
    const clearance = foot.clearance
    const placed = soles(ankle, final, k)
    const lift = Math.max(0, clearance + ground(placed.heel[0], placed.heel[2]) - placed.heel[1],
      clearance + ground(placed.toe[0], placed.toe[2]) - placed.toe[1])
    ankle = [ankle[0], ankle[1] + lift, ankle[2]]
    // an end that stays this close to the ground does not move across it, held or not
    if (before !== undefined && foot.last !== undefined) {
      const now = soles(ankle, final, k)
      const pinned = (['heel', 'toe'] as const)
        .filter(end => above(before[end]) <= PIN_HEIGHT && above(now[end]) <= PIN_HEIGHT)
      const otherHeld = pinned.length === 1 && (pinned[0] === 'heel' ? foot.toe : foot.heel) !== undefined
      if (pinned.length === 2 || otherHeld) {
        // both ends stay down, or one stays down while the other is held: the whole foot stays as it was
        final = foot.last.rotation
        ankle = [foot.last.ankle[0], ankle[1], foot.last.ankle[2]]
      } else if (pinned.length === 1) {
        const shift = sub(before[pinned[0]], now[pinned[0]])
        ankle = [ankle[0] + shift[0], ankle[1], ankle[2] + shift[2]]
      }
      if (pinned.length > 0) {
        const moved = soles(ankle, final, k)
        const under = Math.max(0, -above(moved.heel), -above(moved.toe))
        ankle = [ankle[0], ankle[1] + under, ankle[2]]
      }
    }
    foot.last = { ankle, rotation: final }
    return { ankle, rotation: final }
  }

  const toWorldPoint = (local: Vec3): Vec3 => add([root.position[0], 0, root.position[2]], toWorldTurn(local, root.yaw))

  const solveLegs = (pose: Pose, transforms: Transforms, targets: Array<{ ankle: Vec3, rotation: Matrix }>): number => {
    const unturn = transpose(yawMatrix(root.yaw))
    let clamped = 0
    legs.forEach((leg: Leg, k) => {
      const target = toLocal(sub(targets[k].ankle, [root.position[0], 0, root.position[2]]), root.yaw)
      const result = chainIk({
        joints: leg.chain.map(name => rest[name]),
        root: pose[leg.hip],
        target,
        pole: leg.bends.includes('up') ? UP : FORWARD,
        bends: leg.bends.map(bend => bend === 'backward' ? -1 : 1),
        limits: leg.limits ?? (leg.chain.length > 3 ? { min: 0, max: MAX_FLEXION_DEGREES } : undefined)
      })
      if (result.clamped || result.missed > 1e-4) clamped++
      leg.chain.forEach((name, i) => { pose[name] = result.joints[i] })
      leg.chain.slice(0, -1).forEach((name, i) => {
        const next = leg.chain[i + 1]
        const rotation = between(normalize(sub(rest[next], rest[name])), normalize(sub(pose[next], pose[name])))
        transforms[name] = transformTo(rotation, rest[name], pose[name])
      })
      const foot = multiply(unturn, targets[k].rotation)
      transforms[leg.ankle] = transformTo(foot, rest[leg.ankle], pose[leg.ankle])
      pose[leg.toe] = add(pose[leg.ankle], apply(foot, toeOffset[k]))
      transforms[leg.toe] = transforms[leg.ankle]
    })
    return clamped
  }

  /** Lets a held foot go so that it steps across to its animation from where it stands. */
  const stepOff = (k: number): void => {
    const foot = feet[k]
    if (foot.last === undefined || foot.target === undefined) return
    foot.heel = undefined
    foot.toe = undefined
    foot.frozen = undefined
    foot.release = {
      offset: sub(foot.last.ankle, foot.target.ankle),
      turn: multiply(foot.last.rotation, transpose(foot.target.rotation)),
      start: frameCount,
      step: true,
      from: foot.last.ankle[1]
    }
  }

  return {
    wind,
    command: next => { command = next },
    push: impulse => { body.velocity = add(body.velocity, [impulse[0], 0, impulse[2]]) },
    step: () => {
      switched = false
      stepBody()
      const ending = !entries[entry].endsAtRest && t + rate * RATE_RANGE[1] >= entries[entry].frames.length - 1
      if (frameCount === 0 || frameCount % SEARCH_EVERY === 0 || ending) search(ending)
      if (frameCount > 0) advance()
      const frame = playing()
      before = last
      last = frame
      const { pose, transforms } = assemble(frame, database.options, hierarchy)
      const targets = legs.map((leg, k) => {
        return placeFoot(k, pose[leg.ankle], transforms[leg.ankle].rotation ?? IDENTITY, frame.contact[k] ?? true)
      })
      // the pelvis follows the lower foot's ground
      const lowest = Math.min(...feet.map(f => f.reference))
      base += (lowest - base) * (1 - Math.exp(-dt / BASE_SECONDS))
      // held feet set how high the body may stand: low enough for each to reach, high enough for none to fold past
      // FOLD_DEGREES; when two cannot both be kept, the one limiting reach steps off
      const isHeld = (k: number): boolean => feet[k].heel !== undefined || feet[k].toe !== undefined
      const hips = legs.map(leg => toWorldPoint(add(pose[leg.hip], [0, base, 0])))
      /** How far the body may lower (ceiling) and must rise (floor) for a foot; a foot out of reach across the ground
       * sets no ceiling (no height reaches it) and is marked. */
      const bounds = (k: number): { floor: number, ceiling: number, out: boolean } => {
        const hip = hips[k]
        const ankle = targets[k].ankle
        const flat = Math.hypot(ankle[0] - hip[0], ankle[2] - hip[2])
        const gap = hip[1] - ankle[1]
        const span = REACH_SHARE * reach[k]
        return {
          ceiling: flat < span ? Math.sqrt(span * span - flat * flat) - gap : Infinity,
          floor: flat < folded[k] ? Math.sqrt(folded[k] ** 2 - flat * flat) - gap : -Infinity,
          out: flat >= span
        }
      }
      // a held foot no height can reach steps off
      for (const k of legs.map((_, k) => k).filter(k => isHeld(k) && bounds(k).out)) stepOff(k)
      let floor = -Infinity
      let ceiling = Infinity
      for (let pass = 0; pass < legs.length; pass++) {
        const held = legs.map((_, k) => k).filter(isHeld)
        floor = Math.max(-Infinity, ...held.map(k => bounds(k).floor))
        ceiling = Math.min(Infinity, ...held.map(k => bounds(k).ceiling))
        if (floor <= ceiling || held.length === 0) break
        const limiting = held.reduce((a, b) => bounds(b).ceiling < bounds(a).ceiling ? b : a)
        stepOff(limiting)
      }
      // feet in the air ask the body to rise where they would fold and lower where they could not reach, as far as
      // the held feet allow; the body eases there, lowering faster than it rises, and the held feet's range is kept
      // every frame
      const air = legs.map((_, k) => k).filter(k => !isHeld(k)).map(bounds)
      const airFloor = Math.max(-Infinity, ...air.map(b => b.floor))
      const airCeiling = Math.min(Infinity, ...air.map(b => b.ceiling))
      const free = Math.min(airCeiling, Math.max(airFloor, 0))
      const wanted = clamp(Number.isFinite(free) ? free : 0, Number.isFinite(floor) ? floor : -Infinity, ceiling)
      const ease = wanted < settle ? LOWER_SECONDS : BASE_SECONDS
      settle += (wanted - settle) * (1 - Math.exp(-dt / ease))
      if (!Number.isFinite(settle)) settle = 0
      const drop = Math.min(ceiling, Math.max(floor, settle))
      // feet in the air keep their place across the ground and rise or sink to stay within the leg's range, never
      // into the ground
      legs.forEach((leg, k) => {
        if (isHeld(k)) return
        const hip = add(hips[k], [0, drop, 0])
        let ankle = targets[k].ankle
        let flat = Math.hypot(ankle[0] - hip[0], ankle[2] - hip[2])
        const span = REACH_SHARE * reach[k]
        const low = (p: Vec3): boolean => p[1] - ground(p[0], p[2]) <= PIN_HEIGHT
        const now = soles(ankle, targets[k].rotation, k)
        const prior = feet[k].prior
        const before = prior === undefined ? undefined : soles(prior.ankle, prior.rotation, k)
        // moved across the ground only where no end stays down, so it cannot slide
        const clear = before === undefined || !(['heel', 'toe'] as const).some(end => low(now[end]) && low(before[end]))
        if (flat >= REACH_INSIDE * span && clear) {
          // out of reach across the ground and clear of it: drawn in toward the hip
          const inside = REACH_INSIDE * span / flat
          ankle = [hip[0] + (ankle[0] - hip[0]) * inside, ankle[1], hip[2] + (ankle[2] - hip[2]) * inside]
          flat = REACH_INSIDE * span
        }
        let y = ankle[1]
        if (flat < span) y = Math.max(y, hip[1] - Math.sqrt(span * span - flat * flat))
        if (flat < tucked[k]) y = Math.min(y, hip[1] - Math.sqrt(tucked[k] ** 2 - flat * flat))
        const ends = soles([ankle[0], y, ankle[2]], targets[k].rotation, k)
        const under = Math.max(0, ground(ends.heel[0], ends.heel[2]) - ends.heel[1],
          ground(ends.toe[0], ends.toe[2]) - ends.toe[1])
        if (y + under !== targets[k].ankle[1] || ankle !== targets[k].ankle) {
          targets[k] = { ...targets[k], ankle: [ankle[0], y + under, ankle[2]] }
          feet[k].last = { ankle: targets[k].ankle, rotation: targets[k].rotation }
        }
      })
      const lift = base + drop
      for (const joint of Object.keys(pose)) {
        pose[joint] = add(pose[joint], [0, lift, 0])
        const t0 = transforms[joint]
        transforms[joint] = { ...t0, translation: add(t0.translation, [0, lift, 0]) }
      }
      const clamped = solveLegs(pose, transforms, targets)
      frameCount++
      return {
        root: { position: [...root.position], yaw: root.yaw, velocity: [...body.velocity], angularVelocity: 0 },
        pose,
        transforms,
        planted: feet.map(f => f.heel !== undefined || f.toe !== undefined),
        switched,
        clamped,
        clip: entries[entry].name,
        frame: Math.round(t)
      }
    }
  }
}

function toWorldTurn (v: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]
}
