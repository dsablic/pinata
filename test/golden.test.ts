import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitCamera } from '../src/raster/camera.ts'
import { rasterize } from '../src/raster/gbuffer.ts'
import { stylize } from '../src/style/stylize.ts'
import { imageHash } from '../src/image.ts'
import type { Mannequin } from '../src/formats/mannequin.ts'
import type { Style } from '../src/formats/style.ts'

const GOLDEN_HASH = '2b2e56a0d4dbcc912d313c14a242c4fb9653de2d4c2d438da78faf0c5d75edf9'

const mannequin: Mannequin = {
  name: 'golden',
  height: 2,
  joints: {
    foot: [0, 0.2, 0],
    hip: [0, 0.9, 0],
    head: [0, 1.6, 0],
    hand: [0.7, 1.0, 0.1],
    eye: [0.1, 1.65, 0.3]
  },
  parts: [
    { name: 'leg', shape: 'capsule', a: 'foot', b: 'hip', radiusA: 0.15, radiusB: 0.2, material: 'cloth' },
    { name: 'torso', shape: 'capsule', a: 'hip', b: 'head', radiusA: 0.25, radiusB: 0.3, material: 'metal' },
    {
      name: 'arm',
      shape: 'capsule',
      a: 'head',
      b: 'hand',
      radiusA: 0.1,
      radiusB: 0.08,
      material: 'cloth',
      allowThin: true
    }
  ],
  decals: [{ name: 'eye', anchor: 'eye', normal: [0, 0, 1], pattern: ['x'] }]
}

const style: Style = {
  name: 'golden',
  light: [-0.4, 0.8, 0.6],
  bands: [0.2, 0.55],
  outline: '#101018',
  innerLineDepth: 0.1,
  decalMinFacing: 0.3,
  materials: {
    cloth: ['#3a2a5a', '#5a44a0', '#8a70d8'],
    metal: ['#40485a', '#7a8498', '#c8d0e0']
  },
  decalColors: { x: '#ffffff' }
}

test('a fixed mannequin renders to the committed image hash', () => {
  const camera = fitCamera(mannequin, { azimuthDeg: 30, elevationDeg: 20, targetHeightPx: 32, margin: 4 })
  const { image } = stylize(rasterize(mannequin, camera), mannequin, camera, style)
  assert.equal(imageHash(image), GOLDEN_HASH)
})
