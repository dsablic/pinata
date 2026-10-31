import type { Mannequin } from '../formats/mannequin.ts'
import type { Scenario, SimMaterial } from '../formats/sim.ts'
import { legsOf } from '../formats/rig.ts'
import type { AppendageLimb, Rig } from '../formats/rig.ts'
import { add, dot, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { bodyFrame, createSpringChain, startChain, stepChain } from '../motion/appendages.ts'
import type { SpringChain } from '../motion/appendages.ts'
import { planGait } from '../motion/gait.ts'
import type { GaitFrame } from '../motion/gait.ts'
import { poseAt } from '../motion/locomotion.ts'
import { restPose } from '../motion/pose.ts'
import type { Pose } from '../motion/pose.ts'
import type { RootState } from '../motion/script.ts'
import { parentsOf, transformTo } from '../motion/skeleton.ts'
import { apply, axisAngle, multiply } from '../math/matrix.ts'
import type { Matrix } from '../math/matrix.ts'
import { toWorld } from '../sim/body.ts'
import { buildClothSystem } from '../sim/cloth.ts'
import type { System } from '../sim/cloth.ts'
import { step as stepCloth, windAt } from '../sim/solver.ts'
import { pickActivity } from './config.ts'
import type { Step, WorldConfig } from './config.ts'
import { generateTerrain, random } from './terrain.ts'
import type { Terrain } from './terrain.ts'
import type { MotionDatabase } from '../mocap/database.ts'
import { createPlayer } from '../mocap/player.ts'
import type { Command, Player } from '../mocap/player.ts'
import { trackOf } from './track.ts'
import { turnBetween } from './yaw.ts'
import type { Move } from './track.ts'

export type CastMember = {
  name: string
  mannequin: Mannequin
  rig: Rig
  cloth?: { scenario: Scenario, materials: SimMaterial[] }
  capture?: MotionDatabase
}
export type ActorFrame = {
  name: string
  joints: Pose
  root: RootState
  activity: string
  say?: string
  handover?: true
  cloth?: Float64Array
}
export type WorldFrame = { index: number, time: number, actors: ActorFrame[] }
export type WorldOptions = { seed: number, cast: CastMember[], config: WorldConfig, fps: number }
export type World = {
  terrain: Terrain
  environment: WorldConfig['environment']
  lanes: number
  extent: [number, number]
  step: () => WorldFrame
  poke: (actor: number, fromX: number) => void
}

type Plant = { ankle: Vec3, yaw: number, pitch?: number }

const CAPTURE_ARRIVAL = 0.08
const CAPTURE_NEAR = 0.3
const CAPTURE_STOPPED = 0.05
const CAPTURE_WALK_GRACE = 3
const CAPTURE_APPROACH = 1.5
const CAPTURE_LANE_PULL = 2
const CAPTURE_TURN_GRACE = 1.5
const CAPTURE_SHOVE = 1.8
const CAPTURE_SHOVE_TOP = 2.5
const CAPTURE_MOVES_PER_FRAME = 8
type Actor = {
  member: CastMember
  rest: Pose
  lane: number
  root: RootState
  plants?: Plant[]
  frames: GaitFrame[]
  next: number
  steps: Step[]
  activity: string
  friend: number
  say?: { glyph: string, until: number }
  poked?: number
  chains: Array<{ chain: SpringChain, parent: string, started: boolean, base: Vec3, yaw: number }>
  cloth?: { system: System, scenario: Scenario, previous?: RootState }
  lean: { forward: number, side: number, forwardRate: number, sideRate: number, speed: number, phase: number }
  upper: string[]
  head: { angle: number, rate: number, leanRate: number, lift: number, liftRate: number }
  headJoints: string[]
  squashed: number
  wasPlanted: boolean[]
  player?: Player
  moves: Move[]
  moveStart: number
  moveFrom: number
  facing?: number
}

function headOf (member: CastMember, upper: string[], above: number): string[] {
  const rest = restPose(member.mannequin)
  const chains = new Set(member.rig.limbs.flatMap(limb => limb.joints))
  const top = Math.max(...Object.values(rest).map(p => p[1]))
  return upper.filter(joint => !chains.has(joint) && rest[joint][1] >= above * top)
}

const FACING_TOLERANCE = 0.05
const EDGE = 1

function legLength (member: CastMember): number {
  const rest = restPose(member.mannequin)
  return Math.min(...legsOf(member.rig).map(leg => rest[leg.hip][1] - rest[leg.ankle][1]))
}

function footLength (member: CastMember): number {
  const rest = restPose(member.mannequin)
  return Math.max(...legsOf(member.rig).map(leg => {
    const foot = member.mannequin.parts.find(p => p.shape === 'capsule' && p.a === leg.ankle && p.b === leg.toe)
    const radii = foot?.shape === 'capsule' ? foot.radiusA + foot.radiusB : 0
    const [a, t] = [rest[leg.ankle], rest[leg.toe]]
    return Math.hypot(t[0] - a[0], t[2] - a[2]) + radii
  }))
}

function halfLength (member: CastMember): number {
  const zs = Object.values(member.mannequin.joints).map(p => p[2])
  return (Math.max(...zs) - Math.min(...zs)) / 2
}

export function createWorld (options: WorldOptions): World {
  const { cast, config, fps } = options
  const { motion, targets } = config
  const next = random(options.seed)
  const terrain = generateTerrain(options.seed, {
    ...config.terrain,
    maxRise: config.terrain.riseOfLeg * Math.min(...cast.map(legLength)),
    minTread: config.terrain.treadOfFoot * Math.max(...cast.map(footLength))
  })
  const ground = terrain.ground
  const span: [number, number] = [terrain.from + EDGE, Math.min(terrain.to, config.terrain.length) - EDGE]
  let frameIndex = 0

  const { exaggerate } = config.life
  const actors: Actor[] = cast.map((original, i) => {
    const { gait } = original.rig
    const bobAmplitude = gait.bobAmplitude * exaggerate.bob
    const armSwingDegrees = gait.armSwingDegrees * exaggerate.armSwing
    const rig = { ...original.rig, gait: { ...gait, bobAmplitude, armSwingDegrees } }
    const member: CastMember = { ...original, rig }
    const lane = (i - (cast.length - 1) / 2) * config.lanes.spacing
    const x = span[0] + (span[1] - span[0]) * (i + 0.5) / cast.length
    const parents = parentsOf(member.rig)
    const chains = member.rig.limbs.filter((l): l is AppendageLimb => l.kind === 'appendage').map(limb => ({
      chain: createSpringChain(limb, restPose(member.mannequin)),
      parent: parents[limb.joints[0]] ?? member.rig.pelvis,
      started: false,
      base: [0, 0, 0] as Vec3,
      yaw: 0
    }))
    const cloth = member.cloth === undefined ? undefined : {
      system: buildClothSystem({ mannequin: member.mannequin, ...member.cloth }), scenario: member.cloth.scenario
    }
    const legJoints = new Set(legsOf(member.rig).flatMap(leg => leg.joints))
    const upper = Object.keys(parents).filter(joint => !legJoints.has(joint) && joint !== member.rig.pelvis)
    return {
      member,
      rest: restPose(member.mannequin),
      lane,
      upper,
      lean: { forward: 0, side: 0, forwardRate: 0, sideRate: 0, speed: 0, phase: next() },
      head: { angle: 0, rate: 0, leanRate: 0, lift: 0, liftRate: 0 },
      squashed: -Infinity,
      wasPlanted: [],
      headJoints: headOf(member, upper, config.life.head.above),
      ...(cloth === undefined ? {} : { cloth }),
      root: {
        position: [x, 0, lane], yaw: next() < 0.5 ? Math.PI / 2 : -Math.PI / 2, velocity: [0, 0, 0], angularVelocity: 0
      },
      frames: [],
      next: 0,
      steps: [],
      activity: 'arrive',
      friend: (i + 1) % cast.length,
      chains,
      moves: [],
      moveStart: 0,
      moveFrom: x
    }
  })
  for (const actor of actors) {
    const database = actor.member.capture
    if (database === undefined) continue
    actor.player = createPlayer({ database, fps, ground }, { position: actor.root.position, yaw: actor.root.yaw })
  }

  const facing = (actor: Actor, x: number): number => x >= actor.root.position[0] ? Math.PI / 2 : -Math.PI / 2
  const turnSeconds = (radians: number): number => {
    return Math.max(motion.minTurnSeconds, radians * motion.turnSecondsPerRadian)
  }
  const turnTo = (actor: Actor, yaw: number, moves: Move[]): void => {
    const turn = Math.abs(turnBetween(actor.root.yaw, yaw))
    if (turn < FACING_TOLERANCE) return
    moves.push({ kind: 'turn', yaw, seconds: turnSeconds(turn) })
  }

  const targetX = (actor: Actor, step: Extract<Step, { do: 'walk' }>): number => {
    const x = actor.root.position[0]
    const reach = (seconds: number): number => actor.member.rig.gait.referenceSpeed * step.speed * seconds
    const clamp = (v: number): number => Math.min(span[1], Math.max(span[0], v))
    if (step.to === 'random') {
      const offset = (2 * next() - 1) * reach(targets.random)
      const inside = x + offset >= span[0] && x + offset <= span[1]
      return clamp(inside ? x + offset : x - offset)
    }
    if (step.to === 'far') {
      const distance = Math.min(reach(targets.far), (span[1] - span[0]) / 2) * (0.6 + 0.4 * next())
      const room = [span[1] - x, x - span[0]]
      const direction = room[0] >= room[1] ? 1 : -1
      return clamp(x + direction * distance)
    }
    if (step.to === 'friend') {
      const friend = actors[actor.friend]
      const gap = targets.friendGap + halfLength(actor.member) + halfLength(friend.member)
      const fx = friend.root.position[0]
      const side = x <= fx ? -1 : 1
      return clamp(fx + side * gap)
    }
    const from = actor.poked ?? x
    const away = Math.sign(x - from) || (next() < 0.5 ? 1 : -1)
    const [near, far] = targets.away
    return clamp(x + away * Math.min(reach(targets.far), near + (far - near) * next()))
  }

  const movesOf = (actor: Actor, step: Step, time: number): Move[] => {
    const moves: Move[] = []
    const speedOf = (factor: number): number => actor.member.rig.gait.referenceSpeed * factor
    if (step.do === 'walk') {
      const x = targetX(actor, step)
      if (Math.abs(x - actor.root.position[0]) > 0.05) {
        turnTo(actor, facing(actor, x), moves)
        moves.push({ kind: 'walk', x, speed: speedOf(step.speed) })
      }
    } else if (step.do === 'face') {
      if (step.toward === 'camera') turnTo(actor, 0, moves)
      else {
        const friend = actors[actor.friend].root.position
        const d = sub(friend, actor.root.position)
        turnTo(actor, Math.atan2(d[0], d[2]), moves)
      }
    } else if (step.do === 'turn') {
      moves.push({
        kind: 'turn',
        yaw: actor.root.yaw + step.degrees * Math.PI / 180,
        seconds: turnSeconds(Math.abs(step.degrees) * Math.PI / 180)
      })
    } else {
      const seconds = step.seconds[0] + (step.seconds[1] - step.seconds[0]) * next()
      moves.push({ kind: 'stand', seconds })
      if (step.say !== undefined) actor.say = { glyph: step.say, until: time + seconds }
    }
    moves.push({ kind: 'stand', seconds: motion.settleSeconds })
    return moves
  }

  const startActivity = (actor: Actor): void => {
    actor.activity = pickActivity(config.activities, next())
    actor.steps = [...config.activities[actor.activity].steps]
    let friend = Math.floor(next() * (actors.length - 1))
    if (friend >= actors.indexOf(actor)) friend++
    actor.friend = actors.length > 1 ? friend : 0
  }

  const startle = (actor: Actor, time: number): void => {
    actor.steps = [...config.reactions.poke.steps]
    actor.activity = 'startled'
    actor.say = { glyph: config.reactions.poke.say, until: time + 1 }
  }

  const plan = (actor: Actor, time: number): void => {
    if (actor.steps.length === 0) startActivity(actor)
    const step = actor.steps.shift() as Step
    const { track, seconds } = trackOf(actor.root, movesOf(actor, step, time))
    const { member, rest } = actor
    const frames = planGait({
      track, rig: member.rig, rest, mannequin: member.mannequin, duration: seconds, fps, ground,
      ...(actor.plants === undefined ? {} : { initial: actor.plants })
    })
    actor.frames = frames
    actor.next = 0
    const last = frames[frames.length - 1]
    actor.root = { ...last.root, velocity: [0, 0, 0], angularVelocity: 0 }
    actor.plants = last.feet.map(foot => {
      const pitch = foot.surfacePitch === undefined ? {} : { pitch: foot.surfacePitch }
      return { ankle: foot.ankle, yaw: foot.toeYaw, ...pitch }
    })
  }

  type Turns = ReturnType<typeof poseAt>['transforms']
  const springs = (actor: Actor, body: RootState, joints: Pose, transforms: Turns): void => {
    const substeps = motion.springSubsteps
    const dt = 1 / (fps * substeps)
    for (const entry of actor.chains) {
      const root = entry.chain.limb.joints[0]
      const base = joints[root]
      const rotation = transforms[entry.parent]?.rotation
      if (!entry.started) {
        startChain(entry.chain, base, bodyFrame(body.yaw, rotation), frameIndex / fps, () => [0, 0, 0])
        entry.started = true
      } else {
        for (let s = 1; s <= substeps; s++) {
          const u = s / substeps
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

  const environment = structuredClone(config.environment)

  const forwardSpeed = (root: RootState): number => {
    return root.velocity[0] * Math.sin(root.yaw) + root.velocity[2] * Math.cos(root.yaw)
  }

  const spring = (value: number, rate: number, target: number, hz: number, damping: number, push = 0) => {
    const omega = 2 * Math.PI * hz
    const next = rate + (omega * omega * (target - value) - 2 * damping * omega * rate + push) / fps
    return { value: value + next / fps, rate: next }
  }

  const live = (actor: Actor, frame: GaitFrame, pose: Pose, transforms: Turns, time: number): void => {
    const { lean, sway, breathe, squash, head, anticipation } = config.life
    const state = actor.lean
    const degrees = Math.PI / 180
    const speed = forwardSpeed(frame.root)
    const acceleration = (speed - state.speed) * fps
    state.speed = speed
    const ahead = actor.frames.slice(actor.next + 2, actor.next + 4)
    const upcoming = ahead.length === 2 ? (forwardSpeed(ahead[1].root) - forwardSpeed(ahead[0].root)) * fps : 0
    const wind = windAt(environment.wind, time)
    const yaw = frame.root.yaw
    const facing: Vec3 = [Math.sin(yaw), 0, Math.cos(yaw)]
    const right: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)]
    const limit = lean.max * degrees
    const clampLean = (v: number): number => Math.min(limit, Math.max(-limit, v))
    const idle = Math.abs(speed) < 0.05 && Math.abs(frame.root.angularVelocity) < 0.05
    const wave = (period: number): number => Math.sin(2 * Math.PI * (time / period + state.phase))
    const target = {
      forward: clampLean((acceleration - anticipation * upcoming) * lean.perAcceleration * degrees -
        dot(wind, facing) * lean.perWind * degrees),
      side: clampLean(frame.root.angularVelocity * lean.perTurn * degrees - dot(wind, right) * lean.perWind * degrees +
        (idle ? sway.degrees * degrees * wave(sway.period) : 0))
    }
    const forward = spring(state.forward, state.forwardRate, target.forward, lean.frequency, lean.damping)
    const side = spring(state.side, state.sideRate, target.side, lean.frequency, lean.damping)
    const leanAcceleration = (forward.rate - state.forwardRate) * fps
    state.forward = forward.value
    state.forwardRate = forward.rate
    state.side = side.value
    state.sideRate = side.rate
    const landed = frame.feet.some((foot, k) => foot.planted && actor.wasPlanted[k] === false)
    actor.wasPlanted = frame.feet.map(foot => foot.planted)
    if (landed) actor.squashed = time
    const since = (time - actor.squashed) / squash.seconds
    const squeeze = since >= 0 && since < 1 ? squash.amount * (1 - since) * (1 - since) : 0
    const lift = frame.pelvisOffset[1]
    const liftAcceleration = ((lift - actor.head.lift) * fps - actor.head.liftRate) * fps
    actor.head.liftRate = (lift - actor.head.lift) * fps
    actor.head.lift = lift
    const push = -head.gain * degrees * (leanAcceleration + liftAcceleration)
    const nod = spring(actor.head.angle, actor.head.rate, 0, head.frequency, head.damping, push)
    actor.head.angle = clampLean(nod.value)
    actor.head.rate = nod.rate
    const turn = multiply(axisAngle([0, 0, 1], -state.side), axisAngle([1, 0, 0], state.forward))
    const pivot = pose[actor.member.rig.pelvis]
    const rise = breathe.amplitude * wave(breathe.period)
    const place = (joint: string, rotation: Matrix, about: Vec3, extra: Vec3): void => {
      const at = pose[joint]
      if (at === undefined) return
      const moved = add(add(about, apply(rotation, sub(at, about))), extra)
      pose[joint] = moved
      const before = transforms[joint]?.rotation
      const turned = before === undefined ? rotation : multiply(rotation, before)
      transforms[joint] = transformTo(turned, actor.rest[joint], moved)
    }
    for (const joint of actor.upper) {
      const above = sub(pose[joint] ?? pivot, pivot)
      const squashed: Vec3 = [above[0] * squeeze * 0.5, -above[1] * squeeze + rise, above[2] * squeeze * 0.5]
      place(joint, turn, pivot, squashed)
    }
    if (actor.headJoints.length > 0) {
      const neck = actor.headJoints.reduce((low, j) => pose[j][1] < pose[low][1] ? j : low)
      const nodding = axisAngle([1, 0, 0], actor.head.angle)
      const base = pose[neck]
      for (const joint of actor.headJoints) place(joint, nodding, base, [0, 0, 0])
    }
  }

  const weather = (actor: Actor, root: RootState, pose: Pose, transforms: Turns): Float64Array | undefined => {
    const cloth = actor.cloth
    if (cloth === undefined) return undefined
    const { particles } = cloth.system
    if (cloth.previous === undefined) {
      for (let i = 0; i < particles.count; i++) {
        const at: Vec3 = [particles.position[3 * i], particles.position[3 * i + 1], particles.position[3 * i + 2]]
        const p = toWorld(at, root)
        particles.position.set(p, 3 * i)
        particles.previous.set(p, 3 * i)
      }
    } else {
      const from = cloth.previous
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
      for (let s = 1; s <= substeps; s++) {
        stepCloth(cloth.system, {
          env, body: actor.member.mannequin, exclude: cloth.scenario.bodyExcludeParts, track,
          pose: () => pose,
          transforms: () => transforms,
          t: (frameIndex - 1 + s / substeps) / fps,
          dt: 1 / (fps * substeps)
        })
      }
    }
    cloth.previous = root
    return particles.position.slice(0, 3 * particles.count)
  }

  const actorFrame = (
    actor: Actor,
    root: RootState,
    pose: Pose,
    transforms: Turns,
    time: number,
    handover: boolean
  ): ActorFrame => {
    const body: Pose = { ...actor.rest, ...pose }
    const joints: Pose = {}
    for (const [name, local] of Object.entries(body)) joints[name] = toWorld(local, root)
    springs(actor, root, joints, transforms)
    const cloth = weather(actor, root, body, transforms)
    const say = actor.say !== undefined && actor.say.until > time ? actor.say.glyph : undefined
    return {
      name: actor.member.name,
      joints,
      root,
      activity: actor.activity,
      ...(say === undefined ? {} : { say }),
      ...(cloth === undefined ? {} : { cloth }),
      ...(handover && frameIndex > 0 ? { handover: true as const } : {})
    }
  }

  const commandFor = (actor: Actor, move: Move, time: number): Command | undefined => {
    const { position, yaw } = actor.root
    const elapsed = time - actor.moveStart
    if (move.kind === 'walk') {
      const dx = move.x - position[0]
      const stopped = Math.hypot(actor.root.velocity[0], actor.root.velocity[2]) < CAPTURE_STOPPED
      const late = elapsed > CAPTURE_WALK_GRACE + Math.abs(move.x - actor.moveFrom) / Math.max(move.speed, 0.1)
      if (Math.abs(dx) < CAPTURE_ARRIVAL || (Math.abs(dx) < CAPTURE_NEAR && stopped) || late) return undefined
      actor.facing = dx > 0 ? Math.PI / 2 : -Math.PI / 2
      const pull = Math.abs(dx) > CAPTURE_NEAR ? (actor.lane - position[2]) * CAPTURE_LANE_PULL : 0
      return { speed: Math.min(move.speed, CAPTURE_APPROACH * Math.abs(dx)), heading: Math.atan2(dx, pull) }
    }
    if (move.kind === 'turn') {
      const facing = Math.abs(turnBetween(yaw, move.yaw)) < FACING_TOLERANCE
      const done = facing || elapsed > move.seconds + CAPTURE_TURN_GRACE
      return done ? undefined : { speed: 0, heading: move.yaw }
    }
    return elapsed >= move.seconds ? undefined : { speed: 0, heading: actor.facing ?? yaw }
  }

  const stepCaptured = (actor: Actor, player: Player, time: number): ActorFrame => {
    let handover = false
    if (actor.poked !== undefined) {
      const away = Math.sign(actor.root.position[0] - actor.poked) || 1
      const along = actor.root.velocity[0] * away
      const shoved = Math.min(along + CAPTURE_SHOVE, Math.max(along, CAPTURE_SHOVE_TOP))
      player.push([away * (shoved - along), 0, 0])
      startle(actor, time)
      actor.moves = []
    }
    let command: Command | undefined
    for (let guard = 0; guard < CAPTURE_MOVES_PER_FRAME && command === undefined; guard++) {
      if (actor.moves.length === 0) {
        if (actor.steps.length === 0) startActivity(actor)
        actor.moves = movesOf(actor, actor.steps.shift() as Step, time)
        actor.moveStart = time
        actor.moveFrom = actor.root.position[0]
        handover = true
      }
      command = commandFor(actor, actor.moves[0], time)
      if (command === undefined) {
        actor.moves.shift()
        actor.moveStart = time
        actor.moveFrom = actor.root.position[0]
      }
    }
    actor.poked = undefined
    const given = command ?? { speed: 0, heading: actor.facing ?? actor.root.yaw }
    if (command !== undefined && actor.moves[0]?.kind === 'turn') actor.facing = given.heading
    player.command(given)
    const wind = windAt(environment.wind, time)
    player.wind[0] = wind[0]
    player.wind[1] = wind[1]
    player.wind[2] = wind[2]
    const frame = player.step()
    actor.root = frame.root
    return actorFrame(actor, frame.root, frame.pose, frame.transforms, time, handover)
  }

  const stepActor = (actor: Actor, time: number): ActorFrame => {
    if (actor.player !== undefined) return stepCaptured(actor, actor.player, time)
    if (actor.poked !== undefined && actor.frames[actor.next]?.feet.every(foot => foot.planted) !== false) {
      const frame = actor.frames[Math.max(0, actor.next - 1)]
      if (frame !== undefined) {
        actor.root = { ...frame.root, velocity: [0, 0, 0], angularVelocity: 0 }
        actor.plants = frame.feet.map(foot => ({ ankle: foot.ankle, yaw: foot.toeYaw }))
      }
      startle(actor, time)
      actor.frames = []
      actor.next = 0
      plan(actor, time)
      actor.poked = undefined
    }
    let handover = actor.next === 0 && actor.frames.length > 0
    if (actor.next >= actor.frames.length) {
      plan(actor, time)
      handover = true
    }
    const frame = actor.frames[actor.next++]
    const { member } = actor
    const { pose, transforms } = poseAt({ frame, rig: member.rig, rest: actor.rest, mannequin: member.mannequin })
    live(actor, frame, pose, transforms, time)
    return actorFrame(actor, frame.root, pose, transforms, time, handover)
  }

  return {
    terrain,
    environment,
    lanes: (cast.length - 1) / 2 * config.lanes.spacing,
    extent: [span[0] - EDGE, span[1] + EDGE],
    poke: (index, fromX) => {
      const actor = actors[index]
      if (actor !== undefined) actor.poked = fromX
    },
    step: () => {
      const time = frameIndex / fps
      const frame: WorldFrame = { index: frameIndex, time, actors: actors.map(actor => stepActor(actor, time)) }
      frameIndex++
      return frame
    }
  }
}
