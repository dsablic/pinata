import { legsOf } from '../formats/rig.ts'
import { createPlayer } from '../mocap/player.ts'
import type { Player, PlayerFrame } from '../mocap/player.ts'
import type { MotionDatabase } from '../mocap/database.ts'
import { solePoints } from '../motion/pose.ts'
import type { Pose } from '../motion/pose.ts'
import type { RootState } from '../motion/script.ts'
import type { Vec3 } from '../math/vec.ts'
import { toWorld } from '../sim/body.ts'
import { nodeAt, path, reachable, surfaceGraph } from './graph.ts'
import type { Edge, Graph, Node, Reach } from './graph.ts'
import { DEPTH_WITH_NO_GROUND, surfaceBelow } from './surfaces.ts'
import type { Ground, Surface } from './surfaces.ts'

export type Place = { x: number, height: number }
export type Activity = 'rest' | 'wander' | 'visit' | 'flee' | 'drop'
export type Foot = { planted: boolean, soles: Array<[number, number]> }
export type WalkerFrame = {
  joints: Pose
  root: RootState
  base: number
  falling: boolean
  support?: Surface | undefined
  feet: Foot[]
  heading: number
  moving: boolean
  activity: Activity
  started: number
  reached: boolean
}
export type Walker = {
  step: () => WalkerFrame
  frame: () => WalkerFrame
  setGround: (ground: Ground) => void
  shiftBy: (dx: number, dy: number) => void
  moveTo: (place: Place) => void
  dropIn: (place: Place, above: number) => void
  poke: () => void
  visit: (place: Place) => boolean
  reaches: (place: Place) => boolean
  support: () => Surface | undefined
}
export type WalkerOptions = {
  database: MotionDatabase
  fps: number
  random: () => number
  ground: Ground
  place: Place
  yaw: number
  attraction?: (surface: number) => number
}

export const STEP_HEIGHT = 0.2
export const DROP_LIMIT = 6
const WALK_SPEED = 1.1
const SLOWEST_SPEED = 0.35
const SLOW_WITHIN = 0.5
const ARRIVED = 0.06
const END_MARGIN = 0.35
const REST_SECONDS: [number, number] = [0.8, 4]
const LEG_TIMEOUT_SECONDS = 10
const POKE_RUN = 1.5
const LINGER_PER_ATTRACTION = 0.5
const ON_NODE = 1e-3
const SOLE_REACH = 0.02

type Goal = { node: number, x: number, height: number }
const EAST = Math.PI / 2
const WEST = -Math.PI / 2

function tallest (pose: Pose): number {
  return Math.max(...Object.values(pose).map(p => p[1]))
}

function headingTo (from: number, to: number): number {
  return to >= from ? EAST : WEST
}

