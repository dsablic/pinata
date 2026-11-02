import type { Mannequin } from '../formats/mannequin.ts'
import type { Cape, Chain, Scenario, SimMaterial } from '../formats/sim.ts'
import { add, dot, length, normalize, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'

export type Particles = {
  position: Float64Array
  previous: Float64Array
  inverseMass: Float64Array
  materialIndex: Uint32Array
  count: number
}
export type DistanceConstraint = { a: number, b: number, rest: number, compliance: number }
export type Pin = { particle: number, joint: string, offset: Vec3 }
export type System = { particles: Particles, constraints: DistanceConstraint[], pins: Pin[], material: SimMaterial[] }

function createParticles (points: Vec3[], material: SimMaterial, pinned: Set<number>): Particles {
  const count = points.length
  const position = new Float64Array(3 * count)
  const inverseMass = new Float64Array(count)
  points.forEach((p, i) => {
    position.set(p, 3 * i)
    inverseMass[i] = pinned.has(i) ? 0 : 1 / material.particleMass
  })
  return { position, previous: position.slice(), inverseMass, materialIndex: new Uint32Array(count), count }
}

function constrain (
  constraints: DistanceConstraint[],
  points: Vec3[],
  pairs: Array<[number, number]>,
  compliance: number
): void {
  for (const [a, b] of pairs) {
    const [dx, dy, dz] = sub(points[a], points[b])
    constraints.push({ a, b, rest: Math.hypot(dx, dy, dz), compliance })
  }
}

export function buildCape (cape: Cape, m: Mannequin, material: SimMaterial): System {
  const { columns, rows } = cape
  const left = m.joints[cape.anchorLeft]
  const right = m.joints[cape.anchorRight]
  const index = (i: number, j: number): number => j * columns + i
  const points: Vec3[] = []
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const top = add(left, scale(sub(right, left), i / (columns - 1)))
      points.push([top[0], top[1] - cape.length * j / (rows - 1), top[2]])
    }
  }
  const stretch: Array<[number, number]> = []
  const shear: Array<[number, number]> = []
  const bend: Array<[number, number]> = []
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      if (i + 1 < columns) stretch.push([index(i, j), index(i + 1, j)])
      if (j + 1 < rows) stretch.push([index(i, j), index(i, j + 1)])
      if (i + 1 < columns && j + 1 < rows) {
        shear.push([index(i, j), index(i + 1, j + 1)], [index(i + 1, j), index(i, j + 1)])
      }
      if (i + 2 < columns) bend.push([index(i, j), index(i + 2, j)])
      if (j + 2 < rows) bend.push([index(i, j), index(i, j + 2)])
    }
  }
  const constraints: DistanceConstraint[] = []
  constrain(constraints, points, stretch, material.stretchCompliance)
  constrain(constraints, points, shear, material.stretchCompliance)
  constrain(constraints, points, bend, material.bendCompliance)
  const pins: Pin[] = []
  for (let i = 0; i < columns; i++) {
    pins.push({ particle: index(i, 0), joint: cape.anchorLeft, offset: sub(points[index(i, 0)], left) })
  }
  const pinned = new Set(pins.map(pin => pin.particle))
  return { particles: createParticles(points, material, pinned), constraints, pins, material: [material] }
}

export function buildChain (chain: Chain, m: Mannequin, material: SimMaterial): System {
  const root = m.joints[chain.anchor]
  const step = scale(normalize(chain.direction), chain.linkLength)
  const points: Vec3[] = []
  for (let i = 0; i <= chain.links; i++) points.push(add(root, scale(step, i)))
  const stretch: Array<[number, number]> = []
  const bend: Array<[number, number]> = []
  for (let i = 0; i < chain.links; i++) stretch.push([i, i + 1])
  for (let i = 0; i + 2 <= chain.links; i++) bend.push([i, i + 2])
  const constraints: DistanceConstraint[] = []
  constrain(constraints, points, stretch, material.stretchCompliance)
  constrain(constraints, points, bend, material.bendCompliance)
  const pins: Pin[] = [
    { particle: 0, joint: chain.anchor, offset: [0, 0, 0] },
    { particle: 1, joint: chain.anchor, offset: step }
  ]
  return { particles: createParticles(points, material, new Set([0, 1])), constraints, pins, material: [material] }
}

export function mergeSystems (systems: System[]): System {
  const count = systems.reduce((sum, s) => sum + s.particles.count, 0)
  const particles: Particles = {
    position: new Float64Array(3 * count),
    previous: new Float64Array(3 * count),
    inverseMass: new Float64Array(count),
    materialIndex: new Uint32Array(count),
    count
  }
  const merged: System = { particles, constraints: [], pins: [], material: [] }
  let first = 0
  for (const system of systems) {
    const source = system.particles
    particles.position.set(source.position, 3 * first)
    particles.previous.set(source.previous, 3 * first)
    particles.inverseMass.set(source.inverseMass, first)
    const materialOffset = merged.material.length
    for (let i = 0; i < source.count; i++) particles.materialIndex[first + i] = source.materialIndex[i] + materialOffset
    for (const c of system.constraints) merged.constraints.push({ ...c, a: c.a + first, b: c.b + first })
    for (const pin of system.pins) merged.pins.push({ ...pin, particle: pin.particle + first })
    merged.material.push(...system.material)
    first += source.count
  }
  return merged
}

