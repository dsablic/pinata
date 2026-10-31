export type Grid = string[][]
export type Rotated = { grid: Grid, pivot: [number, number] }

const TRANSPARENT = '.'
const UPSCALE_PASSES = 3
const FACTOR = 2 ** UPSCALE_PASSES

export function toGrid (rows: string[]): Grid {
  return rows.map(row => [...row])
}

export function scale2x (grid: Grid): Grid {
  const h = grid.length
  const w = grid[0]?.length ?? 0
  const at = (x: number, y: number): string => {
    return x < 0 || y < 0 || x >= w || y >= h ? TRANSPARENT : grid[y][x]
  }
  const out: Grid = Array.from({ length: 2 * h }, () => new Array<string>(2 * w))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = grid[y][x]
      const a = at(x, y - 1)
      const b = at(x + 1, y)
      const c = at(x - 1, y)
      const d = at(x, y + 1)
      out[2 * y][2 * x] = c === a && c !== d && a !== b ? a : p
      out[2 * y][2 * x + 1] = a === b && a !== c && b !== d ? b : p
      out[2 * y + 1][2 * x] = d === c && d !== b && c !== a ? c : p
      out[2 * y + 1][2 * x + 1] = b === d && b !== a && d !== c ? d : p
    }
  }
  return out
}

const UPSCALED = new WeakMap<Grid, Grid>()

function upscaled (grid: Grid): Grid {
  let big = UPSCALED.get(grid)
  if (big === undefined) {
    big = grid
    for (let i = 0; i < UPSCALE_PASSES; i++) big = scale2x(big)
    UPSCALED.set(grid, big)
  }
  return big
}

export type RotOptions = { sample?: 'mode' | 'centre', offset?: [number, number] }

export function rotSprite (grid: Grid, pivot: [number, number], angle: number, options: RotOptions = {}): Rotated {
  const [ox0, oy0] = options.offset ?? [0, 0]
  const centreOnly = options.sample === 'centre'
  const big = upscaled(grid)
  const h = big.length
  const w = big[0]?.length ?? 0
  const cos = clean(Math.cos(angle))
  const sin = clean(Math.sin(angle))
  const px = (pivot[0] + 0.5) * FACTOR
  const py = (pivot[1] + 0.5) * FACTOR
  const reach = Math.ceil(Math.hypot(w, h) / FACTOR) + 1
  const pivotOut = Math.floor(pivot[0]) + reach
  const pivotRow = Math.floor(pivot[1]) + reach
  const size = 2 * reach + 1 + Math.max(grid[0]?.length ?? 0, grid.length)
  const sampleAt = (ox: number, oy: number, sx: number, sy: number): string => {
    const dx = (ox - pivotOut) * FACTOR + sx + 0.5 - FACTOR / 2 + ox0
    const dy = (oy - pivotRow) * FACTOR + sy + 0.5 - FACTOR / 2 + oy0
    const bx = Math.floor(px + dx * cos + dy * sin)
    const by = Math.floor(py - dx * sin + dy * cos)
    return bx < 0 || by < 0 || bx >= w || by >= h ? TRANSPARENT : big[by][bx]
  }
  const out: Grid = []
  for (let oy = 0; oy < size; oy++) {
    const row: string[] = []
    for (let ox = 0; ox < size; ox++) {
      if (centreOnly) {
        row.push(sampleAt(ox, oy, FACTOR / 2, FACTOR / 2))
        continue
      }
      const counts = new Map<string, number>()
      for (let sy = 0; sy < FACTOR; sy++) {
        for (let sx = 0; sx < FACTOR; sx++) {
          const colour = sampleAt(ox, oy, sx, sy)
          counts.set(colour, (counts.get(colour) ?? 0) + 1)
        }
      }
      row.push(mode(counts, sampleAt(ox, oy, FACTOR / 2, FACTOR / 2)))
    }
    out.push(row)
  }
  return trim({ grid: out, pivot: [pivotOut, pivotRow] })
}

function mode (counts: Map<string, number>, centre: string): string {
  const rank = (colour: string, count: number): [number, number, number] => {
    return [count, colour === centre ? 1 : 0, colour === TRANSPARENT ? 0 : 1]
  }
  let best = TRANSPARENT
  let bestRank: [number, number, number] = [-1, 0, 0]
  for (const colour of [...counts.keys()].sort()) {
    const r = rank(colour, counts.get(colour) as number)
    const first = [0, 1, 2].find(i => r[i] !== bestRank[i])
    const better = first !== undefined && r[first] > bestRank[first]
    if (better) {
      best = colour
      bestRank = r
    }
  }
  return best
}

