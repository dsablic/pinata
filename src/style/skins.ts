import { createImage, getPixel, parseHex, setPixel, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import type { Mannequin } from '../formats/mannequin.ts'
import type { Skin, SkinPart } from '../formats/skin.ts'
import type { Vec3 } from '../math/vec.ts'
import { project } from '../raster/camera.ts'
import type { Camera } from '../raster/camera.ts'
import type { Pose } from '../motion/pose.ts'
import { cleanRotation, toGrid } from './rotsprite.ts'
import { chooseView, counterpart, facingAngle, fitted, mirrored } from './views.ts'
import type { ViewChoice } from './views.ts'
import type { Rotated } from './rotsprite.ts'

export type SkinnedOptions = {
  mannequin: Mannequin
  pose: Pose
  skin: Skin
  camera: Camera
  /**
   * How limbs rotate: 'nearest' (the default) snaps to 22.5 degrees and samples the nearest pixel; 'clean' snaps to
   * 11.25 degrees and rotates with RotSprite (see rotsprite.ts). With 'clean', `angles` keeps each part's last step
   * between frames, so a bone near the middle of two steps does not flicker between them.
   */
  rotation?: 'nearest' | 'clean'
  angles?: Map<string, number>
  /**
   * For an eight-direction skin: the character's yaw, and a place to keep the view between frames (its sector), so
   * the view changes with hysteresis.
   */
  yaw?: number
  view?: { sector?: number }
}

type Screen = { x: number, y: number, depth: number }
type Placement = {
  name: string
  layer?: number
  /** The part's joints, to tell parts that join (no line between them) from parts that only overlap. */
  joints: [string, string]
  /** The farther of a left and right pair, drawn a shade darker. */
  far?: boolean
  /** For a mirrored two-joint part, the sprite before mirroring: clean rotation turns it and flips the result. */
  unmirrored?: { rows: string[], pivot: [number, number] }
  rows: string[]
  pivot: [number, number]
  anchor: [number, number]
  angle: number
  depth: number
}

export const ANGLE_STEP = Math.PI / 8
export const CLEAN_STEP = Math.PI / 16
/** How far past the middle between two steps a bone must turn before a clean rotation moves to the next step. */
const HYSTERESIS = 0.25
const SNAP = 1e-9
const NEIGHBOURS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]

export function snapAngle (radians: number): number {
  return Math.round(radians / ANGLE_STEP) * ANGLE_STEP
}

function exactTrig (angle: number): { cos: number, sin: number } {
  const clean = (v: number): number => Math.abs(v) < SNAP ? 0 : Math.abs(Math.abs(v) - 1) < SNAP ? Math.sign(v) : v
  return { cos: clean(Math.cos(angle)), sin: clean(Math.sin(angle)) }
}

function jointOf (m: Mannequin, pose: Pose, name: string): Vec3 {
  return pose[name] ?? m.joints[name]
}

/**
 * The sprite a part shows: for a one-view skin, its own; for an eight-direction skin, the chosen view's (the
 * counterpart's, mirrored, in a left-facing direction), fitted to the bone's length on screen.
 */
type Shown = { sprite: SkinPart | undefined, unmirrored?: SkinPart }

function spriteFor (
  o: SkinnedOptions,
  name: string,
  single: boolean,
  choice: ViewChoice | undefined,
  length: number
): Shown {
  if (choice === undefined || o.skin.views === undefined) return { sprite: o.skin.parts[name] }
  const parts = o.skin.views[choice.view].parts
  const drawn = parts[choice.mirror ? counterpart(name) : name] ?? parts[name]
  if (drawn === undefined) return { sprite: undefined }
  const sized = single ? drawn : fitted(drawn, length)
  if (!choice.mirror) return { sprite: sized }
  return { sprite: mirrored(sized, !single), ...(single ? {} : { unmirrored: sized }) }
}

