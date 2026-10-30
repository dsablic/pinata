import { readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateMannequin } from '../../src/formats/mannequin.ts'
import type { Mannequin } from '../../src/formats/mannequin.ts'
import { checkRig, validateRig } from '../../src/formats/rig.ts'
import { validateScenario } from '../../src/formats/sim.ts'
import { checkSkin, validateSkin } from '../../src/formats/skin.ts'
import type { Skin } from '../../src/formats/skin.ts'
import { formatErrors } from '../../src/formats/validate.ts'
import type { Validated } from '../../src/formats/validate.ts'
import { planGait } from '../../src/motion/gait.ts'
import { recordLocomotion, steadySegments } from '../../src/motion/metrics.ts'
import { posedMannequin, restPose } from '../../src/motion/pose.ts'
import type { Pose } from '../../src/motion/pose.ts'
import { createRootTrack, scriptDuration } from '../../src/motion/script.ts'
import { fitCamera, unionCamera } from '../../src/raster/camera.ts'
import type { Camera } from '../../src/raster/camera.ts'
import { renderSkinned } from '../../src/style/skins.ts'
import { sheet } from '../../src/diagnostics/images.ts'
import type { SheetCell } from '../../src/diagnostics/images.ts'
import { writeOutput } from '../../src/diagnostics/report.ts'
import { imageHash } from '../../src/image.ts'
import type { Image } from '../../src/image.ts'
import { encodePng } from '../../src/png/encode.ts'

const AZIMUTH_DEG = 270
const TARGET_HEIGHT_PX = 48
const MARGIN = 8
const WALK_FRAMES = 8
const PREVIEW_SCALE = 8
const GAP = 2
const BACKGROUND = 0xf7f7f7
const PIVOT_SPAN_TOLERANCE_PX = 2

const here = dirname(fileURLToPath(import.meta.url))
const p4 = join(here, '..', 'p4-locomotion')
const outDir = join(here, '..', '..', 'reports', 'skins')

function fail (message: string): never {
  console.error(message)
  rmSync(outDir, { recursive: true, force: true })
  writeOutput(join(outDir, 'summary.txt'), `skin: INVALID\n${message}\n`)
  process.exit(2)
}

function loadJson (path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    if (err instanceof SyntaxError) fail(`${path}: invalid JSON: ${err.message}`)
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') fail(`${path}: file not found`)
    throw err
  }
}

function requireValid<T> (file: string, result: Validated<T>): T {
  if (result.value === undefined || result.errors.length > 0) fail(formatErrors(file, result.errors))
  return result.value
}

const skinArg = process.argv[2]
if (skinArg === undefined) fail('usage: npm run skins -- <skin.json>')
const skinFile = resolve(skinArg)
const scenario = requireValid('walk-turn-stop.json', validateScenario(loadJson(join(p4, 'walk-turn-stop.json'))))
const mannequin = requireValid('knight.json', validateMannequin(loadJson(join(p4, scenario.body))))
const rig = requireValid('rig.json', validateRig(loadJson(join(p4, 'rig.json'))))
const rigErrors = checkRig(rig, mannequin)
if (rigErrors.length > 0) fail(formatErrors('rig.json', rigErrors))

const skin: Skin = requireValid(skinArg, validateSkin(loadJson(skinFile)))
const crossErrors = checkSkin(skin, mannequin)
if (crossErrors.length > 0) fail(formatErrors(skinArg, crossErrors))

function pivotNotes (): string[] {
  const k = TARGET_HEIGHT_PX / mannequin.height
  const notes: string[] = []
  for (const part of mannequin.parts) {
    const sprite = skin.parts[part.name]
    if (sprite.hidden === true || part.a === part.b) continue
    if (sprite.pivotA === undefined || sprite.pivotB === undefined) continue
    const [a, b] = [mannequin.joints[part.a], mannequin.joints[part.b]]
    const bone = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * k
    const span = sprite.pivotB[0] - sprite.pivotA[0]
    if (Math.abs(span - bone) > PIVOT_SPAN_TOLERANCE_PX) {
      notes.push(`note: ${part.name} pivots are ${span} px apart; the bone is ${bone.toFixed(1)} px long at 48 px`)
    }
  }
  return notes
}

const rest = restPose(mannequin)
const frames = planGait({
  track: createRootTrack(scenario.script), rig, rest, mannequin,
  duration: scriptDuration(scenario.script), fps: scenario.fps
})
const recording = recordLocomotion(frames, { rig, rest, mannequin, fps: scenario.fps })
const [steady] = steadySegments(scenario.script)
if (steady === undefined) fail('walk-turn-stop.json: the script has no steady move segment')
const middle = Math.round((steady.start + steady.end) / 2 * scenario.fps)
const first = middle - WALK_FRAMES / 2

function centred (index: number): Pose {
  const origin = recording.frames[middle].root.position
  const joints: Pose = {}
  for (const [name, p] of Object.entries(recording.frames[index].joints)) {
    joints[name] = [p[0] - origin[0], p[1], p[2] - origin[2]]
  }
  return joints
}

const poses: Pose[] = [rest, ...Array.from({ length: WALK_FRAMES }, (_, i) => centred(first + i))]
const fit = { azimuthDeg: AZIMUTH_DEG, elevationDeg: 0, targetHeightPx: TARGET_HEIGHT_PX, margin: MARGIN }
const camera: Camera = unionCamera(poses.map(pose => fitCamera(posedMannequin(mannequin, pose), fit)))
const images: Image[] = poses.map(pose => renderSkinned({ mannequin, pose, skin, camera }))
const [stand, ...walk] = images

function layout (list: Image[]): SheetCell[][] {
  return [list.map(image => ({ image, anchor: [0, 0] as [number, number] }))]
}

const flat = { scale: 1, gap: GAP, background: BACKGROUND }
const big = { scale: PREVIEW_SCALE, gap: PREVIEW_SCALE, background: BACKGROUND }
const preview = sheet([...layout([stand]), ...layout(walk)], big)
writeOutput(join(outDir, 'stand.png'), encodePng(sheet(layout([stand]), flat)))
writeOutput(join(outDir, 'walk-strip.png'), encodePng(sheet(layout(walk), flat)))
writeOutput(join(outDir, 'preview.png'), encodePng(preview))

const hidden = Object.entries(skin.parts).filter(([, p]) => p.hidden === true).map(([name]) => name)
const summary = [
  `skin: ${skin.name} VALID`,
  `parts: ${mannequin.parts.length} (${hidden.length} hidden${hidden.length > 0 ? `: ${hidden.join(', ')}` : ''})`,
  `colours: ${Object.keys(skin.palette).length} of 16`,
  `frame size: ${camera.width}x${camera.height} px, character ${TARGET_HEIGHT_PX} px tall`,
  `walk frames: ${first}..${first + WALK_FRAMES - 1} of ${scenario.name} at ${scenario.fps} fps`,
  `stand hash: ${imageHash(stand).slice(0, 16)}`,
  `walk hash: ${imageHash(sheet(layout(walk), flat)).slice(0, 16)}`,
  ...pivotNotes()
].join('\n')
writeOutput(join(outDir, 'summary.txt'), `${summary}\n`)
console.log(summary)
