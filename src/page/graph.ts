import type { Ground, Surface, Wall } from './surfaces.ts'

export type Reach = { step: number, drop: number, body: number }
export type Node = { id: number, surface: number, from: number, to: number, height: number }
export type Edge = { from: number, to: number, kind: 'walk' | 'drop', at: number }
export type Graph = { nodes: Node[], edges: Edge[] }

const BEYOND_END = 0.02
const INTO_NEXT = 0.15
const SAME_PLACE = 1e-6

type Span = [number, number]

function subtract (spans: Span[], [from, to]: Span): Span[] {
  return spans.flatMap(([a, b]): Span[] => {
    if (to <= a || from >= b) return [[a, b]]
    return [[a, from], [to, b]].filter(([x, y]) => y - x > SAME_PLACE) as Span[]
  })
}

function hides (cover: Surface, coverIndex: number, under: Surface, underIndex: number, step: number): boolean {
  const rise = cover.height - under.height
  return rise > 0 ? rise <= step : rise === 0 && coverIndex < underIndex
}

function blocks (wall: Wall, height: number, reach: Reach): boolean {
  return wall.top > height + reach.step && wall.bottom < height + reach.body
}

function blockingWalls (ground: Ground, height: number, reach: Reach): Span[] {
  const sides = new Map<number, number[]>()
  for (const wall of ground.walls) {
    if (blocks(wall, height, reach)) sides.set(wall.id, [...sides.get(wall.id) ?? [], wall.x])
  }
  return [...sides.values()].map((xs): Span => [Math.min(...xs), Math.max(...xs)])
}

function visibleSpans (ground: Ground, index: number, reach: Reach): Span[] {
  const surface = ground.surfaces[index]
  let spans: Span[] = [[surface.from, surface.to]]
  ground.surfaces.forEach((cover, i) => {
    if (i !== index && hides(cover, i, surface, index, reach.step)) spans = subtract(spans, [cover.from, cover.to])
  })
  for (const wall of blockingWalls(ground, surface.height, reach)) spans = subtract(spans, wall)
  return spans
}

export function nodeAt (graph: Graph, x: number, height: number, tolerance: number): Node | undefined {
  let best: Node | undefined
  for (const node of graph.nodes) {
    if (x < node.from - SAME_PLACE || x > node.to + SAME_PLACE) continue
    if (Math.abs(node.height - height) > tolerance) continue
    if (best === undefined || Math.abs(node.height - height) < Math.abs(best.height - height)) best = node
  }
  return best
}

function landing (nodes: Node[], x: number, height: number, step: number): Node | undefined {
  let best: Node | undefined
  for (const node of nodes) {
    if (x < node.from || x > node.to || node.height > height + step) continue
    if (best === undefined || node.height > best.height) best = node
  }
  return best
}

function walled (ground: Ground, node: Node, end: number, reach: Reach): boolean {
  return ground.walls.some(w => Math.abs(w.x - end) <= BEYOND_END && blocks(w, node.height, reach))
}

function edgesFrom (ground: Ground, nodes: Node[], node: Node, reach: Reach): Edge[] {
  const edges: Edge[] = []
  for (const [end, direction] of [[node.from, -1], [node.to, 1]] as const) {
    if (walled(ground, node, end, reach)) continue
    const next = landing(nodes, end + direction * BEYOND_END, node.height, reach.step)
    if (next === undefined || next.id === node.id) continue
    const fall = node.height - next.height
    const kind = fall <= reach.step ? 'walk' : 'drop'
    if (kind === 'drop' && fall > reach.drop) continue
    const at = Math.min(next.to, Math.max(next.from, end + direction * INTO_NEXT))
    edges.push({ from: node.id, to: next.id, kind, at })
  }
  return edges
}

export function surfaceGraph (ground: Ground, reach: Reach): Graph {
  const nodes: Node[] = []
  ground.surfaces.forEach((surface, index) => {
    for (const [from, to] of visibleSpans(ground, index, reach)) {
      nodes.push({ id: nodes.length, surface: surface.id, from, to, height: surface.height })
    }
  })
  const edges = nodes.flatMap(node => edgesFrom(ground, nodes, node, reach))
  return { nodes, edges }
}

export function path (graph: Graph, from: number, to: number, towards?: number): Edge[] | undefined {
  const via = new Map<number, Edge | undefined>([[from, undefined]])
  const queue = [from]
  while (queue.length > 0) {
    const at = queue.shift() as number
    if (at === to) break
    for (const edge of graph.edges) {
      if (edge.from !== at || via.has(edge.to)) continue
      via.set(edge.to, edge)
      queue.push(edge.to)
    }
  }
  if (!via.has(to)) return undefined
  const route: Edge[] = []
  for (let edge = via.get(to); edge !== undefined; edge = via.get(edge.from)) route.unshift(edge)
  let target = towards
  for (let i = route.length - 1; i >= 0; i--) {
    const aim = target
    const parallel = graph.edges.filter(e => e.from === route[i].from && e.to === route[i].to)
    if (aim !== undefined) route[i] = parallel.reduce((a, b) => Math.abs(b.at - aim) < Math.abs(a.at - aim) ? b : a)
    target = route[i].at
  }
  return route
}

export function reachable (graph: Graph, from: number): number[] {
  const seen = new Set([from])
  const queue = [from]
  while (queue.length > 0) {
    const at = queue.shift() as number
    for (const edge of graph.edges) {
      if (edge.from !== at || seen.has(edge.to)) continue
      seen.add(edge.to)
      queue.push(edge.to)
    }
  }
  return [...seen]
}