function placements (o: SkinnedOptions): Placement[] {
  const found: Placement[] = []
  let choice: ViewChoice | undefined
  if (o.skin.views !== undefined) {
    if (o.yaw === undefined) throw new Error(`skin '${o.skin.name}' has eight directions: pass the character's yaw`)
    choice = chooseView(facingAngle(o.camera, o.yaw), o.view?.sector)
    if (o.view !== undefined) o.view.sector = choice.sector
  }
  for (const part of o.mannequin.parts) {
    const a: Screen = project(o.camera, jointOf(o.mannequin, o.pose, part.a))
    const b: Screen = project(o.camera, jointOf(o.mannequin, o.pose, part.b))
    const single = part.a === part.b
    const { sprite, unmirrored } = spriteFor(o, part.name, single, choice, Math.hypot(b.x - a.x, b.y - a.y))
    if (sprite === undefined || sprite.hidden === true || sprite.rows === undefined || sprite.pivotA === undefined) {
      continue
    }
    const raw = Math.atan2(b.y - a.y, b.x - a.x)
    const angle = single ? 0 : o.rotation === 'clean' ? cleanStep(raw, o.angles?.get(part.name)) : snapAngle(raw)
    if (!single && o.rotation === 'clean') o.angles?.set(part.name, angle)
    found.push({
      name: part.name,
      joints: [part.a, part.b],
      ...(sprite.layer === undefined ? {} : { layer: sprite.layer }),
      ...(unmirrored?.rows === undefined || unmirrored.pivotA === undefined
        ? {}
        : { unmirrored: { rows: unmirrored.rows, pivot: unmirrored.pivotA } }),
      rows: sprite.rows,
      pivot: sprite.pivotA,
      anchor: [Math.floor(a.x), Math.floor(a.y)],
      angle,
      depth: (a.depth + b.depth) / 2
    })
  }
  if (choice !== undefined) {
    // the farther of each left and right pair, where one is clearly behind the other
    const byName = new Map(found.map(p => [p.name, p]))
    for (const p of found) {
      const other = byName.get(counterpart(p.name))
      if (other !== undefined && other !== p && p.depth - other.depth > FAR_DEPTH) p.far = true
    }
  }
  return found.sort((p, q) => (p.layer ?? 0) - (q.layer ?? 0) || q.depth - p.depth)
}

/** How much deeper (metres) a limb must be than its counterpart to count as the far one. */
const FAR_DEPTH = 0.05

/**
 * Each palette colour's next shade down: the darker palette colour nearest in hue and saturation (its colour less
 * its grey), the step closest in brightness breaking ties; the colour itself when none is darker.
 */
export function darkerShades (colours: Map<string, number>): Map<number, number> {
  const rgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255]
  const tint = (c: number): [number, number, number] => {
    const [r, g, b] = rgb(c)
    const grey = (r + g + b) / 3
    return [r - grey, g - grey, b - grey]
  }
  const all = [...new Set(colours.values())]
  return new Map(all.map(c => {
    const darker = all.filter(d => luminance(d) < luminance(c) - 1)
    if (darker.length === 0) return [c, c]
    const cost = (d: number): number => {
      const [a, b] = [tint(c), tint(d)]
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) + 0.35 * (luminance(c) - luminance(d))
    }
    return [c, darker.reduce((best, d) => cost(d) < cost(best) ? d : best)]
  }))
}

/** The 11.25-degree step nearest the angle, keeping the previous step until the angle is well past their middle. */
export function cleanStep (radians: number, previous?: number): number {
  const nearest = Math.round(radians / CLEAN_STEP) * CLEAN_STEP
  if (previous === undefined) return nearest
  const off = Math.atan2(Math.sin(radians - previous), Math.cos(radians - previous))
  return Math.abs(off) <= CLEAN_STEP * (0.5 + HYSTERESIS) ? previous : nearest
}

const ROTATIONS = new Map<string, Rotated>()
/** Most clean rotations kept; the oldest go first. */
const ROTATIONS_KEPT = 4096
const STEPS = Math.round(2 * Math.PI / CLEAN_STEP)

/** A sprite turned cleanly by a number of steps, cached by sprite, pivot and step. */
function rotatedBy (rows: string[], pivot: [number, number], turns: number): Rotated {
  const step = ((turns % STEPS) + STEPS) % STEPS
  const key = JSON.stringify([rows, pivot, step])
  let found = ROTATIONS.get(key)
  if (found === undefined) {
    found = cleanRotation(toGrid(rows), pivot, step * CLEAN_STEP)
    if (ROTATIONS.size >= ROTATIONS_KEPT) ROTATIONS.delete(ROTATIONS.keys().next().value as string)
    ROTATIONS.set(key, found)
  }
  return found
}

/**
 * A part's sprite turned cleanly. A mirrored two-joint part turns its unmirrored sprite by the mirrored angle and
 * flips the result, so left- and right-facing directions are exact mirrors of each other.
 */
