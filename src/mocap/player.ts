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
import { turnBetween, turnToLocal, turnToWorld } from '../world/yaw.ts'
import { ankleVelocity, featureOf, featureWeights, HORIZONS } from './database.ts'
import type { MotionDatabase } from './database.ts'
import { assemble, raise } from './retarget.ts'
import type { BodyFrame } from './retarget.ts'

export type Command = { speed: number, heading: number }
export type BodyTuning = {
  speedGain: number
  maxAcceleration: number
  turnGain: number
  drag: number
}
export type PlayerOptions = {
  database: MotionDatabase
  fps: number
  ground: (x: number, z: number) => number
  tuning?: Partial<BodyTuning>
}
export type PlayerFrame = {
  root: RootState
  pose: Pose
  transforms: Transforms
  planted: boolean[]
  switched: boolean
  clamped: number
  clip: string
  frame: number
}
export type Player = {
  command: (command: Command) => void
  push: (impulse: Vec3) => void
  wind: Vec3
  step: () => PlayerFrame
  height: () => number
  falling: () => boolean
}

const DEFAULT_TUNING: BodyTuning = { speedGain: 3, maxAcceleration: 3, turnGain: 4, drag: 0.03 }
const WIND_SHARE = 0.8
const STAND_GAIN = 3
const SEARCH_EVERY = 5
const SAME_FRAME = 3
const STAY_BONUS = 0.15
const BLEND_SECONDS = 0.2
const RATE_RANGE: [number, number] = [0.8, 1.25]
const SYNC = 0.12
const HOLD_HEIGHT = 0.025
const SWING_CLEARANCE = 0.03
const CLEARANCE_SPEED = 0.4
const PIN_HEIGHT = 0.021
const RELEASE_SECONDS = 0.25
const STEP_SECONDS = 0.25
const RELEASE_SHARE = 0.15
const LONE_RELEASE_SHARE = 0.35
const STEP_HEIGHT_SHARE = 0.15
const LOOKAHEAD_SECONDS = 0.2
const SINK_SPEED = 1.2
const RISE_SPEED = 1.5
const BASE_SECONDS = 0.12
const LOWER_SECONDS = 0.06
const FOLD_DEGREES = 140
const TUCK_DEGREES = 148
const REACH_INSIDE = 0.97
const REACH_SHARE = 0.985
const TILT_HEIGHT = 0.12
const FALL_START_HEIGHT = 0.5
const BELOW_SUPPORT = 0.2
const GRAVITY = 9.81
const MAX_GRADE = Math.tan(60 * Math.PI / 180)
const FORWARD: Vec3 = [0, 0, 1]
const UP: Vec3 = [0, 1, 0]
const ENDS = ['heel', 'toe'] as const

type Placed = { ankle: Vec3, rotation: Matrix }
type Soles = { heel: Vec3, toe: Vec3 }
type Release = { offset: Vec3, turn: Matrix, start: number, step: boolean, from: number }
type Foot = {
  heel?: Vec3
  toe?: Vec3
  frozen?: Matrix
  reference: number
  clearance: number
  release?: Release
  animated?: Vec3
  target?: Placed
  prior?: Placed
  last?: Placed
}
type Blend = {
  rotations: Record<string, Matrix>
  turning: Record<string, Matrix>
  clearance: { left: number, right: number }
  rising: { left: number, right: number }
  start: number
}
type Bounds = { floor: number, ceiling: number, out: boolean }

function clamp (v: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, v))
}

function stepLift (u: number): number {
  const s = Math.sin(Math.PI * clamp(u, 0, 1))
  return u < 0.5 ? Math.sqrt(s) : s * s
}

