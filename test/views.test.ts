import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkSkin, validateSkin, VIEWS } from '../src/formats/skin.ts'
import { makeCamera } from '../src/raster/camera.ts'
import { chooseView, counterpart, facingAngle, fitted, mirrored } from '../src/style/views.ts'
import { renderSkinned } from '../src/style/skins.ts'
import { loadCharacter } from '../src/formats/character.ts'
import { restPose } from '../src/motion/pose.ts'
import type { Pose } from '../src/motion/pose.ts'
import { toWorld } from '../src/sim/body.ts'
import type { Vec3 } from '../src/math/vec.ts'
import { getPixel, TRANSPARENT } from '../src/image.ts'
import type { Image } from '../src/image.ts'

test('facing: yaw 0 faces a camera at azimuth 0, a quarter turn faces screen-right', () => {
  const camera = makeCamera({ azimuthDeg: 0, elevationDeg: 14, targetHeightPx: 48, modelHeight: 1.8, margin: 4 })
  assert.ok(Math.abs(facingAngle(camera, 0)) < 1e-12)
  assert.ok(Math.abs(facingAngle(camera, Math.PI / 2) - Math.PI / 2) < 1e-12)
  assert.ok(Math.abs(Math.abs(facingAngle(camera, Math.PI)) - Math.PI) < 1e-12)
})

test('views: eight sectors, left-facing ones mirrored, with hysteresis at the edges', () => {
  const deg = Math.PI / 180
  assert.deepEqual(chooseView(0), { view: 'front', mirror: false, sector: 0 })
  assert.deepEqual(chooseView(90 * deg), { view: 'side', mirror: false, sector: 2 })
  assert.deepEqual(chooseView(-135 * deg), { view: 'backSide', mirror: true, sector: -3 })
  assert.deepEqual(chooseView(-180 * deg), { view: 'back', mirror: false, sector: 4 })
  assert.equal(chooseView(25 * deg, 0).sector, 0)
  assert.equal(chooseView(30 * deg, 0).sector, 0)
  assert.equal(chooseView(33 * deg, 0).sector, 1)
})

test('mirroring swaps sides and flips sprites the right way; fitting keeps the end caps', () => {
  assert.equal(counterpart('thighL'), 'thighR')
  assert.equal(counterpart('capeTopRight'), 'capeTopLeft')
  assert.equal(counterpart('helmet'), 'helmet')
  const limb = { rows: ['ab', 'cd'], pivotA: [0, 0] as [number, number], pivotB: [1, 0] as [number, number] }
  assert.deepEqual(mirrored(limb, true), { rows: ['cd', 'ab'], pivotA: [0, 1], pivotB: [1, 1] })
  assert.deepEqual(mirrored({ rows: ['ab.'], pivotA: [0, 0] }, false), { rows: ['.ba'], pivotA: [2, 0] })
  const long = { rows: ['x1234y'], pivotA: [1, 0] as [number, number], pivotB: [5, 0] as [number, number] }
  assert.deepEqual(fitted(long, 2), { rows: ['x13y'], pivotA: [1, 0], pivotB: [3, 0] })
  assert.deepEqual(fitted(long, 4.3), long)
})

test('an eight-direction skin validates every view and refuses single-view fields', () => {
  const v1 = JSON.parse(readFileSync('pocs/skins-spike/artist-skin.json', 'utf8'))
  const views = Object.fromEntries(VIEWS.map(view => [view, { parts: v1.parts }]))
  const v2 = { name: 'k', palette: v1.palette, views }
  const read = validateSkin(v2)
  assert.deepEqual(read.errors, [])
  const mannequin = JSON.parse(readFileSync('pocs/p4-locomotion/knight.json', 'utf8'))
  assert.deepEqual(checkSkin(read.value!, mannequin), [])
  assert.deepEqual(validateSkin({ ...v2, view: 'side-right' }).errors.map(e => e.path), ['views'])
  const missing = { ...v2, views: { ...views, back: undefined } }
  assert.deepEqual(validateSkin(missing).errors.map(e => e.path), ['views.back'])
})

