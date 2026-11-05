import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validateSkin } from '../src/formats/skin.ts'
import type { Skin, SkinPart, ViewName } from '../src/formats/skin.ts'
import { loadCharacter } from '../src/formats/character.ts'
import { makeCamera } from '../src/raster/camera.ts'
import { restPose } from '../src/motion/pose.ts'
import type { Pose } from '../src/motion/pose.ts'
import type { Vec3 } from '../src/math/vec.ts'
import { toWorld } from '../src/sim/body.ts'
import { footNames } from '../src/style/feet.ts'
import { renderSkinnedLayers } from '../src/style/skins.ts'
import { rootAt } from './rendering-fixtures.ts'

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url))
const base = validateSkin(JSON.parse(readFileSync(here('../pocs/p7-skins/knight/skin.json'), 'utf8'))).value!
const knight = loadCharacter(here('../examples/knight')).value!
const { mannequin } = knight
const feet = footNames(mannequin, knight.rig)
const camera = makeCamera({ azimuthDeg: 0, elevationDeg: 14, targetHeightPx: 48, modelHeight: 2, margin: 7 })
const rest = restPose(mannequin)
const DEGREES = Math.PI / 180
const [LIGHT, DARK] = Object.keys(base.palette)
const UPRIGHT_FOOT: SkinPart = {
  rows: [`.${LIGHT}${LIGHT}.`, LIGHT.repeat(4), LIGHT.repeat(4), DARK.repeat(4)],
  pivotA: [1, 1],
  pivotB: [2, 1],
  upright: true
}

function turned (yaw: number, toe?: [number, number]): Pose {
  const root = rootAt([0, 0, 0], yaw)
  const pose = { ...rest }
  if (toe !== undefined) pose.toeL = [rest.ankleL[0] + toe[0], rest.toeL[1], rest.ankleL[2] + toe[1]]
  return Object.fromEntries(Object.entries(pose).map(([name, p]) => [name, toWorld(p, root)]))
}

function skinWith (edit: (skin: Skin) => void): Skin {
  const skin = structuredClone(base)
  edit(skin)
  return skin
}

function footPixels (skin: Skin, pose: Pose, yaw: number, name = 'footL'): number[] {
  const painted = { mannequin, pose, skin, camera, yaw, painter: 'strip' as const, footprints: true, feet }
  const { parts } = renderSkinnedLayers(painted)
  return [...new Set(parts.find(part => part.name === name)!.footprint!)].sort((a, b) => a - b)
}

function lowestRow (skin: Skin, pose: Pose, yaw: number, name = 'footL'): number {
  return Math.max(...footPixels(skin, pose, yaw, name).map(i => Math.floor(i / camera.width)))
}

function movedRows (skin: Skin, view: ViewName, name: string, delta: number): Skin {
  return skinWith(s => {
    const foot = s.views![view].parts[name]
    foot.pivotA![1] += delta
    foot.pivotB![1] += delta
  })
}

function assertExact (lowest: (delta: number) => number): void {
  assert.equal(lowest(1), lowest(0) - 1)
  assert.equal(lowest(-1), lowest(0) + 1)
}

test('an upright foot in the front view is drawn as it stands, whatever direction its short bone projects in', () => {
  const skin = skinWith(s => { s.views!.front.parts.footL = { ...UPRIGHT_FOOT } })
  const drawn = [[0.03, 0], [-0.03, 0], [0, 0.03]].map(toe => {
    return footPixels(skin, turned(0, toe as [number, number]), 0)
  })
  assert.ok(drawn[0].length > 0)
  assert.deepEqual(drawn[1], drawn[0])
  assert.deepEqual(drawn[2], drawn[0])
})

test('a foot sprite in the back view is drawn as authored too', () => {
  const skin = skinWith(s => { s.views!.back.parts.footL = { ...UPRIGHT_FOOT } })
  const drawn = [[0.03, 0], [-0.03, 0]].map(toe => footPixels(skin, turned(Math.PI, toe as [number, number]), Math.PI))
  assert.ok(drawn[0].length > 0)
  assert.deepEqual(drawn[1], drawn[0])
})

test('a shin ending level with the toes is drawn as any other part, in every view', () => {
  const standing = turned(0)
  const level = { ...standing, ankleL: [standing.ankleL[0], standing.toeL[1], standing.ankleL[2]] as Vec3 }
  const lowest = Math.min(...Object.values(level).map(p => p[1]))
  assert.equal(level.ankleL[1], lowest)
  for (const yaw of [0, 45, 90, 135, 180].map(degrees => degrees * DEGREES)) {
    const shin = (names: string[]): number[] => {
      const { parts } = renderSkinnedLayers({
        mannequin, pose: level, skin: base, camera, yaw, painter: 'strip', footprints: true, feet: names
      })
      return parts.find(part => part.name === 'shinL')!.footprint!
    }
    assert.ok(shin(feet).length > 0)
    assert.deepEqual(shin(feet), shin([]))
  }
})

for (const [view, yaw] of [['front', 0], ['frontSide', 45], ['side', 90], ['backSide', 135], ['back', 180]] as const) {
  test(`a foot sprite's pivot rows moved by one move its drawn sole by one pixel in the ${view} view`, () => {
    assertExact(delta => lowestRow(movedRows(base, view, 'footL', delta), turned(yaw * DEGREES), yaw * DEGREES))
  })
}

for (const [view, yaw] of [['frontSide', -45], ['side', -90], ['backSide', -135]] as const) {
  test(`in the mirrored ${view} view the counterpart sprite's pivot rows move the drawn sole by one pixel`, () => {
    assertExact(delta => lowestRow(movedRows(base, view, 'footR', delta), turned(yaw * DEGREES), yaw * DEGREES))
  })
}