function isHeld (foot: Foot): boolean {
  return foot.heel !== undefined || foot.toe !== undefined
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

function blendFrom (last: BodyFrame, from: BodyFrame, start: number): Blend {
  const turning: Record<string, Matrix> = {}
  for (const joint of Object.keys(last.rotations)) {
    turning[joint] = multiply(last.rotations[joint], transpose(from.rotations[joint]))
  }
  return {
    rotations: last.rotations,
    turning,
    clearance: last.clearance,
    rising: {
      left: last.clearance.left - from.clearance.left,
      right: last.clearance.right - from.clearance.right
    },
    start
  }
}

function blended (frame: BodyFrame, blend: Blend, n: number, span: number): BodyFrame {
  const carried = n - n * n / (2 * span)
  const u = n / span
  const w = u * u * (3 - 2 * u)
  const rotations: Record<string, Matrix> = {}
  for (const [joint, rotation] of Object.entries(frame.rotations)) {
    const old = multiply(interpolate(IDENTITY, blend.turning[joint], carried), blend.rotations[joint])
    rotations[joint] = interpolate(old, rotation, w)
  }
  const side = (key: 'left' | 'right'): number => {
    const old = blend.clearance[key] + blend.rising[key] * carried
    return old + (frame.clearance[key] - old) * w
  }
  return { ...frame, rotations, clearance: { left: side('left'), right: side('right') } }
}

function legFolded (leg: Leg, rest: Pose, reach: number, degrees: number): number {
  if (leg.chain.length !== 3) return reach / 4
  const a = length(sub(rest[leg.chain[1]], rest[leg.chain[0]]))
  const b = length(sub(rest[leg.chain[2]], rest[leg.chain[1]]))
  const inner = (180 - degrees) * Math.PI / 180
  return Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(inner))
}

