import { dot, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import type { Pose } from './pose.ts'

export type Sample = { joints: Pose, yaw: number, planted: boolean[] }
export type Touchdown = { leg: number, frame: number, position: Vec3 }
export type Step = { leg: number, length: number, duration: number, from: number, to: number }
export type Gap = { length: number, duration: number }
export type Spread = { mean: number, min: number, max: number }
export type Shift = { range: number, pelvisSway: number, plantedShare: number[] }

const DEGREES = 180 / Math.PI
const SHORTEST_GAP = 3

export function forwardOf (yaw: number): Vec3 {
  return [Math.sin(yaw), 0, Math.cos(yaw)]
}

export function mean (values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

export function spreadOf (values: number[]): Spread {
  if (values.length === 0) return { mean: NaN, min: NaN, max: NaN }
  return { mean: mean(values), min: Math.min(...values), max: Math.max(...values) }
}

export function peakToPeak (values: number[]): number {
  return Math.max(...values) - Math.min(...values)
}

export function pitchDegrees (sample: Sample, lower: string, upper: string): number {
  const axis = sub(sample.joints[upper], sample.joints[lower])
  return Math.atan2(dot(axis, forwardOf(sample.yaw)), axis[1]) * DEGREES
}

function filled (flags: boolean[], value: boolean, shortest: number): boolean[] {
  const steady = [...flags]
  for (let from = 0; from < steady.length;) {
    let to = from
    while (to < steady.length && steady[to] === steady[from]) to++
    if (steady[from] === value && from > 0 && to < steady.length && to - from < shortest) steady.fill(!value, from, to)
    from = to
  }
  return steady
}

export function steadySamples<T extends Sample> (samples: T[], shortestStance = 0): T[] {
  const legs = samples[0].planted.map((_, leg) => {
    const gapsClosed = filled(samples.map(sample => sample.planted[leg]), false, SHORTEST_GAP)
    return filled(gapsClosed, true, shortestStance)
  })
  return samples.map((sample, i) => ({ ...sample, planted: legs.map(leg => leg[i]) }))
}

function plantings (samples: Sample[]): Array<{ leg: number, frame: number }> {
  const found: Array<{ leg: number, frame: number }> = []
  samples[0].planted.forEach((_, leg) => {
    const planted = samples.map(sample => sample.planted[leg])
    for (let frame = 1; frame < samples.length; frame++) {
      if (planted[frame] && !planted[frame - 1]) found.push({ leg, frame })
    }
  })
  return found.sort((a, b) => a.frame - b.frame)
}
export function touchdowns (samples: Sample[], ankles: string[]): Touchdown[] {
  return plantings(samples).map(({ leg, frame }) => ({ leg, frame, position: samples[frame].joints[ankles[leg]] }))
}

export function stepsOf (samples: Sample[], ankles: string[], fps: number): Step[] {
  const downs = touchdowns(samples, ankles)
  const steps: Step[] = []
  for (let i = 1; i < downs.length; i++) {
    const [before, now] = [downs[i - 1], downs[i]]
    if (before.leg === now.leg) continue
    const length = dot(sub(now.position, before.position), forwardOf(samples[now.frame].yaw))
    steps.push({ leg: now.leg, length, duration: (now.frame - before.frame) / fps, from: before.frame, to: now.frame })
  }
  return steps
}

function gapOf (a: number, b: number): number {
  return Math.abs(a - b) / ((a + b) / 2)
}

export function gapsOf (steps: Step[]): Gap[] {
  const gaps: Gap[] = []
  for (let i = 0; i + 1 < steps.length; i += 2) {
    gaps.push({
      length: gapOf(steps[i].length, steps[i + 1].length),
      duration: gapOf(steps[i].duration, steps[i + 1].duration)
    })
  }
  return gaps
}

export function stepMeans (steps: Step[], legs: number): Array<{ length: number, duration: number }> {
  return Array.from({ length: legs }, (_, leg) => {
    const own = steps.filter(step => step.leg === leg)
    return { length: mean(own.map(step => step.length)), duration: mean(own.map(step => step.duration)) }
  })
}

export function cyclesOf (samples: Sample[], leg = 0): Array<[number, number]> {
  const starts = plantings(samples).filter(down => down.leg === leg)
  return starts.slice(1).map((down, i) => [starts[i].frame, down.frame])
}

export function pitchesOf (samples: Sample[], lower: string, upper: string): number[] {
  return samples.map(sample => pitchDegrees(sample, lower, upper))
}

export function cycleMeans (samples: Sample[], values: number[], leg = 0): number[] {
  return cyclesOf(samples, leg).map(([from, to]) => mean(values.slice(from, to)))
}

export function windowsOf<T> (items: T[], size: number): T[][] {
  const windows: T[][] = []
  for (let from = 0; from + size <= items.length; from += size) windows.push(items.slice(from, from + size))
  return windows
}

export function travelPerWindow (values: number[], size: number): number {
  return mean(windowsOf(values, size).map(peakToPeak))
}

export function reachOf (points: Vec3[]): number {
  const centre = [0, 1, 2].map(axis => mean(points.map(p => p[axis])))
  return Math.max(...points.map(p => Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2])))
}

export function pathOf (points: Vec3[]): number {
  return points.slice(1).reduce((sum, p, i) => sum + Math.hypot(...sub(p, points[i])), 0)
}

export function weightShift (samples: Sample[], pelvis: string, ankles: [string, string], height: number): Shift {
  const [left, right] = ankles
  const rows = samples.map(sample => {
    const span = sub(sample.joints[right], sample.joints[left])
    const across = sub(sample.joints[pelvis], sample.joints[left])
    const width = Math.hypot(...span)
    return { share: dot(across, span) / (width * width), sideways: dot(across, span) / width }
  })
  const plantedShare = ankles.map((_, leg) => mean(samples.map(sample => sample.planted[leg] ? 1 : 0)))
  return {
    range: peakToPeak(rows.map(row => row.share)),
    pelvisSway: peakToPeak(rows.map(row => row.sideways)) / height,
    plantedShare
  }
}
