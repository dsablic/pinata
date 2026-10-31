import type { Mannequin, Part } from '../formats/mannequin.ts'
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
import { renderSkinned } from '../style/skins.ts'
import type { Skin } from '../formats/skin.ts'
import type { Scenario } from '../formats/sim.ts'
import { clothParts, withClothParts } from '../sim/render.ts'
import type { Palette, WorldConfig } from './config.ts'
import type { Terrain } from './terrain.ts'
import type { ActorFrame, WorldFrame } from './world.ts'
import type { Pose } from '../motion/pose.ts'
import { turnToWorld } from './yaw.ts'

export type WorldViewOptions = WorldConfig['view'] & {
  skins?: boolean
  depth: number
  extent: [number, number]
  glyphs: WorldConfig['glyphs']
  palette: Palette
}
export type Look = {
  mannequin: Mannequin
  style: Style
  cloth?: Scenario
  skin?: { skin: Skin, mannequin: Mannequin }
}

type Sprite = { camera: Camera, previous?: GBuffer, size: number, view: { sector?: number } }

const SPRITE_MARGIN = 1.15
const MARGIN_PX = 8

function reachOf (look: Look): number {
  const joints = Object.values(look.mannequin.joints)
  const farthest = Math.max(...joints.map(p => Math.hypot(p[0], p[1], p[2])))
  const thickness = (p: Part): number => p.shape === 'capsule' ? Math.max(p.radiusA, p.radiusB) : p.width
  const thickest = Math.max(0, ...look.mannequin.parts.map(thickness))
  const { cloth } = look
  const chains = cloth?.chains.map(c => c.links * c.linkLength) ?? []
  const hanging = Math.max(cloth?.cape?.length ?? 0, ...chains)
  return farthest + thickest + hanging
}

export function createWorldView (terrain: Terrain, looks: Look[], options: WorldViewOptions) {
  const ppu = options.pixelsPerMetre
  const base = makeCamera({
    azimuthDeg: options.azimuthDeg, elevationDeg: options.elevationDeg, targetHeightPx: ppu, modelHeight: 1,
    margin: 0
  })
  const heightOf = (span: Terrain['spans'][number]): number => {
    return span.kind === 'flat' ? span.height : Math.max(span.start, span.end)
  }
  const top = Math.max(...terrain.spans.map(heightOf))
  const tallest = Math.max(...looks.map(reachOf))
  const corners: Vec3[] = []
  for (const x of [options.extent[0], options.extent[1]]) {
    for (const y of [0, top + tallest]) {
      for (const z of [-options.depth / 2, options.depth / 2]) corners.push([x, y, z])
    }
  }
  const across = corners.map(p => dot(p, base.right) * ppu)
  const down = corners.map(p => -dot(p, base.up) * ppu)
  const width = Math.ceil(Math.max(...across) - Math.min(...across)) + 2 * MARGIN_PX
  const height = Math.ceil(Math.max(...down) - Math.min(...down)) + MARGIN_PX + options.floorPx
  const left = Math.min(...across)
  const shiftX = MARGIN_PX - left
  const baseline = height - options.floorPx - Math.max(...down)
  const world: Camera = { ...base, width, height, baseline }
  const screen = (p: Vec3): [number, number] => {
    return [shiftX + dot(p, world.right) * ppu, baseline - dot(p, world.up) * ppu]
  }
  const sprites: Sprite[] = looks.map(look => {
    const size = Math.ceil(2 * reachOf(look) * ppu * SPRITE_MARGIN) + 6
    const camera: Camera = { ...base, width: size, height: size, baseline: size }
    return { camera, size, view: {} }
  })
  let skinned = options.skins !== false
  let backdrop = drawTerrain(terrain, options, options.palette, screen, [width, height])

  const boxOf = (i: number, root: Vec3): { left: number, top: number, size: number } => {
    const anchor = screen(root)
    const { size } = sprites[i]
    return { left: Math.round(anchor[0] - size / 2), top: Math.round(anchor[1] - size / 2), size }
  }

  const drawProcedural = (actor: ActorFrame, look: Look, sprite: Sprite, joints: Pose, shift: Vec3): Image => {
    const decals = look.mannequin.decals.map(d => ({ ...d, normal: turnToWorld(d.normal, actor.root.yaw) }))
    let posed: Mannequin = { ...look.mannequin, joints, decals }
    if (look.cloth !== undefined && actor.cloth !== undefined) {
      const here = { position: actor.root.position, yaw: 0, velocity: [0, 0, 0] as Vec3, angularVelocity: 0 }
      const cloth = clothParts(look.cloth, actor.cloth, here)
      for (const name of Object.keys(cloth.joints)) cloth.joints[name] = add(cloth.joints[name], shift)
      posed = withClothParts(posed, cloth)
    }
    const g = rasterize(posed, sprite.camera, options.samples, sprite.previous)
    sprite.previous = g
    return stylize(g, posed, sprite.camera, look.style).image
  }

  const render = (frame: WorldFrame): Image => {
    const out = createImage(width, height)
    out.data.set(backdrop.data)
    const depth = (i: number): number => frame.actors[i].root.position[2]
    const order = frame.actors.map((_, i) => i).sort((a, b) => depth(a) - depth(b))
    for (const i of order) {
      const actor = frame.actors[i]
      const look = looks[i]
      const sprite = sprites[i]
      const root = actor.root.position
      const anchor = screen([root[0], root[1], root[2]])
      const { left, top } = boxOf(i, root)
      const shift = add(
        scale(sprite.camera.right, (anchor[0] - left - sprite.size / 2) / ppu),
        scale(sprite.camera.up, (sprite.size - (anchor[1] - top)) / ppu)
      )
      const joints: Pose = {}
      for (const [name, p] of Object.entries(actor.joints)) {
        joints[name] = add([p[0] - root[0], p[1] - root[1], p[2] - root[2]], shift)
      }
      const image = skinned && look.skin !== undefined
        ? renderSkinned({
          ...look.skin,
          pose: { ...look.skin.mannequin.joints, ...joints },
          camera: sprite.camera,
          yaw: actor.root.yaw,
          view: sprite.view
        })
        : drawProcedural(actor, look, sprite, joints, shift)
      blit(out, image, left, top)
      if (actor.say !== undefined) {
        bubble(out, options.glyphs[actor.say] ?? Object.values(options.glyphs)[0], Math.round(anchor[0]),
          top + Math.round(sprite.size * 0.1))
      }
    }
    return out
  }
  const setPalette = (palette: Palette): void => {
    backdrop = drawTerrain(terrain, options, palette, screen, [width, height])
  }
  const boxes = (frame: WorldFrame) => frame.actors.map((actor, i) => boxOf(i, actor.root.position))
  const setSkins = (on: boolean): void => { skinned = on }
  return { render, screen, setPalette, setSkins, boxes, camera: world }
}

function blit (out: Image, image: Image, left: number, top: number): void {
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const c = getPixel(image, x, y)
      if (c !== TRANSPARENT) setPixel(out, left + x, top + y, c)
    }
  }
}

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

function drawTerrain (
  terrain: Terrain,
  options: WorldViewOptions,
  palette: Palette,
  screen: (p: Vec3) => [number, number],
  size: [number, number]
): Image {
  const out = createImage(size[0], size[1])
  const sky = parseHex(palette.sky)
  const top = parseHex(palette.top)
  const side = parseHex(palette.side)
  const edge = parseHex(palette.edge)
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
