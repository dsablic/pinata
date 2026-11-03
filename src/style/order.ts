export const ORDER_HYSTERESIS = 0.03

export type Ordered = { name: string, layer: number, depth: number }

function mustPrecede (a: Ordered, b: Ordered): boolean {
  if (a.layer !== b.layer) return a.layer < b.layer
  return a.depth - b.depth > ORDER_HYSTERESIS
}

function startingOrder<T extends Ordered> (parts: T[], previous: string[]): T[] {
  const rank = new Map(previous.map((name, i) => [name, i]))
  const mannequin = new Map(parts.map((part, i) => [part.name, i]))
  const start = parts.filter(part => rank.has(part.name))
    .sort((a, b) => (rank.get(a.name) ?? 0) - (rank.get(b.name) ?? 0))
  for (const part of parts) {
    if (rank.has(part.name)) continue
    const at = start.findIndex(other => (mannequin.get(other.name) ?? 0) > (mannequin.get(part.name) ?? 0))
    start.splice(at < 0 ? start.length : at, 0, part)
  }
  return start
}

export function drawOrder<T extends Ordered> (parts: T[], previous: string[] = []): T[] {
  const order = startingOrder(parts, previous)
  for (let i = 1; i < order.length; i++) {
    const earliest = order.findIndex(other => mustPrecede(order[i], other))
    if (earliest >= 0 && earliest < i) order.splice(earliest, 0, ...order.splice(i, 1))
  }
  return order
}
