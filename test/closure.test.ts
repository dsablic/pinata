import { test } from 'node:test'
import assert from 'node:assert/strict'
import { closed } from '../src/export/closure.ts'
import type { Moment } from '../src/export/record.ts'
import type { Vec3 } from '../src/math/vec.ts'
import { turnToLocal, turnToWorld } from '../src/world/yaw.ts'

const PERIOD = 12
const DRIFT = 0.05
const YAW = 0.7

function driftingMoment (k: number, drift = DRIFT): Moment {
  const position: Vec3 = [0.1 * k, 0, 0.03 * k]
  const local = (p: Vec3): Vec3 => {
    const w = turnToWorld(p, YAW)
    return [position[0] + w[0], w[1], position[2] + w[2]]
  }
  const sway = Math.sin(2 * Math.PI * k / PERIOD)
  return {
    joints: { hip: local([0, 1, 0]), knee: local([sway + drift * k, 0.5, 0.2 * sway]) },
    curves: { cape: [local([0, 1, -0.1 * sway - drift * k])] },
    position,
    yaw: YAW,
    planted: [true]
  }
}

function localOf (m: Moment, p: Vec3): Vec3 {
  return turnToLocal([p[0] - m.position[0], p[1], p[2] - m.position[2]], m.yaw)
}

function offsetFromPeriodic (m: Moment, k: number): Vec3[] {
  const own = driftingMoment(k, 0)
  const [a, b] = [localOf(m, m.joints.knee), localOf(own, own.joints.knee)]
  const [c, d] = [localOf(m, m.curves.cape[0]), localOf(own, own.curves.cape[0])]
  return [[a[0] - b[0], a[1] - b[1], a[2] - b[2]], [c[0] - d[0], c[1] - d[1], c[2] - d[2]]]
}

test('a cycle whose end differs from its start comes out closed, with the root travel untouched', () => {
  const frames = Array.from({ length: 3 * PERIOD }, (_, k) => driftingMoment(k))
  const from = 5
  const cycle = closed(frames, { from, to: from + PERIOD })
  assert.equal(cycle.length, from + PERIOD)
  const first = offsetFromPeriodic(cycle[from], from)
  for (let k = from; k < from + PERIOD; k++) {
    offsetFromPeriodic(cycle[k], k).forEach((offset, part) => {
      offset.forEach((value, axis) => assert.ok(Math.abs(value - first[part][axis]) < 1e-9, `frame ${k}`))
    })
    assert.deepEqual(cycle[k].position, frames[k].position)
    assert.equal(cycle[k].yaw, frames[k].yaw)
  }
  const raw = localOf(frames[from + PERIOD - 1], frames[from + PERIOD - 1].joints.knee)
  const start = localOf(frames[from], frames[from].joints.knee)
  assert.ok(Math.abs(raw[0] - start[0]) > 0.3, 'the unclosed cycle does not meet its start')
  assert.deepEqual(cycle.slice(0, from), frames.slice(0, from))
})