function clean (v: number): number {
  const SNAP = 1e-12
  return Math.abs(v) < SNAP ? 0 : Math.abs(Math.abs(v) - 1) < SNAP ? Math.sign(v) : v
}

function trim (rotated: Rotated): Rotated {
  const { grid, pivot } = rotated
  let top = grid.length
  let bottom = -1
  let left = grid[0]?.length ?? 0
  let right = -1
  grid.forEach((row, y) => row.forEach((c, x) => {
    if (c === TRANSPARENT) return
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
    left = Math.min(left, x)
    right = Math.max(right, x)
  }))
  if (bottom < 0) return { grid: [[TRANSPARENT]], pivot: [0, 0] }
  return {
    grid: grid.slice(top, bottom + 1).map(row => row.slice(left, right + 1)),
    pivot: [pivot[0] - left, pivot[1] - top]
  }
}

export function rotateNearest (grid: Grid, pivot: [number, number], angle: number): Rotated {
  const h = grid.length
  const w = grid[0]?.length ?? 0
  const cos = clean(Math.cos(angle))
  const sin = clean(Math.sin(angle))
  const reach = Math.ceil(Math.hypot(w, h))
  const out: Grid = []
  for (let dy = -reach; dy <= reach; dy++) {
    const row: string[] = []
    for (let dx = -reach; dx <= reach; dx++) {
      const sx = Math.floor(pivot[0] + 0.5 + dx * cos + dy * sin)
      const sy = Math.floor(pivot[1] + 0.5 - dx * sin + dy * cos)
      row.push(sx < 0 || sy < 0 || sx >= w || sy >= h ? TRANSPARENT : grid[sy][sx])
    }
    out.push(row)
  }
  return trim({ grid: out, pivot: [reach, reach] })
}

export function jaggies (grid: Grid): number {
  const h = grid.length
  const w = grid[0]?.length ?? 0
  const at = (x: number, y: number): string => x < 0 || y < 0 || x >= w || y >= h ? TRANSPARENT : grid[y][x]
  let count = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = at(x, y)
      if (c === TRANSPARENT) continue
      let alone = true
      for (let dy = -1; dy <= 1 && alone; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx !== 0 || dy !== 0) && at(x + dx, y + dy) === c) {
            alone = false
            break
          }
        }
      }
      if (alone) count++
    }
  }
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const block = [at(x, y), at(x + 1, y), at(x, y + 1), at(x + 1, y + 1)]
      for (const c of new Set(block)) {
        if (c === TRANSPARENT || block.filter(b => b === c).length !== 3) continue
        let around = 0
        for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) if (at(x + dx, y + dy) === c) around++
        if (around <= 6) count++
      }
    }
  }
  return count
}

const OFFSET_STEPS = 8
const AREA_TOLERANCE = 0.15

function colourCounts (grid: Grid): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of grid) for (const c of row) if (c !== TRANSPARENT) counts.set(c, (counts.get(c) ?? 0) + 1)
  return counts
}

export function cleanRotation (grid: Grid, pivot: [number, number], angle: number): Rotated {
  const quarter = Math.abs(Math.sin(2 * angle)) < 1e-12
  if (quarter) return rotSprite(grid, pivot, angle, { sample: 'centre' })
  const source = colourCounts(grid)
  let best: Rotated | undefined
  let bestScore: [number, number] = [Infinity, Infinity]
  for (let y = 0; y < OFFSET_STEPS; y++) {
    for (let x = 0; x < OFFSET_STEPS; x++) {
      const offset: [number, number] = [x - (OFFSET_STEPS - 1) / 2, y - (OFFSET_STEPS - 1) / 2]
      const rotated = rotSprite(grid, pivot, angle, { sample: 'centre', offset })
      const counts = colourCounts(rotated.grid)
      const strays = [...source].map(([c, n]) => Math.abs((counts.get(c) ?? 0) - n) - (AREA_TOLERANCE * n + 1))
      const stray = Math.max(0, ...strays)
      const score: [number, number] = [stray, jaggies(rotated.grid)]
      if (score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
        best = rotated
        bestScore = score
      }
    }
  }
  return best as Rotated
}
