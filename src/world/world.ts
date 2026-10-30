import type { Mannequin } from '../formats/mannequin.ts'
import { legsOf } from '../formats/rig.ts'
import type { AppendageLimb, Rig } from '../formats/rig.ts'
import { add, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { bodyFrame, createSpringChain, startChain, stepChain } from '../motion/appendages.ts'
import type { SpringChain } from '../motion/appendages.ts'
import { planGait } from '../motion/gait.ts'
import type { GaitFrame } from '../motion/gait.ts'
import { poseAt } from '../motion/locomotion.ts'
import { restPose } from '../motion/pose.ts'
import type { Pose } from '../motion/pose.ts'
import type { RootState } from '../motion/script.ts'
import { parentsOf } from '../motion/skeleton.ts'
import { toWorld } from '../sim/body.ts'
import { pickActivity } from './activities.ts'
import type { Activities, Step } from './activities.ts'
import { generateTerrain, random } from './terrain.ts'
import type { Terrain } from './terrain.ts'
import { trackOf, turnBetween } from './track.ts'
import type { Move } from './track.ts'

export type CastMember = { name: string, mannequin: Mannequin, rig: Rig }
export type ActorFrame = {
  name: string
  joints: Pose
  root: RootState
  activity: string
  say?: string
  /** True in the first frame of a new plan, where the previous one handed over. */
  handover?: true
}
export type WorldFrame = { index: number, time: number, actors: ActorFrame[] }
export type WorldOptions = {
  seed: number
  cast: CastMember[]
  activities: Activities
  fps: number
  /** World length along x, metres. */
  length: number
}
export type World = {
  terrain: Terrain
  step: () => WorldFrame
  /** Startles an actor, as a click on it from a side does: it reacts with the poke steps. */
  poke: (actor: number, fromX: number) => void
}

type Plant = { ankle: Vec3, yaw: number, pitch?: number }
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
}

const LANE_SPACING = 0.45
const SPRING_SUBSTEPS = 4
const SETTLE_SECONDS = 0.7
const TURN_SECONDS_PER_RADIAN = 0.45
const MIN_TURN_SECONDS = 0.4
const FACING_TOLERANCE = 0.05
const EDGE = 1
const VISIT_GAP = 0.45
const POKE_SAY = '!'
const AWAY_MIN = 2
const AWAY_MAX = 4
/** Longest walks, in seconds at the walk's speed: a wander, and a dash to somewhere far. */
const WANDER_SECONDS = 8
const FAR_SECONDS = 14

function legLength (member: CastMember): number {
  const rest = restPose(member.mannequin)
  return Math.min(...legsOf(member.rig).map(leg => rest[leg.hip][1] - rest[leg.ankle][1]))
}

/** Half the character's size along x at rest, for spacing visits. */
function halfLength (member: CastMember): number {
  const zs = Object.values(member.mannequin.joints).map(p => p[2])
  return (Math.max(...zs) - Math.min(...zs)) / 2
}

/**
 * A world of characters on a seeded terrain, each living its own day: it picks an activity by weight, and each step
 * of the activity becomes a short plan (a root track planned into footsteps on the terrain from where its feet stand),
 * so the plans join without a jump. Deterministic for a seed.
 */