function rotated (p: Placement): Rotated {
  const steps = Math.round(p.angle / CLEAN_STEP)
  if (p.unmirrored === undefined) return rotatedBy(p.rows, p.pivot, steps)
  const turned = rotatedBy(p.unmirrored.rows, p.unmirrored.pivot, STEPS / 2 - steps)
  const width = turned.grid[0].length
  return { grid: turned.grid.map(row => [...row].reverse()), pivot: [width - 1 - turned.pivot[0], turned.pivot[1]] }
}

/** Where an eight-direction skin's parts were painted, by placement index, and how to darken a colour. */
type Ink = { owner: Int16Array, index: number, shade: Map<number, number> }

function put (img: Image, x: number, y: number, colour: number, p: Placement, ink?: Ink): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return
  setPixel(img, x, y, ink !== undefined && p.far === true ? ink.shade.get(colour) ?? colour : colour)
  if (ink !== undefined) ink.owner[y * img.width + x] = ink.index
}

function paintClean (img: Image, p: Placement, colours: Map<string, number>, ink?: Ink): void {
  const { grid, pivot } = rotated(p)
  grid.forEach((row, y) => row.forEach((c, x) => {
    const colour = colours.get(c)
    if (colour !== undefined) put(img, p.anchor[0] + x - pivot[0], p.anchor[1] + y - pivot[1], colour, p, ink)
  }))
}

function paint (img: Image, p: Placement, colours: Map<string, number>, ink?: Ink): void {
  const lines = p.rows.map(row => [...row])
  const { cos, sin } = exactTrig(p.angle)
  const w = lines[0].length
  const h = lines.length
  const reach = Math.ceil(Math.hypot(w, h))
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const sx = Math.floor(p.pivot[0] + 0.5 + dx * cos + dy * sin)
      const sy = Math.floor(p.pivot[1] + 0.5 - dx * sin + dy * cos)
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue
      const colour = colours.get(lines[sy][sx])
      if (colour === undefined) continue
      if (ink === undefined) setPixel(img, p.anchor[0] + dx, p.anchor[1] + dy, colour)
      else put(img, p.anchor[0] + dx, p.anchor[1] + dy, colour, p, ink)
    }
  }
}

/**
 * Inner lines, as a pixel artist draws them where one part overlaps another: wherever a part's pixel borders an
 * earlier (farther) part it does not join at a joint, that farther pixel takes its next shade down.
 */
function innerLines (img: Image, placed: Placement[], ink: Ink): void {
  const { owner, shade } = ink
  const joins = (p: Placement, q: Placement): boolean => p.joints.some(j => q.joints.includes(j))
  const marked: number[] = []
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const near = owner[y * img.width + x]
      if (near < 0) continue
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) continue
        const far = owner[ny * img.width + nx]
        if (far < 0 || far >= near || joins(placed[near], placed[far])) continue
        marked.push(ny * img.width + nx)
      }
    }
  }
  for (const i of new Set(marked)) {
    const x = i % img.width
    const y = Math.floor(i / img.width)
    const colour = getPixel(img, x, y)
    setPixel(img, x, y, shade.get(colour) ?? colour)
  }
}

function luminance (rgb: number): number {
  return 0.2126 * ((rgb >> 16) & 255) + 0.7152 * ((rgb >> 8) & 255) + 0.0722 * (rgb & 255)
}

function drawOutline (img: Image, colour: number): void {
  const edge: Array<[number, number]> = []
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (getPixel(img, x, y) !== TRANSPARENT) continue
      if (NEIGHBOURS.some(([dx, dy]) => getPixel(img, x + dx, y + dy) !== TRANSPARENT)) edge.push([x, y])
    }
  }
  for (const [x, y] of edge) setPixel(img, x, y, colour)
}

export function renderSkinned (options: SkinnedOptions): Image {
  const img = createImage(options.camera.width, options.camera.height)
  const colours = new Map(Object.entries(options.skin.palette).map(([key, hex]) => [key, parseHex(hex)]))
  const placed = placements(options)
  // eight-direction skins also get inner lines and darker far limbs; one-view skins render as they always have
  const ink: Ink | undefined = options.skin.views === undefined
    ? undefined
    : { owner: new Int16Array(img.width * img.height).fill(-1), index: 0, shade: darkerShades(colours) }
  placed.forEach((p, index) => {
    if (ink !== undefined) ink.index = index
    if (options.rotation === 'clean' && p.angle !== 0) paintClean(img, p, colours, ink)
    else paint(img, p, colours, ink)
  })
  if (ink !== undefined) innerLines(img, placed, ink)
  drawOutline(img, [...colours.values()].reduce((a, b) => luminance(b) < luminance(a) ? b : a))
  return img
}
