import type { Foot, Frame } from './record.ts'

function spread (feet: Foot[]): number {
  const at = feet.map(foot => foot.sole ?? foot.drawn)
  let widest = -1
  for (let i = 0; i < at.length; i++) {
    for (let j = i + 1; j < at.length; j++) {
      const [a, b] = [at[i], at[j]]
      if (a !== undefined && b !== undefined) widest = Math.max(widest, Math.hypot(a.x - b.x, a.y - b.y))
    }
  }
  return widest
}

export function widestStride (frames: Frame[]): Frame {
  return frames.reduce((best, frame) => spread(frame.feet) > spread(best.feet) ? frame : best)
}
