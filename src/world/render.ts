import type { Mannequin } from '../formats/mannequin.ts'
import type { Style } from '../formats/style.ts'
import { createImage, getPixel, parseHex, setPixel, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import { add, dot, scale } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { makeCamera } from '../raster/camera.ts'
import type { Camera } from '../raster/camera.ts'
import { rasterize } from '../raster/gbuffer.ts'
import type { GBuffer } from '../raster/gbuffer.ts'
import { stylize } from '../style/stylize.ts'
import type { WorldConfig } from './config.ts'
import type { Terrain } from './terrain.ts'
import type { WorldFrame } from './world.ts'

/** The config's view, plus the depth of the walkable band (metres either side of z = 0) and the bubble glyphs. */
export type WorldViewOptions = WorldConfig['view'] & { depth: number, glyphs: WorldConfig['glyphs'] }
export type Look = { mannequin: Mannequin, style: Style }

type Sprite = { camera: Camera, previous?: GBuffer, size: number }



/**
 * Draws a world frame: the terrain from the side with its top band and front face, then every character rendered
 * live in its own box that follows it (keeping its own temporal hysteresis), back to front, with speech bubbles.
 */
export function createWorldView (terrain: Terrain, looks: Look[], options: WorldViewOptions) {
  const ppu = options.pixelsPerMetre
  const base = makeCamera({
    azimuthDeg: options.azimuthDeg, elevationDeg: options.elevationDeg, targetHeightPx: ppu, modelHeight: 1,
    margin: 0
  })
  const origin: Vec3 = [terrain.from + (options.width / 2) / ppu - 0.4, 0, 0]
  const front: Vec3 = [0, 0, options.depth / 2]
  const baseline = options.height - options.floorPx + dot(front, base.up) * ppu
  const world: Camera = { ...base, width: options.width, height: options.height, baseline }
  const screen = (p: Vec3): [number, number] => {
    const q: Vec3 = [p[0] - origin[0], p[1], p[2]]
    return [world.width / 2 + dot(q, world.right) * ppu, world.baseline - dot(q, world.up) * ppu]
  }
  const sprites: Sprite[] = looks.map(look => {
    const size = Math.ceil(look.mannequin.height * ppu * 1.9) + 6
    const camera: Camera = { ...base, width: size, height: size, baseline: size }
    return { camera, size }
  })
  const backdrop = drawTerrain(terrain, options, screen)

  const render = (frame: WorldFrame): Image => {
    const out = createImage(options.width, options.height)
    out.data.set(backdrop.data)
    const depth = (i: number): number => frame.actors[i].root.position[2]
    const order = frame.actors.map((_, i) => i).sort((a, b) => depth(a) - depth(b))
    for (const i of order) {
      const actor = frame.actors[i]
      const look = looks[i]
      const sprite = sprites[i]
      const root = actor.root.position
      const anchor = screen([root[0], root[1], root[2]])
      const left = Math.round(anchor[0] - sprite.size / 2)
      const top = Math.round(anchor[1] - sprite.size * 0.78)
      const shift = add(
        scale(sprite.camera.right, (anchor[0] - left - sprite.size / 2) / ppu),
        scale(sprite.camera.up, (sprite.size - (anchor[1] - top)) / ppu)
      )
      const joints: Record<string, Vec3> = {}
      for (const [name, p] of Object.entries(actor.joints)) {
        joints[name] = add([p[0] - root[0], p[1] - root[1], p[2] - root[2]], shift)
      }
      const yaw = actor.root.yaw
      const decals = look.mannequin.decals.map(d => ({ ...d, normal: turnY(d.normal, yaw) }))
      const posed: Mannequin = { ...look.mannequin, joints, decals }
      const g = rasterize(posed, sprite.camera, options.samples, sprite.previous)
      sprite.previous = g
      const image = stylize(g, posed, sprite.camera, look.style).image
      blit(out, image, left, top)
      if (actor.say !== undefined) {
        bubble(out, options.glyphs[actor.say] ?? Object.values(options.glyphs)[0], Math.round(anchor[0]),
          top + Math.round(sprite.size * 0.1))
      }
    }
    return out
  }
  return { render, screen, camera: world }
}

function turnY (v: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]
}

function blit (out: Image, image: Image, left: number, top: number): void {
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const c = getPixel(image, x, y)
      if (c !== TRANSPARENT) setPixel(out, left + x, top + y, c)
    }
  }
}

/** A speech bubble with a glyph (rows of '#' ink and '.' paper) above a point. */
function bubble (out: Image, rows: string[], cx: number, bottom: number): void {
  const w = Math.max(...rows.map(r => r.length)) + 4
  const h = rows.length + 4
  const left = cx - Math.floor(w / 2)
  const top = bottom - h - 3
  const ink = 0x2b2233
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1
      const corner = (x === 0 || x === w - 1) && (y === 0 || y === h - 1)
      if (corner) continue
      setPixel(out, left + x, top + y, edge ? ink : 0xffffff)
    }
  }
  for (let i = 0; i < 2; i++) setPixel(out, cx - i, top + h + i, ink)
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => { if (ch === '#') setPixel(out, left + 2 + x, top + 2 + y, ink) })
  })
}

/** The terrain as pixel art: sky, the top band between the back and front of the lanes, and the front face below it. */
function drawTerrain (terrain: Terrain, options: WorldViewOptions, screen: (p: Vec3) => [number, number]): Image {
  const out = createImage(options.width, options.height)
  const sky = parseHex(options.palette.sky)
  const top = parseHex(options.palette.top)
  const side = parseHex(options.palette.side)
  const edge = parseHex(options.palette.edge)
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) setPixel(out, x, y, sky)
  const back = -options.depth / 2
  const front = options.depth / 2
  const step = 0.2 / options.pixelsPerMetre
  for (let wx = terrain.from - 2; wx <= terrain.to + 2; wx += step) {
    const h = terrain.ground(wx, 0)
    const [bx, by] = screen([wx, h, back])
    const [fx, fy] = screen([wx, h, front])
    const [, ly] = screen([wx, -1, front])
    const segments = Math.ceil(Math.max(Math.abs(fx - bx), Math.abs(fy - by))) + 1
    for (let i = 0; i <= segments; i++) {
      const u = i / segments
      const x = Math.round(bx + (fx - bx) * u)
      const yTop = Math.round(by + (fy - by) * u)
      setPixel(out, x, yTop, top)
    }
    const x = Math.round(fx)
    for (let y = Math.round(fy); y <= Math.min(out.height - 1, Math.round(ly)); y++) setPixel(out, x, y, side)
    setPixel(out, x, Math.round(fy), edge)
  }
  return out
}
