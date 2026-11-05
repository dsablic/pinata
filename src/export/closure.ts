import { add, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { turnToLocal, turnToWorld } from '../world/yaw.ts'
import type { Moment, Span } from './record.ts'

type Points = Record<string, Vec3>

export function localPoint (m: Moment, p: Vec3): Vec3 {
  return turnToLocal([p[0] - m.position[0], p[1], p[2] - m.position[2]], m.yaw)
}

function localPoints (m: Moment, points: Points): Points {
  return Object.fromEntries(Object.entries(points).map(([name, p]) => [name, localPoint(m, p)]))
}

function worldPoints (m: Moment, points: Points): Points {
  const at = (p: Vec3): Vec3 => {
    const w = turnToWorld(p, m.yaw)
    return [m.position[0] + w[0], w[1], m.position[2] + w[2]]
  }
  return Object.fromEntries(Object.entries(points).map(([name, p]) => [name, at(p)]))
}

function shifted (m: Moment, own: Points, gap: Points, share: number): Points {
  const local = localPoints(m, own)
  return worldPoints(m, Object.fromEntries(Object.keys(local).map(name => {
    return [name, add(local[name], scale(gap[name], share))]
  })))
}

function gapBetween (from: Points, to: Points): Points {
  return Object.fromEntries(Object.keys(from).map(name => [name, sub(from[name], to[name])]))
}

function curvesOf (m: Moment): Points {
  return Object.fromEntries(Object.entries(m.curves).flatMap(([name, points]) => {
    return points.map((p, i): [string, Vec3] => [`${name}#${i}`, p])
  }))
}

function curvesFrom (m: Moment, shifted: Points): Moment['curves'] {
  return Object.fromEntries(Object.entries(m.curves).map(([name, points]) => {
    return [name, points.map((_, i) => shifted[`${name}#${i}`])]
  }))
}

export function closed (frames: Moment[], { from, to }: Span): Moment[] {
  const [first, after] = [frames[from], frames[to]]
  const jointGap = gapBetween(localPoints(first, first.joints), localPoints(after, after.joints))
  const curveGap = gapBetween(localPoints(first, curvesOf(first)), localPoints(after, curvesOf(after)))
  return frames.slice(0, to).map((m, k) => {
    if (k < from) return m
    const share = (k - from) / (to - from)
    return {
      ...m,
      joints: shifted(m, m.joints, jointGap, share),
      curves: curvesFrom(m, shifted(m, curvesOf(m), curveGap, share))
    }
  })
}
