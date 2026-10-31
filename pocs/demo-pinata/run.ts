import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatCharacterErrors, loadCharacter } from '../../src/formats/character.ts'
import type { Character } from '../../src/formats/character.ts'
import type { Mannequin } from '../../src/formats/mannequin.ts'
import { upscale } from '../../src/image.ts'
import type { Image } from '../../src/image.ts'
import type { Vec3 } from '../../src/math/vec.ts'
import { simulateCharacter } from '../../src/motion/character.ts'
import type { CharacterRun } from '../../src/motion/character.ts'
import { recordLocomotion } from '../../src/motion/metrics.ts'
import { restPose } from '../../src/motion/pose.ts'
import { makeCamera } from '../../src/raster/camera.ts'
import type { Camera } from '../../src/raster/camera.ts'
import { rasterize } from '../../src/raster/gbuffer.ts'
import type { GBuffer } from '../../src/raster/gbuffer.ts'
import { clothParts, withClothParts } from '../../src/sim/render.ts'
import { stylize } from '../../src/style/stylize.ts'
import { sheet } from '../../src/diagnostics/images.ts'
import { writeOutput } from '../../src/diagnostics/report.ts'
import { encodeApng, encodePng } from '../../src/png/encode.ts'

const VIEW = { azimuthDeg: 40, elevationDeg: 12, characterHeightPx: 64, width: 104, height: 92, groundMargin: 6 }
const SAMPLES = 4
const FPS = 24
const HOLD_FRAMES = 2
const ZOOM = 8
const SETTLE_FRAMES = 12
const LOGO_FRAME = 8
const STRIP = { frames: 12, scale: 2, gap: 3, background: 0xf4ecd8 }

const here = dirname(fileURLToPath(import.meta.url))
const character = load(join(here, '..', '..', 'examples', 'pinata'))
const outDir = join(here, '..', '..', 'reports', 'demo')

function load (dir: string): Character {
  const loaded = loadCharacter(dir)
  if (loaded.value === undefined) throw new Error(formatCharacterErrors(loaded.errors))
  return loaded.value
}

function camera (mannequin: Mannequin): Camera {
  const base = makeCamera({
    azimuthDeg: VIEW.azimuthDeg,
    elevationDeg: VIEW.elevationDeg,
    targetHeightPx: VIEW.characterHeightPx,
    modelHeight: mannequin.height,
    margin: 0
  })
  return { ...base, width: VIEW.width, height: VIEW.height, baseline: VIEW.height - VIEW.groundMargin }
}

function turn (v: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]
}

function frameMannequin (run: CharacterRun, joints: Record<string, Vec3>[], frame: number): Mannequin {
  const { root } = run.frames[frame]
  const origin: Vec3 = [root.position[0], 0, root.position[2]]
  const viewJoints: Record<string, Vec3> = {}
  for (const [name, p] of Object.entries(joints[frame])) viewJoints[name] = [p[0] - origin[0], p[1], p[2] - origin[2]]
  const decals = character.mannequin.decals.map(d => ({ ...d, normal: turn(d.normal, root.yaw) }))
  const body = { ...character.mannequin, joints: viewJoints, decals }
  const view = { position: origin, yaw: 0, velocity: [0, 0, 0] as Vec3, angularVelocity: 0 }
  const cloth = clothParts(character.scenario, run.recording.frames[frame].positions, view)
  return withClothParts(body, cloth)
}

function render (): Image[] {
  const run = simulateCharacter({
    mannequin: character.mannequin, rig: character.rig, scenario: character.scenario, materials: character.materials
  })
  const locomotion = recordLocomotion(run.frames, {
    rig: character.rig, rest: restPose(character.mannequin), mannequin: character.mannequin, fps: FPS,
    substeps: character.scenario.substeps
  })
  const joints = locomotion.frames.map(f => f.joints)
  const cam = camera(character.mannequin)
  const images: Image[] = []
  let previous: GBuffer | undefined
  const count = Math.min(run.frames.length, SETTLE_FRAMES + demoFrames())
  for (let frame = SETTLE_FRAMES; frame < count; frame++) {
    const m = frameMannequin(run, joints, frame)
    const g = rasterize(m, cam, SAMPLES, previous)
    images.push(stylize(g, m, cam, character.style).image)
    previous = g
    if (frame % FPS === FPS - 1) console.log(`rendered ${frame + 1} of ${count} frames`)
  }
  return images
}

function demoFrames (): number {
  const value = process.env.DEMO_FRAMES
  if (value === undefined) return Infinity
  const frames = Number(value)
  if (!Number.isInteger(frames) || frames < 1) {
    throw new Error(`DEMO_FRAMES must be a whole number of frames, 1 or more; got '${value}'`)
  }
  return frames
}

function contactStrip (images: Image[]): Image {
  const step = Math.max(1, Math.floor(images.length / STRIP.frames))
  const cells = Array.from({ length: STRIP.frames }, (_, i) => ({
    image: images[Math.min(images.length - 1, i * step)], anchor: [0, 0] as [number, number]
  }))
  const columns = STRIP.frames / 2
  const rows = [cells.slice(0, columns), cells.slice(columns)]
  return sheet(rows, { scale: STRIP.scale, gap: STRIP.gap, background: STRIP.background })
}

rmSync(outDir, { recursive: true, force: true })
const started = performance.now()
const images = render()
images.forEach((image, i) => {
  writeOutput(join(outDir, 'frames', `${String(i).padStart(4, '0')}.png`), encodePng(image))
})
writeOutput(join(outDir, 'strip.png'), encodePng(contactStrip(images)))
const timing = { delayNum: HOLD_FRAMES, delayDen: FPS }
const twos = images.filter((_, i) => i % HOLD_FRAMES === 0)
writeOutput(join(outDir, 'pinata.apng'), encodeApng(twos, timing))
writeOutput(join(outDir, 'pinata-8x.apng'), encodeApng(twos.map((f: Image) => upscale(f, ZOOM)), timing))
writeOutput(join(outDir, 'logo.png'), encodePng(upscale(images[Math.min(LOGO_FRAME, images.length - 1)], ZOOM)))
console.log(`demo: ${images.length} frames, ${twos.length} animation frames, ` +
  `${((performance.now() - started) / 1000).toFixed(1)} s, output in ${outDir}`)
