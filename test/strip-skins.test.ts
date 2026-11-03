import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateSkin } from '../src/formats/skin.ts'
import { loadCharacter } from '../src/formats/character.ts'
import { makeCamera } from '../src/raster/camera.ts'
import { restPose } from '../src/motion/pose.ts'
import type { Pose } from '../src/motion/pose.ts'
import { toWorld } from '../src/sim/body.ts'
import { getPixel, TRANSPARENT } from '../src/image.ts'
import type { Image } from '../src/image.ts'
import { renderSkinnedLayers } from '../src/style/skins.ts'
import { counterpart } from '../src/style/views.ts'
import { ORDER_HYSTERESIS } from '../src/style/order.ts'
import { rootAt } from './rendering-fixtures.ts'

const skin = validateSkin(JSON.parse(readFileSync('pocs/p7-skins/knight/skin.json', 'utf8'))).value!
const character = loadCharacter('examples/knight').value!
const camera = makeCamera({ azimuthDeg: 0, elevationDeg: 14, targetHeightPx: 48, modelHeight: 2, margin: 7 })
const symmetric = { ...character.mannequin, parts: character.mannequin.parts.filter(p => p.name !== 'sword') }
const rest = restPose(character.mannequin)
const DEGREES = Math.PI / 180

function turned (yaw: number): Pose {
  const root = rootAt([0, 0, 0], yaw)
  return Object.fromEntries(Object.entries(rest).map(([name, p]) => [name, toWorld(p, root)]))
}

function mirroredPose (pose: Pose): Pose {
  return Object.fromEntries(Object.entries(pose).map(([name, p]) => {
    const [x, y, z] = pose[counterpart(name)] ?? p
    return [name, [-x, y, z]]
  }))
}

function drawn (pose: Pose, yaw: number, extra: object = {}): ReturnType<typeof renderSkinnedLayers> {
  return renderSkinnedLayers({ mannequin: symmetric, pose, skin, camera, yaw, painter: 'strip', ...extra })
}

function mirrorMisses (right: Image, left: Image): { opaque: number, differ: number } {
  let opaque = 0
  let differ = 0
  for (let y = 0; y < right.height; y++) {
    for (let x = 0; x < right.width; x++) {
      const a = getPixel(right, x, y)
      if (a === TRANSPARENT) continue
      opaque++
      let near = false
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1 && !near; dx++) near = getPixel(left, right.width - 1 - x + dx, y + dy) === a
      }
      if (!near) differ++
    }
  }
  return { opaque, differ }
}

const MIRROR_BUDGET = 0.03

test('a pose and its mirror image render as mirror images, parts flipped the right way up', () => {
  for (const degrees of [45, 90, 135]) {
    const yaw = degrees * DEGREES
    const posed = turned(yaw)
    const { opaque, differ } = mirrorMisses(drawn(posed, yaw).image, drawn(mirroredPose(posed), -yaw).image)
    assert.ok(differ <= MIRROR_BUDGET * opaque, `${degrees} degrees: ${differ} of ${opaque} pixels differ`)
  }
})

function order (pose: Pose, previous: string[]): string[] {
  drawn(pose, 0, { order: previous })
  return previous
}

function shifted (pose: Pose, joints: string[], dz: number): Pose {
  return { ...pose, ...Object.fromEntries(joints.map(j => [j, [pose[j][0], pose[j][1], pose[j][2] + dz]])) }
}

test('the same pose drawn again with the kept state gives the same image', () => {
  const state = {
    order: [] as string[],
    lengths: new Map<string, number>(),
    anchors: new Map<string, [number, number]>()
  }
  const first = drawn(turned(0), 0, state).image
  const again = drawn(turned(0), 0, state).image
  assert.deepEqual(again, first)
  assert.equal(state.order.length, symmetric.parts.length)
})

test('parts whose depths cross by less than the band keep the order of the previous call', () => {
  const plumeJoints = ['plumeFront', 'plumeBack']
  const before = (names: string[]): boolean => names.indexOf('helmet') < names.indexOf('plume')
  const rested = order(turned(0), [])
  assert.ok(before(rested))
  const far = order(shifted(turned(0), plumeJoints, -2 * ORDER_HYSTERESIS), rested)
  assert.ok(!before(far))
  const nearer = shifted(turned(0), plumeJoints, ORDER_HYSTERESIS / 2)
  assert.ok(!before(order(nearer, far)))
  assert.ok(before(order(nearer, [])))
})

test('every part touches the parts it shares a joint with, at any yaw', () => {
  const joints = new Map(symmetric.parts.map(p => [p.name, [p.a, p.b]]))
  for (const degrees of [0, 30, 45, 90, 135, 180, -90]) {
    const yaw = degrees * DEGREES
    const { parts, image } = drawn(turned(yaw), yaw, { footprints: true })
    const touching = (from: number[], to: number[]): boolean => {
      const owned = new Set(to)
      return from.some(at => {
        const [x, y] = [at % image.width, Math.floor(at / image.width)]
        return [-1, 0, 1].some(dy => [-1, 0, 1].some(dx => owned.has((y + dy) * image.width + x + dx)))
      })
    }
    for (const p of parts) {
      const [a, b] = joints.get(p.name)!
      if (a === b) continue
      for (const q of parts) {
        if (p === q || !joints.get(q.name)!.some(j => j === a || j === b)) continue
        assert.ok(touching(p.footprint!, q.footprint!), `${p.name} and ${q.name} are apart at ${degrees} degrees`)
      }
    }
  }
})

test('a rigid part turns in steps and reports how far its end lands from a joint another part starts at', () => {
  const pose = turned(90 * DEGREES)
  const angles = new Map<string, number>()
  const { parts } = drawn(pose, 90 * DEGREES, { footprints: true, angles })
  const byName = new Map(parts.map(p => [p.name, p]))
  for (const name of ['thighL', 'thighR', 'shinL', 'upperArmL', 'upperArmR']) {
    const missed = byName.get(name)?.missed
    assert.ok(missed !== undefined && missed < 3, `${name} ${missed}`)
  }
  for (const name of ['footL', 'forearmL', 'plume']) {
    assert.equal(byName.get(name)?.missed, undefined, `${name} ends where no other part starts`)
  }
  assert.ok([...angles.values()].every(a => Math.abs(a / (Math.PI / 8) - Math.round(a / (Math.PI / 8))) < 1e-9))
  assert.equal(drawn(pose, 90 * DEGREES, { angles: new Map() }).parts.find(p => p.name === 'thighL')?.missed, undefined)
})