export function createWalker (options: WalkerOptions): Walker {
  const { database, fps, random } = options
  const { rig, rest, mannequin } = database.options
  const legs = legsOf(rig)
  const reach: Reach = { step: STEP_HEIGHT, drop: DROP_LIMIT, body: tallest(rest) }
  let ground = options.ground
  let graph: Graph = surfaceGraph(ground, reach)
  let standing = options.place.height
  let offset: [number, number] = [0, 0]
  let player: Player
  let current: WalkerFrame
  let heading = options.yaw
  let route: Edge[] = []
  let goal: Goal | undefined
  let restUntil = 0
  let legStart = 0
  let time = 0
  let activity: Activity = 'rest'
  let reached = false
  let started = 0
  const attraction = options.attraction ?? (() => 0)

  const begin = (next: Activity): void => {
    activity = next
    started++
  }

  const worldStanding = (): number => standing + offset[1]
  const groundAt = (x: number, z: number, from?: number): number => {
    const reach = worldStanding() + STEP_HEIGHT
    const limit = from === undefined ? reach : Math.max(reach, from + offset[1] + SOLE_REACH)
    const surface = surfaceBelow(ground, x + offset[0], limit, 0)
    return (surface?.height ?? worldStanding() - DEPTH_WITH_NO_GROUND) - offset[1]
  }
  const supportAt = (x: number): Surface | undefined => surfaceBelow(ground, x, worldStanding(), STEP_HEIGHT)

  const frameOf = (local: RootState, pose: Pose, planted: boolean[], moving: boolean): WalkerFrame => {
    const [dx, dy] = offset
    const root: RootState = { ...local, position: [local.position[0] + dx, local.position[1], local.position[2]] }
    const joints: Pose = {}
    for (const [name, p] of Object.entries({ ...rest, ...pose })) {
      const world = toWorld(p, local)
      joints[name] = [world[0] + dx, world[1] + dy, world[2]]
    }
    const feet = legs.map((leg, k): Foot => {
      const soles = solePoints(joints, leg, mannequin).map((p): [number, number] => [p[0], p[1]])
      return { planted: planted[k] ?? false, soles }
    })
    const falling = player?.falling() ?? false
    const under = supportAt(root.position[0])
    const support = under === undefined ? {} : { support: under }
    const doing = { heading, moving, activity, started, reached }
    return { joints, root, base: worldStanding(), falling, ...support, feet, ...doing }
  }

  const start = (place: Place, yaw: number, above = 0): void => {
    offset = [0, 0]
    standing = place.height + above
    const at = { position: [place.x, 0, 0] as Vec3, yaw, ...(above > 0 ? { height: standing } : {}) }
    player = createPlayer({ database, fps, ground: groundAt }, at)
    const root: RootState = { position: [place.x, 0, 0], yaw, velocity: [0, 0, 0], angularVelocity: 0 }
    const lifted: Pose = {}
    for (const [name, p] of Object.entries(rest)) lifted[name] = [p[0], p[1] + standing, p[2]]
    current = frameOf(root, lifted, legs.map(() => above === 0), false)
    route = []
    goal = undefined
    restUntil = time
    activity = 'rest'
    reached = false
  }
  start(options.place, options.yaw)



  const here = (): Node | undefined => {
    const under = current.support
    if (current.falling || under === undefined) return undefined
    return nodeAt(graph, current.root.position[0], under.height, ON_NODE)
  }

  const aimAt = (node: Node, x: number, next: Activity): void => {
    route = []
    goal = { node: node.id, x, height: node.height }
    legStart = time
    begin(next)
  }

  const inside = (node: Node, x: number): number => {
    if (node.to - node.from <= 2 * END_MARGIN) return (node.from + node.to) / 2
    return Math.min(node.to - END_MARGIN, Math.max(node.from + END_MARGIN, x))
  }

  const chooseGoal = (from: Node): void => {
    const roomy = reachable(graph, from.id).map(id => graph.nodes[id]).filter(n => n.to - n.from > 2 * END_MARGIN)
    const weight = (n: Node): number => (n.to - n.from) * (1 + attraction(n.surface))
    const total = roomy.reduce((sum, n) => sum + weight(n), 0)
    let pick = random() * total
    const node = roomy.find(n => (pick -= weight(n)) <= 0) ?? roomy.at(-1)
    if (node === undefined) return
    aimAt(node, node.from + END_MARGIN + random() * (node.to - node.from - 2 * END_MARGIN), 'wander')
  }

  const arrive = (there: boolean): void => {
    reached = there
    goal = undefined
    route = []
    const linger = 1 + attraction(current.support?.id ?? -1) * LINGER_PER_ATTRACTION
    restUntil = time + linger * (REST_SECONDS[0] + random() * (REST_SECONDS[1] - REST_SECONDS[0]))
    begin('rest')
  }

  const target = (place: Place): Node | undefined => {
    const from = here()
    const node = nodeAt(graph, place.x, place.height, ON_NODE)
    if (from === undefined || node === undefined) return undefined
    return from.id === node.id || path(graph, from.id, node.id) !== undefined ? node : undefined
  }

  const followRoute = (node: Node): { speed: number, target: number } | 'arrived' | undefined => {
    if (goal === undefined) return undefined
    if (route.length > 0 && node.id === route[0].to) {
      route.shift()
      legStart = time
    }
    const onCourse = route.length > 0 ? node.id === route[0].from : node.id === goal.node
    if (!onCourse) {
      const replanned = path(graph, node.id, goal.node, goal.x)
      if (replanned === undefined) return undefined
      route = replanned
    }
    if (time - legStart > LEG_TIMEOUT_SECONDS) return undefined
    const x = current.root.position[0]
    if (route.length > 0) return { speed: WALK_SPEED, target: route[0].at }
    const distance = Math.abs(goal.x - x)
    if (distance < ARRIVED) return 'arrived'
    return { speed: Math.max(SLOWEST_SPEED, Math.min(WALK_SPEED, WALK_SPEED * distance / SLOW_WITHIN)), target: goal.x }
  }

  const decide = (): { speed: number, heading: number } => {
    const node = here()
    if (node === undefined) return { speed: current.falling ? 0 : WALK_SPEED, heading }
    if (goal === undefined && time >= restUntil) chooseGoal(node)
    if (goal === undefined) return { speed: 0, heading }
    const move = followRoute(node)
    if (move === undefined || move === 'arrived') {
      arrive(move === 'arrived')
      return { speed: 0, heading }
    }
    heading = headingTo(current.root.position[0], move.target)
    return { speed: move.speed, heading }
  }

  return {
    step: () => {
      const command = decide()
      player.command(command)
      const frame: PlayerFrame = player.step()
      standing = player.height()
      time += 1 / fps
      current = frameOf(frame.root, frame.pose, frame.planted, command.speed > 0)
      return current
    },
    frame: () => current,
    setGround: next => {
      ground = next
      graph = surfaceGraph(ground, reach)
      route = []
      const kept = goal === undefined ? undefined : nodeAt(graph, goal.x, goal.height, ON_NODE)
      if (goal !== undefined && kept === undefined) arrive(false)
      else if (goal !== undefined && kept !== undefined) goal = { ...goal, node: kept.id }
      current = { ...current, ...supportOf(supportAt(current.root.position[0])) }
    },
    shiftBy: (dx, dy) => {
      offset = [offset[0] + dx, offset[1] + dy]
      if (goal !== undefined) goal = { ...goal, x: goal.x + dx, height: goal.height + dy }
      current = shifted(current, dx, dy)
    },
    moveTo: place => { start(place, current.root.yaw) },
    dropIn: (place, above) => {
      start(place, current.root.yaw, above)
      activity = 'drop'
      current = { ...current, falling: true, activity }
    },
    poke: () => {
      const node = here()
      heading = heading === EAST ? WEST : EAST
      if (node === undefined) return
      const away = current.root.position[0] + (heading === EAST ? POKE_RUN : -POKE_RUN)
      aimAt(node, inside(node, away), 'flee')
    },
    visit: place => {
      const node = target(place)
      if (node === undefined) return false
      aimAt(node, inside(node, place.x), 'visit')
      return true
    },
    reaches: place => target(place) !== undefined,
    support: () => supportAt(current.root.position[0])
  }
}

function supportOf (under: Surface | undefined): { support: Surface | undefined } {
  return { support: under }
}

function shifted (frame: WalkerFrame, dx: number, dy: number): WalkerFrame {
  const move = (p: Vec3): Vec3 => [p[0] + dx, p[1] + dy, p[2]]
  const joints = Object.fromEntries(Object.entries(frame.joints).map(([name, p]) => [name, move(p)]))
  const position: Vec3 = [frame.root.position[0] + dx, frame.root.position[1], frame.root.position[2]]
  const feet = frame.feet.map(foot => ({
    ...foot, soles: foot.soles.map(([x, y]): [number, number] => [x + dx, y + dy])
  }))
  return { ...frame, joints, root: { ...frame.root, position }, base: frame.base + dy, feet }
}
