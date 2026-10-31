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
import { heightUnder, surfaceBelow } from './surfaces.ts'
import type { Ground, Surface } from './surfaces.ts'

export type Place = { x: number, height: number }
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
}
export type Walker = {
  step: () => WalkerFrame
  frame: () => WalkerFrame
  setGround: (ground: Ground) => void
  shiftBy: (dx: number, dy: number) => void
  moveTo: (place: Place) => void
  poke: () => void
  support: () => Surface | undefined
}
export type WalkerOptions = {
  database: MotionDatabase
  fps: number
  random: () => number
  ground: Ground
  place: Place
  yaw: number
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
const ON_NODE = 1e-3

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

  const worldStanding = (): number => standing + offset[1]
  const groundAt = (x: number, z: number): number => {
    return heightUnder(ground, worldStanding, STEP_HEIGHT)(x + offset[0], z) - offset[1]
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
    return { joints, root, base: worldStanding(), falling, ...support, feet, heading, moving }
  }

  const start = (place: Place, yaw: number): void => {
    offset = [0, 0]
    standing = place.height
    player = createPlayer({ database, fps, ground: groundAt }, { position: [place.x, 0, 0], yaw })
    const root: RootState = { position: [place.x, 0, 0], yaw, velocity: [0, 0, 0], angularVelocity: 0 }
    const lifted: Pose = {}
    for (const [name, p] of Object.entries(rest)) lifted[name] = [p[0], p[1] + place.height, p[2]]
    current = frameOf(root, lifted, legs.map(() => true), false)
    route = []
    goal = undefined
    restUntil = time
  }
  start(options.place, options.yaw)

  const here = (): Node | undefined => {
    const under = current.support
    if (current.falling || under === undefined) return undefined
    return nodeAt(graph, current.root.position[0], under.height, ON_NODE)
  }

  const aimAt = (node: Node, x: number): void => {
    route = []
    goal = { node: node.id, x, height: node.height }
    legStart = time
  }

  const chooseGoal = (from: Node): void => {
    const roomy = reachable(graph, from.id).map(id => graph.nodes[id]).filter(n => n.to - n.from > 2 * END_MARGIN)
    const total = roomy.reduce((sum, n) => sum + n.to - n.from, 0)
    let pick = random() * total
    const node = roomy.find(n => (pick -= n.to - n.from) <= 0) ?? roomy.at(-1)
    if (node === undefined) return
    aimAt(node, node.from + END_MARGIN + random() * (node.to - node.from - 2 * END_MARGIN))
  }

  const arrive = (): void => {
    goal = undefined
    route = []
    restUntil = time + REST_SECONDS[0] + random() * (REST_SECONDS[1] - REST_SECONDS[0])
  }

  const followRoute = (node: Node): { speed: number, target: number } | undefined => {
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
    if (distance < ARRIVED) return undefined
    return { speed: Math.max(SLOWEST_SPEED, Math.min(WALK_SPEED, WALK_SPEED * distance / SLOW_WITHIN)), target: goal.x }
  }

  const decide = (): { speed: number, heading: number } => {
    const node = here()
    if (node === undefined) return { speed: current.falling ? 0 : WALK_SPEED, heading }
    if (goal === undefined && time >= restUntil) chooseGoal(node)
    if (goal === undefined) return { speed: 0, heading }
    const move = followRoute(node)
    if (move === undefined) {
      arrive()
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
      goal = kept === undefined || goal === undefined ? undefined : { ...goal, node: kept.id }
      current = { ...current, ...supportOf(supportAt(current.root.position[0])) }
    },
    shiftBy: (dx, dy) => {
      offset = [offset[0] + dx, offset[1] + dy]
      if (goal !== undefined) goal = { ...goal, x: goal.x + dx, height: goal.height + dy }
      current = shifted(current, dx, dy)
    },
    moveTo: place => { start(place, current.root.yaw) },
    poke: () => {
      const node = here()
      heading = heading === EAST ? WEST : EAST
      if (node === undefined) return
      const away = current.root.position[0] + (heading === EAST ? POKE_RUN : -POKE_RUN)
      const roomy = node.to - node.from > 2 * END_MARGIN
      const middle = (node.from + node.to) / 2
      const x = roomy ? Math.min(node.to - END_MARGIN, Math.max(node.from + END_MARGIN, away)) : middle
      aimAt(node, x)
    },
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