export function capeHemIndices (cape: Cape): number[] {
  return Array.from({ length: cape.columns }, (_, i) => (cape.rows - 1) * cape.columns + i)
}

export type Binding = {
  joint: string
  from?: string
  rings: number[][]
  onBone: Vec3[]
  bone: Vec3
}

export function bindings (system: System, joints: string[], m: Mannequin, drawn = m.parts): Binding[] {
  const { position, inverseMass } = system.particles
  const neighbours = neighbourLists(system)
  return joints.map(joint => {
    const [nearest] = nearestParticles(system, m.joints[joint], i => inverseMass[i] !== 0, 1)
    const path = pathFromPin(system, nearest, neighbours)
    const from = drawn.find(part => part.b === joint && part.a !== joint)?.a
    const end = m.joints[joint]
    const start = from === undefined ? meanOf(position, [path[0], ...neighbours[path[0]]]) : m.joints[from]
    const rings = path.map(i => [i, ...neighbours[i]])
      .filter((ring, k) => k === path.length - 1 || alongLine(meanOf(position, ring), start, end) > PAST_START)
    const onBone = rings.map((ring, k) => {
      const at = meanOf(position, ring)
      return sub(k === rings.length - 1 ? end : nearestOnLine(at, start, end), at)
    })
    return { joint, ...(from === undefined ? {} : { from }), rings, onBone, bone: sub(end, start) }
  })
}

function alongLine (p: Vec3, a: Vec3, b: Vec3): number {
  const along = sub(b, a)
  return dot(sub(p, a), along) / dot(along, along)
}

function nearestOnLine (p: Vec3, a: Vec3, b: Vec3): Vec3 {
  return add(a, scale(sub(b, a), Math.max(0, Math.min(1, alongLine(p, a, b)))))
}

const PAST_START = 0.05

function neighbourLists (system: System): number[][] {
  const rests = new Map<string, number>()
  const all: number[][] = Array.from({ length: system.particles.count }, () => [])
  for (const { a, b, rest } of system.constraints) {
    rests.set(`${a} ${b}`, rest)
    rests.set(`${b} ${a}`, rest)
    all[a].push(b)
    all[b].push(a)
  }
  const restOf = (a: number, b: number): number | undefined => rests.get(`${a} ${b}`)
  const spans = (a: number, b: number, rest: number): boolean => all[a].some(m => {
    const [first, second] = [restOf(a, m), restOf(m, b)]
    if (first === undefined || second === undefined) return false
    const straight = Math.abs(first + second - rest) < SAME_LENGTH * rest
    const diagonal = Math.abs(Math.hypot(first, second) - rest) < SAME_LENGTH * rest
    return straight || diagonal
  })
  const lists: number[][] = Array.from({ length: system.particles.count }, () => [])
  for (const { a, b, rest } of system.constraints) {
    if (spans(a, b, rest)) continue
    lists[a].push(b)
    lists[b].push(a)
  }
  return lists
}

const SAME_LENGTH = 0.02

function pathFromPin (system: System, end: number, neighbours: number[][]): number[] {
  const { inverseMass } = system.particles
  const back = new Map<number, number>([[end, -1]])
  const queue = [end]
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k]
    if (inverseMass[i] === 0) {
      const path = [i]
      for (let j = back.get(i) as number; j !== -1; j = back.get(j) as number) path.push(j)
      return path
    }
    for (const next of neighbours[i]) {
      if (back.has(next)) continue
      back.set(next, i)
      queue.push(next)
    }
  }
  return [end]
}

export function particleAt (positions: Float64Array, i: number): Vec3 {
  return [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]]
}

export function meanOf (positions: Float64Array, particles: number[]): Vec3 {
  return scale(particles.map(i => particleAt(positions, i)).reduce(add), 1 / particles.length)
}

function nearestParticles (system: System, to: Vec3, eligible: (i: number) => boolean, count: number): number[] {
  const { position } = system.particles
  const distance = (i: number): number => length(sub(particleAt(position, i), to))
  return Array.from({ length: system.particles.count }, (_, i) => i).filter(eligible)
    .sort((p, q) => distance(p) - distance(q)).slice(0, count)
}

function material (materials: SimMaterial[], name: string): SimMaterial {
  const found = materials.find(m => m.name === name)
  if (found === undefined) throw new Error(`unknown material '${name}'`)
  return found
}

export function buildClothSystem (
  options: { mannequin: Mannequin, scenario: Scenario, materials: SimMaterial[] }
): System {
  const { mannequin, scenario, materials } = options
  const systems: System[] = []
  const { cape } = scenario
  if (cape !== undefined) systems.push(buildCape(cape, mannequin, material(materials, cape.material)))
  for (const chain of scenario.chains) systems.push(buildChain(chain, mannequin, material(materials, chain.material)))
  return mergeSystems(systems)
}
