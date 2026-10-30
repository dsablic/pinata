import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadCharacter } from '../formats/character.ts'
import type { Character } from '../formats/character.ts'
import { checkSkin, validateSkin, VIEWS } from '../formats/skin.ts'
import type { Skin } from '../formats/skin.ts'
import { formatErrors } from '../formats/validate.ts'
import { sheet } from '../diagnostics/images.ts'
import type { SheetCell } from '../diagnostics/images.ts'
import { writeOutput } from '../diagnostics/report.ts'
import { flickerFraction } from '../diagnostics/stability.ts'
import type { Image } from '../image.ts'
import { validateClip } from '../mocap/clip.ts'
import type { Clip } from '../mocap/clip.ts'
import { buildDatabase } from '../mocap/database.ts'
import { createPlayer } from '../mocap/player.ts'
import { mergeRetargeting } from '../mocap/retarget.ts'
import { posedMannequin, restPose } from '../motion/pose.ts'
import type { Pose } from '../motion/pose.ts'
import { encodePng } from '../png/encode.ts'
import { fitCamera, project, unionCamera } from '../raster/camera.ts'
import type { Camera } from '../raster/camera.ts'
import { rasterize } from '../raster/gbuffer.ts'
import { toWorld } from '../sim/body.ts'
import type { RootState } from '../motion/script.ts'
import { renderSkinned } from '../style/skins.ts'
import { stylize } from '../style/stylize.ts'

const ROOT = resolve(import.meta.dirname, '..', '..')
const HEIGHT_PX = 48
const MARGIN = 6
const ELEVATION_DEG = 14
const SCALE = 4
const BACKGROUND = 0xc8c8c8
const FPS = 24
/** The drawn views' facings, degrees: 0 faces the viewer, 90 faces screen-right. */
const VIEW_FACING: Record<typeof VIEWS[number], number> = {
  front: 0, frontSide: 45, side: 90, backSide: 135, back: 180
}
const USAGE = 'usage: node src/cli/skin.ts guide <character dir> <out dir>\n' +
  '       node src/cli/skin.ts preview <character dir> <skin.json> <out dir> [--clean]'

/** A pose turned to face the given yaw about the pelvis's vertical axis, standing at the origin. */
function turned (pose: Pose, yaw: number): Pose {
  const root: RootState = { position: [0, 0, 0], yaw, velocity: [0, 0, 0], angularVelocity: 0 }
  return Object.fromEntries(Object.entries(pose).map(([name, p]) => [name, toWorld(p, root)]))
}

function cameraFor (character: Character, poses: Pose[]): Camera {
  const fit = { azimuthDeg: 0, elevationDeg: ELEVATION_DEG, targetHeightPx: HEIGHT_PX, margin: MARGIN }
  return unionCamera(poses.map(pose => fitCamera(posedMannequin(character.mannequin, pose), fit)))
}

function row (images: Image[]): SheetCell[] {
  return images.map(image => ({ image, anchor: [0, 0] as [number, number] }))
}

function compass (dx: number, dy: number): string {
  const names = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right']
  return names[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8]
}

/** Guide images and a table for the artist: the character's mannequin in each drawn view, and every part's numbers. */
function guide (character: Character, out: string): void {
  const rest = restPose(character.mannequin)
  const lines: string[] = [`# ${character.name}: drawing guide`, '',
    `Each view at ${HEIGHT_PX} px tall, the camera ${ELEVATION_DEG} degrees above the horizon. Positions are pixels ` +
    'from the top-left of the view image; "top faces" is where a two-joint sprite\'s top row ends up on screen in ' +
    'this view at rest (the sprite is drawn along +x from joint A to joint B).', '']
  for (const view of VIEWS) {
    const yaw = VIEW_FACING[view] * Math.PI / 180
    const pose = turned(rest, yaw)
    const camera = cameraFor(character, [pose])
    const posed = posedMannequin(character.mannequin, pose)
    const { image } = stylize(rasterize(posed, camera), posed, camera, character.style)
    const big = sheet([row([image])], { scale: SCALE, gap: 0, background: BACKGROUND })
    writeOutput(join(out, `${view}.png`), encodePng(big))
    const k = camera.pixelsPerUnit
    lines.push(`## ${view} (facing ${VIEW_FACING[view]} degrees; image ${view}.png)`, '',
      '| Part | Joints A -> B | A (px) | B (px) | Bone (px) | Width at A, B (px) | Top faces |',
      '|---|---|---|---|---|---|---|')
    for (const part of character.mannequin.parts) {
      const a = project(camera, pose[part.a])
      const b = project(camera, pose[part.b])
      const at = (p: { x: number, y: number }): string => `${p.x.toFixed(1)}, ${p.y.toFixed(1)}`
      if (part.shape !== 'capsule') {
        lines.push(`| ${part.name} | ${part.a} (${part.shape}) | ${at(a)} | - | - | - | upright |`)
        continue
      }
      const width = `${(2 * part.radiusA * k).toFixed(1)}, ${(2 * part.radiusB * k).toFixed(1)}`
      if (part.a === part.b) {
        lines.push(`| ${part.name} | ${part.a} | ${at(a)} | - | - | ${width} | upright |`)
        continue
      }
      const dx = b.x - a.x
      const dy = b.y - a.y
      const bone = Math.hypot(dx, dy)
      const top = bone < 0.5 ? 'toward the viewer (end-on)' : compass(dy, -dx)
      const cells = [part.name, `${part.a} -> ${part.b}`, at(a), at(b), bone.toFixed(1), width, top]
      lines.push(`| ${cells.join(' | ')} |`)
    }
    lines.push('')
  }
  writeOutput(join(out, 'guide.md'), `${lines.join('\n')}\n`)
  console.log(`guide: ${out}`)
}

