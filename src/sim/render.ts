import type { CapsulePart, Mannequin } from '../formats/mannequin.ts'
import type { Render, Scenario } from '../formats/sim.ts'
import type { Vec3 } from '../math/vec.ts'
import type { RootState } from '../motion/script.ts'
import { toLocal } from './body.ts'

export type ClothParts = { joints: Record<string, Vec3>, parts: CapsulePart[] }

type Strand = { name: string, first: number, count: number, render: Render, grid?: number }

function strands (scenario: Scenario): Strand[] {
  const out: Strand[] = []
  let first = 0
  const { cape } = scenario
  if (cape !== undefined) {
    const count = cape.columns * cape.rows
    if (cape.render !== undefined) out.push({ name: 'cape', first, count, render: cape.render, grid: cape.columns })
    first += count
  }
  scenario.chains.forEach((chain, i) => {
    if (chain.render !== undefined) out.push({ name: `chain${i}`, first, count: chain.links + 1, render: chain.render })
    first += chain.links + 1
  })
  return out
}

function capsule (name: string, ends: [string, string], render: Render): CapsulePart {
  const { material, radius } = render
  const [a, b] = ends
  return { name, shape: 'capsule', a, b, radiusA: radius, radiusB: radius, material, allowThin: true }
}

function edges (strand: Strand): Array<[number, number]> {
  const { count, grid } = strand
  const out: Array<[number, number]> = []
  for (let i = 0; i < count; i++) {
    if (grid === undefined) {
      if (i + 1 < count) out.push([i, i + 1])
      continue
    }
    if ((i + 1) % grid !== 0) out.push([i, i + 1])
    if (i + grid < count) out.push([i, i + grid])
  }
  return out
}

export function clothParts (scenario: Scenario, positions: Float64Array, root: RootState): ClothParts {
  const joints: Record<string, Vec3> = {}
  const parts: CapsulePart[] = []
  for (const strand of strands(scenario)) {
    const id = (i: number): string => `${strand.name}.${i}`
    for (let i = 0; i < strand.count; i++) {
      const k = 3 * (strand.first + i)
      joints[id(i)] = toLocal([positions[k], positions[k + 1], positions[k + 2]], root)
    }
    for (const [a, b] of edges(strand)) parts.push(capsule(`${strand.name}.${a}-${b}`, [id(a), id(b)], strand.render))
  }
  return { joints, parts }
}

export function withClothParts (m: Mannequin, cloth: ClothParts): Mannequin {
  return { ...m, joints: { ...m.joints, ...cloth.joints }, parts: [...m.parts, ...cloth.parts] }
}
