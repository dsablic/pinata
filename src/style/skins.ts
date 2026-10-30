import { createImage, getPixel, parseHex, setPixel, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import type { Mannequin } from '../formats/mannequin.ts'
import type { Skin } from '../formats/skin.ts'
import type { Vec3 } from '../math/vec.ts'
import { project } from '../raster/camera.ts'
import type { Camera } from '../raster/camera.ts'
import type { Pose } from '../motion/pose.ts'
import { cleanRotation, toGrid } from './rotsprite.ts'
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
}

type Screen = { x: number, y: number, depth: number }
type Placement = {
  name: string
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

function placements (o: SkinnedOptions): Placement[] {
  const found: Placement[] = []
  for (const part of o.mannequin.parts) {
    const sprite = o.skin.parts[part.name]
    if (sprite === undefined || sprite.hidden === true || sprite.rows === undefined || sprite.pivotA === undefined) {
      continue
    }
    const a: Screen = project(o.camera, jointOf(o.mannequin, o.pose, part.a))
    const b: Screen = project(o.camera, jointOf(o.mannequin, o.pose, part.b))
    const single = part.a === part.b
    const raw = Math.atan2(b.y - a.y, b.x - a.x)
    const angle = single ? 0 : o.rotation === 'clean' ? cleanStep(raw, o.angles?.get(part.name)) : snapAngle(raw)
    if (!single && o.rotation === 'clean') o.angles?.set(part.name, angle)
    found.push({
      name: part.name,
      rows: sprite.rows,
      pivot: sprite.pivotA,
      anchor: [Math.floor(a.x), Math.floor(a.y)],
      angle,
      depth: (a.depth + b.depth) / 2
    })
  }
  return found.sort((p, q) => q.depth - p.depth)
}

/** The 11.25-degree step nearest the angle, keeping the previous step until the angle is well past their middle. */
export function cleanStep (radians: number, previous?: number): number {
  const nearest = Math.round(radians / CLEAN_STEP) * CLEAN_STEP
  if (previous === undefined) return nearest
  const off = Math.atan2(Math.sin(radians - previous), Math.cos(radians - previous))
  return Math.abs(off) <= CLEAN_STEP * (0.5 + HYSTERESIS) ? previous : nearest
}

const ROTATIONS = new Map<string, Rotated>()

/** A part's sprite turned cleanly, cached by sprite and step. */
function rotated (p: Placement): Rotated {
  const step = Math.round(p.angle / CLEAN_STEP)
  const key = `${p.rows.join('/')}|${p.pivot.join(',')}|${step}`
  let found = ROTATIONS.get(key)
  if (found === undefined) {
    found = cleanRotation(toGrid(p.rows), p.pivot, step * CLEAN_STEP)
    ROTATIONS.set(key, found)
  }
  return found
}

function paintClean (img: Image, p: Placement, colours: Map<string, number>): void {
  const { grid, pivot } = rotated(p)
  grid.forEach((row, y) => row.forEach((c, x) => {
    const colour = colours.get(c)
    if (colour !== undefined) setPixel(img, p.anchor[0] + x - pivot[0], p.anchor[1] + y - pivot[1], colour)
  }))
}

function paint (img: Image, p: Placement, colours: Map<string, number>): void {
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
      if (colour !== undefined) setPixel(img, p.anchor[0] + dx, p.anchor[1] + dy, colour)
    }
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
  for (const p of placements(options)) {
    if (options.rotation === 'clean' && p.angle !== 0) paintClean(img, p, colours)
    else paint(img, p, colours)
  }
  drawOutline(img, [...colours.values()].reduce((a, b) => luminance(b) < luminance(a) ? b : a))
  return img
}