export function createWorld (options: WorldOptions): World {
  const { cast, activities, fps } = options
  const next = random(options.seed)
  const maxRise = 0.3 * Math.min(...cast.map(legLength))
  const terrain = generateTerrain(options.seed, {
    length: options.length, maxRise, maxSlopeDegrees: 16, maxHeight: Math.min(1.2, 8 * maxRise)
  })
  const ground = terrain.ground
  const span: [number, number] = [terrain.from + EDGE, Math.min(terrain.to, options.length) - EDGE]
  let frameIndex = 0

  const actors: Actor[] = cast.map((member, i) => {
    const lane = (i - (cast.length - 1) / 2) * LANE_SPACING
    const x = span[0] + (span[1] - span[0]) * (i + 0.5) / cast.length
    const parents = parentsOf(member.rig)
    const chains = member.rig.limbs.filter((l): l is AppendageLimb => l.kind === 'appendage').map(limb => ({
      chain: createSpringChain(limb, restPose(member.mannequin)),
      parent: parents[limb.joints[0]] ?? member.rig.pelvis,
      started: false,
      base: [0, 0, 0] as Vec3,
      yaw: 0
    }))
    return {
      member,
      rest: restPose(member.mannequin),
      lane,
      root: {
        position: [x, 0, lane], yaw: next() < 0.5 ? Math.PI / 2 : -Math.PI / 2, velocity: [0, 0, 0], angularVelocity: 0
      },
      frames: [],
      next: 0,
      steps: [],
      activity: 'arrive',
      friend: (i + 1) % cast.length,
      chains
    }
  })

  const facing = (actor: Actor, x: number): number => x >= actor.root.position[0] ? Math.PI / 2 : -Math.PI / 2
  const turnTo = (actor: Actor, yaw: number, moves: Move[]): void => {
    const turn = Math.abs(turnBetween(actor.root.yaw, yaw))
    if (turn < FACING_TOLERANCE) return
    moves.push({ kind: 'turn', yaw, seconds: Math.max(MIN_TURN_SECONDS, turn * TURN_SECONDS_PER_RADIAN) })
  }

  const targetX = (actor: Actor, step: Extract<Step, { do: 'walk' }>): number => {
    const x = actor.root.position[0]
    const reach = (seconds: number): number => actor.member.rig.gait.referenceSpeed * step.speed * seconds
    const clamp = (v: number): number => Math.min(span[1], Math.max(span[0], v))
    if (step.to === 'random') return clamp(x + (2 * next() - 1) * reach(WANDER_SECONDS))
    if (step.to === 'far') {
      const distance = Math.min(reach(FAR_SECONDS), (span[1] - span[0]) / 2) * (0.6 + 0.4 * next())
      const room = [span[1] - x, x - span[0]]
      const direction = room[0] >= room[1] ? 1 : -1
      return clamp(x + direction * distance)
    }
    if (step.to === 'friend') {
      const friend = actors[actor.friend]
      const gap = VISIT_GAP + halfLength(actor.member) + halfLength(friend.member)
      const fx = friend.root.position[0]
      const side = x <= fx ? -1 : 1
      return clamp(fx + side * gap)
    }
    const from = actor.poked ?? x
    const away = Math.sign(x - from) || (next() < 0.5 ? 1 : -1)
    return clamp(x + away * Math.min(reach(FAR_SECONDS), AWAY_MIN + (AWAY_MAX - AWAY_MIN) * next()))
  }

  /** Turns the actor's next step into moves; stand steps also set what it says. */
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
        seconds: Math.max(MIN_TURN_SECONDS, Math.abs(step.degrees) * Math.PI / 180 * TURN_SECONDS_PER_RADIAN)
      })
    } else {
      const seconds = step.seconds[0] + (step.seconds[1] - step.seconds[0]) * next()
      moves.push({ kind: 'stand', seconds })
      if (step.say !== undefined) actor.say = { glyph: step.say, until: time + seconds }
    }
    moves.push({ kind: 'stand', seconds: SETTLE_SECONDS })
    return moves
  }

  const plan = (actor: Actor, time: number): void => {
    if (actor.steps.length === 0) {
      actor.activity = pickActivity(activities, next())
      actor.steps = [...activities.activities[actor.activity].steps]
      let friend = Math.floor(next() * (actors.length - 1))
      if (friend >= actors.indexOf(actor)) friend++
      actor.friend = actors.length > 1 ? friend : 0
    }
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
  const springs = (actor: Actor, frame: GaitFrame, joints: Pose, transforms: Turns): void => {
    const dt = 1 / (fps * SPRING_SUBSTEPS)
    for (const entry of actor.chains) {
      const root = entry.chain.limb.joints[0]
      const base = joints[root]
      const rotation = transforms[entry.parent]?.rotation
      if (!entry.started) {
        startChain(entry.chain, base, bodyFrame(frame.root.yaw, rotation), frameIndex / fps, () => [0, 0, 0])
        entry.started = true
      } else {
        for (let s = 1; s <= SPRING_SUBSTEPS; s++) {
          const u = s / SPRING_SUBSTEPS
          const at = add(entry.base, scale(sub(base, entry.base), u))
          const yaw = entry.yaw + turnBetween(entry.yaw, frame.root.yaw) * u
          stepChain(entry.chain, at, bodyFrame(yaw, rotation), (frameIndex - 1 + u) / fps, dt)
        }
      }
      entry.base = base
      entry.yaw = frame.root.yaw
      entry.chain.segments.forEach((segment, i) => { joints[entry.chain.limb.joints[i + 1]] = segment.tip })
    }
  }

  const stepActor = (actor: Actor, time: number): ActorFrame => {
    if (actor.poked !== undefined && actor.frames[actor.next]?.feet.every(foot => foot.planted) !== false) {
      const frame = actor.frames[Math.max(0, actor.next - 1)]
      if (frame !== undefined) {
        actor.root = { ...frame.root, velocity: [0, 0, 0], angularVelocity: 0 }
        actor.plants = frame.feet.map(foot => ({ ankle: foot.ankle, yaw: foot.toeYaw }))
      }
      actor.steps = [...activities.reactions.poke]
      actor.activity = 'startled'
      actor.frames = []
      actor.next = 0
      actor.say = { glyph: POKE_SAY, until: time + 1 }
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
    const joints: Pose = {}
    for (const [name, local] of Object.entries({ ...actor.rest, ...pose })) joints[name] = toWorld(local, frame.root)
    springs(actor, frame, joints, transforms)
    const say = actor.say !== undefined && actor.say.until > time ? actor.say.glyph : undefined
    return {
      name: actor.member.name,
      joints,
      root: frame.root,
      activity: actor.activity,
      ...(say === undefined ? {} : { say }),
      ...(handover && frameIndex > 0 ? { handover: true as const } : {})
    }
  }

  return {
    terrain,
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