/** A walk in a direction, from motion capture, as poses at the origin and yaws, a stride's worth from the middle. */
type Posed = { pose: Pose, yaw: number }

function capturedWalk (character: Character, dir: string, yaw: number, frames: number): Posed[] {
  const own = join(dir, 'retarget.json')
  if (!existsSync(own)) return []
  const clipDir = join(ROOT, 'motion', 'clips')
  const clips = readdirSync(clipDir).filter(f => f.endsWith('.json')).sort()
    .map(f => validateClip(JSON.parse(readFileSync(join(clipDir, f), 'utf8'))).value as Clip)
  const { style, ...retargeting } = JSON.parse(readFileSync(own, 'utf8'))
  const map = mergeRetargeting(JSON.parse(readFileSync(join(ROOT, 'motion', 'humanoid.json'), 'utf8')), retargeting)
  const rest = restPose(character.mannequin)
  const database = buildDatabase(clips, { rig: character.rig, rest, mannequin: character.mannequin, map, style })
  const player = createPlayer({ database, fps: FPS, ground: () => 0 }, { position: [0, 0, 0], yaw })
  const recorded: Posed[] = []
  for (let i = 0; i < 4 * FPS + frames; i++) {
    player.command({ speed: 1.2, heading: yaw })
    const f = player.step()
    if (i < 4 * FPS) continue
    const pose: Pose = {}
    for (const [name, p] of Object.entries({ ...rest, ...f.pose })) {
      const world = toWorld(p, f.root)
      pose[name] = [world[0] - f.root.position[0], world[1], world[2] - f.root.position[2]]
    }
    recorded.push({ pose, yaw: f.root.yaw })
  }
  return recorded
}

/** The skin in eight directions, a turntable and a walk in every direction, with any errors. */
function preview (character: Character, dir: string, skinFile: string, out: string, clean: boolean): number {
  const read = validateSkin(JSON.parse(readFileSync(skinFile, 'utf8')))
  const crossed = read.value === undefined ? [] : checkSkin(read.value, character.mannequin)
  const errors = [...read.errors, ...crossed]
  if (errors.length > 0 || read.value === undefined) {
    const message = formatErrors(skinFile, errors)
    writeOutput(join(out, 'summary.txt'), `skin: INVALID\n${message}\n`)
    console.error(message)
    return 1
  }
  const skin: Skin = read.value
  const rest = restPose(character.mannequin)
  const rotation = clean ? 'clean' as const : 'nearest' as const
  const directions = Array.from({ length: 8 }, (_, i) => i * Math.PI / 4)
  const still = directions.map(yaw => turned(rest, yaw))
  const turntable = Array.from({ length: 32 }, (_, i) => i * Math.PI / 16)
  const spin = turntable.map(yaw => turned(rest, yaw))
  const walks = directions.map(yaw => capturedWalk(character, dir, yaw, 8))
  const camera = cameraFor(character, [...still, ...spin, ...walks.flat().map(w => w.pose)])
  const draw = (pose: Pose, yaw: number, state: { sector?: number }, angles: Map<string, number>): Image => {
    return renderSkinned({ mannequin: character.mannequin, pose, skin, camera, rotation, angles, yaw, view: state })
  }
  const big = { scale: SCALE, gap: SCALE, background: BACKGROUND }
  const stills = still.map((pose, i) => draw(pose, directions[i], {}, new Map()))
  writeOutput(join(out, 'directions.png'), encodePng(sheet([row(stills)], big)))
  const spinState = {}
  const spinAngles = new Map<string, number>()
  const spun = spin.map((pose, i) => draw(pose, turntable[i], spinState, spinAngles))
  writeOutput(join(out, 'turntable.png'), encodePng(sheet([row(spun.slice(0, 16)), row(spun.slice(16))], big)))
  const strips = walks.filter(w => w.length > 0).map(walk => {
    const state = {}
    const angles = new Map<string, number>()
    return row(walk.map(w => draw(w.pose, w.yaw, state, angles)))
  })
  if (strips.length > 0) writeOutput(join(out, 'walks.png'), encodePng(sheet(strips, big)))
  const summary = [
    `skin: ${skin.name} VALID (${skin.views === undefined ? 'one view' : 'eight directions'}, ${rotation} rotation)`,
    `colours: ${Object.keys(skin.palette).length} of 16`,
    `turntable flicker: ${(100 * flickerFraction(spun)).toFixed(2)}% (32 steps of 11.25 degrees)`,
    'images: directions.png (facing the viewer, then turning to its left in 45-degree steps), turntable.png, ' +
      (strips.length > 0 ? 'walks.png (one row per direction)' : 'no walks (no retarget.json)')
  ].join('\n')
  writeOutput(join(out, 'summary.txt'), `${summary}\n`)
  console.log(summary)
  return 0
}

function main (): number {
  const [command, dir, ...rest] = process.argv.slice(2)
  if (dir === undefined) {
    console.error(USAGE)
    return 2
  }
  const loaded = loadCharacter(resolve(dir))
  if (loaded.value === undefined) {
    console.error(loaded.errors.map(e => `${e.path}: ${e.message}`).join('\n'))
    return 2
  }
  if (command === 'guide' && rest[0] !== undefined) {
    guide(loaded.value, resolve(rest[0]))
    return 0
  }
  if (command === 'preview' && rest[1] !== undefined) {
    return preview(loaded.value, resolve(dir), resolve(rest[0]), resolve(rest[1]), rest.includes('--clean'))
  }
  console.error(USAGE)
  return 2
}

process.exitCode = main()