test('eight-direction skins render left-facing directions as mirrors of right-facing ones, in both rotations', () => {
  const skin = validateSkin(JSON.parse(readFileSync('pocs/p7-skins/knight/skin.json', 'utf8'))).value!
  const character = loadCharacter('examples/knight').value!
  const rest = restPose(character.mannequin)
  const turned = (yaw: number): Pose => {
    const root = { position: [0, 0, 0] as Vec3, yaw, velocity: [0, 0, 0] as Vec3, angularVelocity: 0 }
    return Object.fromEntries(Object.entries(rest).map(([name, p]) => [name, toWorld(p, root)]))
  }
  const camera = makeCamera({ azimuthDeg: 0, elevationDeg: 14, targetHeightPx: 48, modelHeight: 2, margin: 7 })
  // the sword hangs from the right hand only, so a mirrored pose would not mirror it: leave it out
  const symmetric = { ...character.mannequin, parts: character.mannequin.parts.filter(p => p.name !== 'sword') }
  for (const rotation of ['nearest', 'clean'] as const) {
    for (const degrees of [45, 90, 135]) {
      const yaw = degrees * Math.PI / 180
      // the mirror image of the scene: x negated, left and right joints swapped, facing the other way
      const posed = turned(yaw)
      const mirrorPose: Pose = Object.fromEntries(Object.entries(posed).map(([name, p]) => {
        const [x, y, z] = posed[counterpart(name)] ?? p
        return [name, [-x, y, z]]
      }))
      const draw = (pose: Pose, y: number): Image => {
        return renderSkinned({ mannequin: symmetric, pose, skin, camera, rotation, yaw: y })
      }
      const right = draw(posed, yaw)
      const left = draw(mirrorPose, -yaw)
      // a pixel matches when its mirror image has the same colour within a pixel: sampling rounds down, so mirrored
      // angles land parts up to a pixel apart
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
      assert.ok(differ <= 0.03 * opaque, `${rotation} at ${degrees} degrees: ${differ} of ${opaque} pixels differ`)
    }
  }
})

test('an eight-direction skin needs the character\'s yaw, and keeps its view between frames', () => {
  const skin = validateSkin(JSON.parse(readFileSync('pocs/p7-skins/knight/skin.json', 'utf8'))).value!
  const character = loadCharacter('examples/knight').value!
  const camera = makeCamera({ azimuthDeg: 0, elevationDeg: 14, targetHeightPx: 48, modelHeight: 2, margin: 7 })
  const options = { mannequin: character.mannequin, pose: restPose(character.mannequin), skin, camera }
  assert.throws(() => renderSkinned(options), /yaw/)
  const view = {}
  renderSkinned({ ...options, yaw: 30 * Math.PI / 180, view })
  assert.deepEqual(view, { sector: 1 })
  renderSkinned({ ...options, yaw: 20 * Math.PI / 180, view })
  assert.deepEqual(view, { sector: 1 })
  renderSkinned({ ...options, yaw: 10 * Math.PI / 180, view })
  assert.deepEqual(view, { sector: 0 })
})

test('eight-direction sprites may be drawn upright, reuse another sprite, and set a layer', () => {
  const base = JSON.parse(readFileSync('pocs/p7-skins/knight/skin.json', 'utf8'))
  const skin = structuredClone(base)
  // an upright thigh: A at the top, B below, the right-hand column becomes the lying sprite's top row
  const [a, b, c, d, e, f] = Object.keys(skin.palette)
  skin.views.front.parts.thighR = { rows: [a + b, c + d, e + f], pivotA: [0, 0], pivotB: [0, 2], upright: true }
  skin.views.back.parts.thighR = { from: 'front.thighR', layer: 2 }
  skin.views.back.parts.thighL = { from: 'thighR' }
  const read = validateSkin(skin)
  assert.deepEqual(read.errors, [])
  const front = read.value!.views!.front.parts.thighR
  assert.deepEqual(front, { rows: [b + d + f, a + c + e], pivotA: [0, 1], pivotB: [2, 1] })
  assert.deepEqual(read.value!.views!.back.parts.thighR, { ...front, layer: 2 })
  assert.deepEqual(read.value!.views!.back.parts.thighL, front)
  const loop = structuredClone(base)
  loop.views.side.parts.thighR = { from: 'thighL' }
  loop.views.side.parts.thighL = { from: 'thighR' }
  assert.ok(validateSkin(loop).errors.some(e => e.path === 'views.side.parts.thighR.from'))
  const sideways = structuredClone(skin)
  sideways.views.front.parts.thighR.pivotB = [1, 2]
  assert.ok(validateSkin(sideways).errors.some(e => e.path === 'views.front.parts.thighR.pivotB'))
})