export function createPlayer (options: PlayerOptions, start: { position: Vec3, yaw: number }): Player {
  const { database, fps, ground } = options
  const { entries, candidates, scales, hierarchy } = database
  const { rig, rest, mannequin } = database.options
  const tuning = { ...DEFAULT_TUNING, ...options.tuning }
  const rate = database.options.style?.rate ?? 1
  const dt = 1 / fps
  const legs = legsOf(rig)
  const legIndices = legs.map((_, k) => k)
  const weights = featureWeights(legs.length)
  const reach = legs.map(leg => chainLength(leg.chain, rest))
  const radii = legs.map(leg => footRadii(leg, mannequin))
  const folded = legs.map((leg, k) => legFolded(leg, rest, reach[k], FOLD_DEGREES))
  const tucked = legs.map((leg, k) => legFolded(leg, rest, reach[k], TUCK_DEGREES))
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
  let blend: Blend | undefined
  let lastFrame: BodyFrame | undefined
  let previousFrame: BodyFrame | undefined
  let switched = false
  const startGround = ground(body.position[0], body.position[2])
  let base = startGround
  let settle = 0
  let fallSpeed: number | undefined
  const feet: Foot[] = legs.map(() => ({ reference: startGround, clearance: 0 }))

  const heightAboveGround = (p: Vec3): number => p[1] - ground(p[0], p[2])
  const groundRoot = (): Vec3 => [root.position[0], 0, root.position[2]]
  const toWorldPoint = (local: Vec3): Vec3 => add(groundRoot(), turnToWorld(local, root.yaw))
  const wantedVelocity = (): Vec3 => {
    return [Math.sin(command.heading) * command.speed, 0, Math.cos(command.heading) * command.speed]
  }

  const stepBody = (): void => {
    const want = wantedVelocity()
    const relative = sub(wind, body.velocity)
    let drag = scale([relative[0], 0, relative[2]], tuning.drag * length([relative[0], 0, relative[2]]))
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

  const query = (): number[] => {
    const want = wantedVelocity()
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

  const isPlaying = (candidate: { entry: number, frame: number }): boolean => {
    return candidate.entry === entry && Math.abs(candidate.frame - t) < SAME_FRAME
  }

  const bestCandidate = (wanted: number[], forced: boolean): number => {
    let best = -1
    let bestCost = Infinity
    candidates.forEach((candidate, c) => {
      let cost = 0
      for (let d = 0; d < wanted.length; d++) {
        const e = (wanted[d] - candidate.feature[d]) / scales[d]
        cost += weights[d] * e * e
        if (cost >= bestCost + STAY_BONUS) return
      }
      const playing = isPlaying(candidate)
      if (playing && forced) return
      if (playing) cost -= STAY_BONUS
      if (cost < bestCost) {
        bestCost = cost
        best = c
      }
    })
    return best
  }

  const search = (forced: boolean): void => {
    const best = bestCandidate(query(), forced)
    if (best < 0) return
    const chosen = candidates[best]
    if (isPlaying(chosen)) return
    if (lastFrame !== undefined) blend = blendFrom(lastFrame, previousFrame ?? lastFrame, frameCount)
    entry = chosen.entry
    t = chosen.frame
    switched = true
  }

  const playing = (): BodyFrame => {
    const frame = sampleFrame(entries[entry].frames, t)
    if (blend === undefined) return frame
    const span = BLEND_SECONDS * fps
    const n = frameCount - blend.start + 1
    if (n >= span) {
      blend = undefined
      return frame
    }
    return blended(frame, blend, n, span)
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
    const delta = turnToLocal(sub(to.root.position, from.root.position), from.root.yaw)
    root.position = add(root.position, turnToWorld(delta, root.yaw))
    root.yaw += turnBetween(from.root.yaw, to.root.yaw)
    root.position = add(root.position, scale(sub(body.position, root.position), SYNC))
    root.yaw += turnBetween(root.yaw, body.yaw) * SYNC
    t = next
  }

  const soles = (ankle: Vec3, rotation: Matrix, k: number): Soles => {
    const toe = add(ankle, apply(rotation, toeOffset[k]))
    return {
      heel: [ankle[0], ankle[1] - radii[k].ankle, ankle[2]],
      toe: [toe[0], toe[1] - radii[k].toe, toe[2]]
    }
  }

  const liftAboveGround = (ends: Soles, clearance: number): number => {
    return Math.max(0, clearance + ground(ends.heel[0], ends.heel[2]) - ends.heel[1],
      clearance + ground(ends.toe[0], ends.toe[2]) - ends.toe[1])
  }

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

  const releaseFrom = (last: Placed, target: Placed, step: boolean): Release => ({
    offset: sub(last.ankle, target.ankle),
    turn: multiply(last.rotation, transpose(target.rotation)),
    start: frameCount,
    step,
    from: last.ankle[1]
  })

  const followGround = (foot: Foot, world: Vec3, rotation: Matrix, k: number): void => {
    const velocity = foot.animated === undefined ? [0, 0, 0] : scale(sub(world, foot.animated), fps)
    foot.animated = world
    const ahead = add(world, scale([velocity[0], 0, velocity[2]], LOOKAHEAD_SECONDS))
    const ends = soles(world, rotation, k)
    const aheadEnds = soles(ahead, rotation, k)
    const highest = Math.max(...[ends.heel, ends.toe, aheadEnds.heel, aheadEnds.toe].map(p => ground(p[0], p[2])))
    if (isHeld(foot)) {
      const end = foot.heel ?? foot.toe as Vec3
      foot.reference = ground(end[0], end[2])
    } else {
      const rising = Math.min(highest, foot.reference + RISE_SPEED * dt)
      const sinking = Math.max(highest, foot.reference - SINK_SPEED * dt)
      foot.reference = highest >= foot.reference ? rising : sinking
    }
  }

  const easeRelease = (foot: Foot, target: Placed, k: number): Placed & { stepping: boolean } => {
    if (foot.release === undefined) return { ...target, stepping: false }
    const { offset, turn, start, step, from } = foot.release
    const u = clamp((frameCount - start) * dt / (step ? STEP_SECONDS : RELEASE_SECONDS), 0, 1)
    if (u >= 1) foot.release = undefined
    const w = 1 - u * u * (3 - 2 * u)
    const bump = step ? STEP_HEIGHT_SHARE * reach[k] * stepLift(u) : 0
    let ankle = add(target.ankle, [offset[0] * w, offset[1] * w + bump, offset[2] * w])
    if (step) ankle = [ankle[0], Math.max(ankle[1], from * w + target.ankle[1] * (1 - w) + bump), ankle[2]]
    return { ankle, rotation: multiply(interpolate(IDENTITY, turn, w), target.rotation), stepping: step && u < 1 }
  }

  const holdEnds = (
    foot: Foot,
    target: Placed,
    released: Placed & { stepping: boolean },
    contact: boolean,
    lastSoles: Soles | undefined,
    k: number
  ): Placed => {
    let ankle = released.ankle
    const free = soles(ankle, released.rotation, k)
    const drift = (end: Vec3 | undefined, now: Vec3): number => {
      return end === undefined ? 0 : Math.hypot(end[0] - now[0], end[2] - now[2])
    }
    const otherDown = legIndices.some(j => j !== k && isHeld(feet[j]))
    const drifted = Math.max(drift(foot.heel, free.heel), drift(foot.toe, free.toe)) / reach[k]
    const pulled = drifted > (otherDown ? RELEASE_SHARE : LONE_RELEASE_SHARE)
    const touching = contact && !released.stepping && !pulled
    const heelDown = touching && heightAboveGround(free.heel) <= HOLD_HEIGHT
    const toeDown = touching && heightAboveGround(free.toe) <= HOLD_HEIGHT
    const wasHeld = isHeld(foot)
    const grounded = (before: Vec3 | undefined, now: Vec3): Vec3 => {
      return before !== undefined && heightAboveGround(before) <= HOLD_HEIGHT ? before : now
    }
    if (!heelDown) foot.heel = undefined
    else if (foot.heel === undefined) foot.heel = grounded(lastSoles?.heel, free.heel)
    if (!toeDown) foot.toe = undefined
    else if (foot.toe === undefined) foot.toe = grounded(lastSoles?.toe, free.toe)
    if (foot.heel === undefined || foot.toe === undefined) foot.frozen = undefined
    else foot.frozen ??= foot.last?.rotation ?? released.rotation
    let rotation = foot.frozen ?? released.rotation
    if (foot.heel !== undefined) ankle = [foot.heel[0], ankle[1], foot.heel[2]]
    else if (foot.toe !== undefined) {
      const along = apply(rotation, toeOffset[k])
      ankle = [foot.toe[0] - along[0], ankle[1], foot.toe[2] - along[2]]
    } else if (wasHeld && foot.last !== undefined) {
      foot.release = releaseFrom(foot.last, target, pulled)
      ankle = foot.last.ankle
      rotation = foot.last.rotation
    }
    return { ankle, rotation }
  }

  const standClear = (foot: Foot, placed: Placed, contact: boolean, k: number): Vec3 => {
    const wanted = !contact && !isHeld(foot) ? SWING_CLEARANCE : 0
    const step = CLEARANCE_SPEED * dt
    foot.clearance = Math.min(foot.clearance + step, Math.max(foot.clearance - step, wanted))
    const lift = liftAboveGround(soles(placed.ankle, placed.rotation, k), foot.clearance)
    return [placed.ankle[0], placed.ankle[1] + lift, placed.ankle[2]]
  }

  const pinEnds = (foot: Foot, lastSoles: Soles | undefined, placed: Placed, k: number): Placed => {
    let { ankle, rotation } = placed
    if (lastSoles === undefined || foot.last === undefined) return { ankle, rotation }
    const now = soles(ankle, rotation, k)
    const pinned = ENDS.filter(end => {
      return heightAboveGround(lastSoles[end]) <= PIN_HEIGHT && heightAboveGround(now[end]) <= PIN_HEIGHT
    })
    const otherHeld = pinned.length === 1 && (pinned[0] === 'heel' ? foot.toe : foot.heel) !== undefined
    if (pinned.length === 2 || otherHeld) {
      rotation = foot.last.rotation
      ankle = [foot.last.ankle[0], ankle[1], foot.last.ankle[2]]
    } else if (pinned.length === 1) {
      const shift = sub(lastSoles[pinned[0]], now[pinned[0]])
      ankle = [ankle[0] + shift[0], ankle[1], ankle[2] + shift[2]]
    }
    if (pinned.length > 0) {
      const moved = soles(ankle, rotation, k)
      const under = Math.max(0, -heightAboveGround(moved.heel), -heightAboveGround(moved.toe))
      ankle = [ankle[0], ankle[1] + under, ankle[2]]
    }
    return { ankle, rotation }
  }

  const pressDown = (foot: Foot, placed: Placed, k: number): Placed => {
    const ends = soles(placed.ankle, placed.rotation, k)
    const held = ENDS.filter(end => foot[end] !== undefined).map(end => heightAboveGround(ends[end]))
    if (held.length === 0) return placed
    const gap = Math.max(0, Math.min(...held))
    return { ankle: [placed.ankle[0], placed.ankle[1] - gap, placed.ankle[2]], rotation: placed.rotation }
  }

  const placeFoot = (k: number, animated: Vec3, local: Matrix, contact: boolean): Placed => {
    const foot = feet[k]
    foot.prior = foot.last
    const turn = multiply(yawMatrix(root.yaw), local)
    const height = animated[1]
    const world = toWorldPoint(animated)
    const near = height < TILT_HEIGHT ? 1 - height / TILT_HEIGHT : 0
    const rotation = tilted(world, turn, k, near)
    if (fallSpeed === undefined) followGround(foot, world, rotation, k)
    const target: Placed = { ankle: [world[0], foot.reference + height, world[2]], rotation }
    foot.target = target
    const released = easeRelease(foot, target, k)
    const lastSoles = foot.last === undefined ? undefined : soles(foot.last.ankle, foot.last.rotation, k)
    const held = holdEnds(foot, target, released, contact, lastSoles, k)
    const clear = { ankle: standClear(foot, held, contact, k), rotation: held.rotation }
    const placed = pinEnds(foot, lastSoles, pressDown(foot, clear, k), k)
    foot.last = placed
    return placed
  }

  const solveLegs = (pose: Pose, transforms: Transforms, targets: Placed[]): number => {
    const unturn = transpose(yawMatrix(root.yaw))
    let clamped = 0
    legs.forEach((leg: Leg, k) => {
      const target = turnToLocal(sub(targets[k].ankle, groundRoot()), root.yaw)
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

  const stepOff = (k: number): void => {
    const foot = feet[k]
    if (foot.last === undefined || foot.target === undefined) return
    foot.heel = undefined
    foot.toe = undefined
    foot.frozen = undefined
    foot.release = releaseFrom(foot.last, foot.target, true)
  }

  const heightBounds = (hip: Vec3, ankle: Vec3, k: number): Bounds => {
    const flat = Math.hypot(ankle[0] - hip[0], ankle[2] - hip[2])
    const gap = hip[1] - ankle[1]
    const span = REACH_SHARE * reach[k]
    return {
      ceiling: flat < span ? Math.sqrt(span * span - flat * flat) - gap : Infinity,
      floor: flat < folded[k] ? Math.sqrt(folded[k] ** 2 - flat * flat) - gap : -Infinity,
      out: flat >= span
    }
  }

  const settleBody = (hips: Vec3[], targets: Placed[]): number => {
    const bounds = (k: number): Bounds => heightBounds(hips[k], targets[k].ankle, k)
    const heldLegs = (): number[] => legIndices.filter(k => isHeld(feet[k]))
    for (const k of heldLegs().filter(k => bounds(k).out)) stepOff(k)
    let floor = -Infinity
    let ceiling = Infinity
    for (let pass = 0; pass < legs.length; pass++) {
      const held = heldLegs()
      floor = Math.max(-Infinity, ...held.map(k => bounds(k).floor))
      ceiling = Math.min(Infinity, ...held.map(k => bounds(k).ceiling))
      if (floor <= ceiling || held.length === 0) break
      const limiting = held.reduce((a, b) => bounds(b).ceiling < bounds(a).ceiling ? b : a)
      stepOff(limiting)
    }
    const air = legIndices.filter(k => !isHeld(feet[k])).map(bounds)
    const airFloor = Math.max(-Infinity, ...air.map(b => b.floor))
    const airCeiling = Math.min(Infinity, ...air.map(b => b.ceiling))
    const free = Math.min(airCeiling, Math.max(airFloor, 0))
    const wanted = clamp(Number.isFinite(free) ? free : 0, Number.isFinite(floor) ? floor : -Infinity, ceiling)
    const ease = wanted < settle ? LOWER_SECONDS : BASE_SECONDS
    settle += (wanted - settle) * (1 - Math.exp(-dt / ease))
    if (!Number.isFinite(settle)) settle = 0
    return Math.min(ceiling, Math.max(floor, settle))
  }

  const supportUnderBody = (): number => ground(root.position[0], root.position[2])

  const letGoOfTheGround = (): void => {
    for (const foot of feet) {
      foot.heel = undefined
      foot.toe = undefined
      foot.frozen = undefined
      foot.release = undefined
    }
  }

  const fall = (): void => {
    fallSpeed = (fallSpeed ?? 0) + GRAVITY * dt
    const support = supportUnderBody()
    base = Math.max(support, base - fallSpeed * dt)
    for (const foot of feet) foot.reference = base
    if (base > support) return
    fallSpeed = undefined
    settle = 0
  }

  const standOnFeet = (pose: Pose, targets: Placed[]): number => {
    const lowest = Math.max(supportUnderBody() - BELOW_SUPPORT, Math.min(...feet.map(f => f.reference)))
    base += (lowest - base) * (1 - Math.exp(-dt / BASE_SECONDS))
    const hips = legs.map(leg => toWorldPoint(add(pose[leg.hip], [0, base, 0])))
    const drop = settleBody(hips, targets)
    keepAirFeetInRange(hips, targets, drop)
    return drop
  }

  const keepAirFeetInRange = (hips: Vec3[], targets: Placed[], drop: number): void => {
    legIndices.forEach(k => {
      if (isHeld(feet[k])) return
      const hip = add(hips[k], [0, drop, 0])
      let ankle = targets[k].ankle
      let flat = Math.hypot(ankle[0] - hip[0], ankle[2] - hip[2])
      const span = REACH_SHARE * reach[k]
      const low = (p: Vec3): boolean => heightAboveGround(p) <= PIN_HEIGHT
      const now = soles(ankle, targets[k].rotation, k)
      const prior = feet[k].prior
      const before = prior === undefined ? undefined : soles(prior.ankle, prior.rotation, k)
      const clear = before === undefined || !ENDS.some(end => low(now[end]) && low(before[end]))
      if (flat >= REACH_INSIDE * span && clear) {
        const inside = REACH_INSIDE * span / flat
        ankle = [hip[0] + (ankle[0] - hip[0]) * inside, ankle[1], hip[2] + (ankle[2] - hip[2]) * inside]
        flat = REACH_INSIDE * span
      }
      let y = ankle[1]
      if (flat < span) y = Math.max(y, hip[1] - Math.sqrt(span * span - flat * flat))
      if (flat < tucked[k]) y = Math.min(y, hip[1] - Math.sqrt(tucked[k] ** 2 - flat * flat))
      const under = liftAboveGround(soles([ankle[0], y, ankle[2]], targets[k].rotation, k), 0)
      if (y + under !== targets[k].ankle[1] || ankle !== targets[k].ankle) {
        targets[k] = { ...targets[k], ankle: [ankle[0], y + under, ankle[2]] }
        feet[k].last = { ankle: targets[k].ankle, rotation: targets[k].rotation }
      }
    })
  }

  return {
    wind,
    command: next => { command = next },
    height: () => base,
    falling: () => fallSpeed !== undefined,
    push: impulse => { body.velocity = add(body.velocity, [impulse[0], 0, impulse[2]]) },
    step: () => {
      switched = false
      stepBody()
      if (fallSpeed === undefined && base - supportUnderBody() > FALL_START_HEIGHT) {
        fallSpeed = 0
        letGoOfTheGround()
      }
      const ending = !entries[entry].endsAtRest && t + rate * RATE_RANGE[1] >= entries[entry].frames.length - 1
      if (frameCount === 0 || frameCount % SEARCH_EVERY === 0 || ending) search(ending)
      if (frameCount > 0) advance()
      const frame = playing()
      previousFrame = lastFrame
      lastFrame = frame
      const { pose, transforms } = assemble(frame, database.options, hierarchy)
      if (fallSpeed !== undefined) fall()
      const targets = legs.map((leg, k) => {
        return placeFoot(k, pose[leg.ankle], transforms[leg.ankle].rotation ?? IDENTITY, frame.contact[k] ?? true)
      })
      const drop = fallSpeed === undefined ? standOnFeet(pose, targets) : 0
      raise(pose, transforms, Object.keys(pose), base + drop)
      const clamped = solveLegs(pose, transforms, targets)
      frameCount++
      return {
        root: { position: [...root.position], yaw: root.yaw, velocity: [...body.velocity], angularVelocity: 0 },
        pose,
        transforms,
        planted: feet.map(isHeld),
        switched,
        clamped,
        clip: entries[entry].name,
        frame: Math.round(t)
      }
    }
  }
}
