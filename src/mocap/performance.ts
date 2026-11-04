import { interpolate } from '../math/matrix.ts'
import type { BodyFrame } from './retarget.ts'

export const LOOP_OVERLAP_FRAMES = 12

function mixed (a: BodyFrame, b: BodyFrame, u: number): BodyFrame {
  const rotations = Object.fromEntries(Object.entries(a.rotations).map(([joint, rotation]) => {
    return [joint, interpolate(rotation, b.rotations[joint], u)]
  }))
  const clearance = {
    left: a.clearance.left + (b.clearance.left - a.clearance.left) * u,
    right: a.clearance.right + (b.clearance.right - a.clearance.right) * u
  }
  return { ...a, rotations, clearance }
}

export function loopedFrames (frames: BodyFrame[]): BodyFrame[] {
  const overlap = Math.min(LOOP_OVERLAP_FRAMES, Math.floor(frames.length / 3))
  const own = frames.slice(overlap)
  const tail = own.length - overlap
  const looped = own.map((frame, i) => {
    return i < tail ? frame : mixed(frame, frames[i - tail], (i - tail + 1) / (overlap + 1))
  })
  return [...looped, looped[0]]
}
