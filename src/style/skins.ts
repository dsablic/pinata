import { createImage, getPixel, parseHex, setPixel, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import type { Mannequin, Part } from '../formats/mannequin.ts'
import type { Skin, SkinPart } from '../formats/skin.ts'
import type { Vec3 } from '../math/vec.ts'
import { project } from '../raster/camera.ts'
import type { Camera } from '../raster/camera.ts'
import type { Pose } from '../motion/pose.ts'
import { cleanRotation, toGrid } from './rotsprite.ts'
import { chooseView, counterpart, facingAngle, fitted, mirrored, spanOf } from './views.ts'
import type { ViewChoice } from './views.ts'
import type { Rotated } from './rotsprite.ts'
import { drawOrder } from './order.ts'
import { turnBetween, turnToWorld } from '../world/yaw.ts'
import { endOf, paintStrip } from './strip.ts'
import { endOnAngle, isEndOnView, soleDrop } from './feet.ts'

export type SkinnedOptions = {
  mannequin: Mannequin
  pose: Pose
  skin: Skin
  camera: Camera
  rotation?: 'nearest' | 'clean'
  angles?: Map<string, number>
  lengths?: Map<string, number>
  anchors?: Map<string, [number, number]>
  curves?: Record<string, Vec3[]>
  footprints?: boolean
  feet?: readonly string[]
  painter?: 'strip'
  order?: string[]
  yaw?: number
  view?: { sector?: number }
}

type Screen = { x: number, y: number, depth: number }
type Placement = {
  name: string
  layer?: number
  joints: [string, string]
  far?: boolean
  unmirrored?: { rows: string[], pivot: [number, number] }
  rows: string[]
  pivot: [number, number]
  anchor: [number, number]
  angle: number
  depth: number
  curve?: { points: Array<[number, number]>, span: number }
  points?: Array<[number, number]>
  lay?: { length: number, heading: [number, number], joint: [number, number] }
  drawn: number
  shown?: number
}

export const ANGLE_STEP = Math.PI / 8
export const CLEAN_STEP = Math.PI / 16
const HYSTERESIS = 0.25
const SNAP = 1e-9
const SECTOR_ANGLE = Math.PI / 4
const REST_YAW = Math.PI / 2
const NEIGHBOURS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]

export function snapAngle (radians: number, previous?: number): number {
  return steadyStep(radians, ANGLE_STEP, previous)
}

export function snapAbout (radians: number, rest: number, previous?: number): number {
  const kept = previous === undefined ? undefined : turnBetween(rest, previous)
  return rest + steadyStep(turnBetween(rest, radians), ANGLE_STEP, kept)
}

function restYaw (o: SkinnedOptions, choice: ViewChoice | undefined): number {
  if (choice === undefined || o.yaw === undefined) return REST_YAW
  return o.yaw - (facingAngle(o.camera, o.yaw) - choice.sector * SECTOR_ANGLE)
}

function restAngle (o: SkinnedOptions, part: Part, choice: ViewChoice | undefined): number {
  const yaw = restYaw(o, choice)
  const at = (joint: string): Screen => project(o.camera, turnToWorld(o.mannequin.joints[joint], yaw))
  const [a, b] = [at(part.a), at(part.b)]
  return Math.atan2(b.y - a.y, b.x - a.x)
}

function exactTrig (angle: number): { cos: number, sin: number } {
  const clean = (v: number): number => Math.abs(v) < SNAP ? 0 : Math.abs(Math.abs(v) - 1) < SNAP ? Math.sign(v) : v
  return { cos: clean(Math.cos(angle)), sin: clean(Math.sin(angle)) }
}

function jointOf (m: Mannequin, pose: Pose, name: string): Vec3 {
  return pose[name] ?? m.joints[name]
}

type Shown = { sprite: SkinPart | undefined, unmirrored?: SkinPart, span: number }

function spriteFor (
  o: SkinnedOptions,
  name: string,
  single: boolean,
  choice: ViewChoice | undefined,
  length?: number
): Shown {
  if (choice === undefined || o.skin.views === undefined) {
    return { sprite: o.skin.parts[name], span: spanOf(o.skin.parts[name]) }
  }
  const parts = o.skin.views[choice.view].parts
  const drawn = parts[choice.mirror ? counterpart(name) : name] ?? parts[name]
  if (drawn === undefined) return { sprite: undefined, span: 0 }
  const sized = single || length === undefined ? drawn : fitted(drawn, length)
  const span = spanOf(drawn)
  if (!choice.mirror) return { sprite: sized, span }
  return { sprite: mirrored(sized, !single), ...(single ? {} : { unmirrored: sized }), span }
}

function chosenView (o: SkinnedOptions): ViewChoice | undefined {
  if (o.skin.views === undefined) return undefined
  if (o.yaw === undefined) throw new Error(`skin '${o.skin.name}' has eight directions: pass the character's yaw`)
  const choice = chooseView(facingAngle(o.camera, o.yaw), o.view?.sector)
  if (o.view !== undefined) {
    if (o.view.sector !== undefined && o.view.sector !== choice.sector) o.angles?.clear()
    o.view.sector = choice.sector
  }
  return choice
}

function shadeFar (found: Placement[]): void {
  const byName = new Map(found.map(p => [p.name, p]))
  for (const p of found) {
    const other = byName.get(counterpart(p.name))
    if (other !== undefined && other !== p && p.depth - other.depth > FAR_DEPTH) p.far = true
  }
}

function snapped (o: SkinnedOptions, at: Vec3, key: string): Snapped {
  const screen = project(o.camera, at)
  return { ...screen, pixel: steadyAnchor(screen, o.anchors, key) }
}

function turned (
  o: SkinnedOptions, name: string, a: Snapped, b: Screen, length: number, rest: number, endOn: number | undefined
): Array<[number, number]> {
  const angle = endOn ?? snapAbout(Math.atan2(b.y - a.y, b.x - a.x), rest, o.angles?.get(name))
  o.angles?.set(name, angle)
  const { cos, sin } = exactTrig(angle)
  return [a.pixel, [a.pixel[0] + cos * Math.max(1, length), a.pixel[1] + sin * Math.max(1, length)]]
}

type Footing = { endOn: number | undefined, drop: number }

function footingOf (
  o: SkinnedOptions, part: Part, length: number | undefined, shown: Shown, choice: ViewChoice | undefined
): Footing {
  const { sprite, unmirrored } = shown
  const none = { endOn: undefined, drop: 0 }
  if (length === undefined || sprite === undefined || !o.feet?.includes(part.name)) return none
  const endOn = choice !== undefined && isEndOnView(choice.view) ? endOnAngle(sprite) : undefined
  return { endOn, drop: sprite.upright === true ? 0 : soleDrop(unmirrored ?? sprite) }
}

function lowered (points: Array<[number, number]> | undefined, drop: number): Array<[number, number]> | undefined {
  return points?.map(([x, y]) => [x, y + drop])
}

type Snapped = Screen & { pixel: [number, number] }

function layOf (
  length: number, a: Snapped, b: Snapped, curve: Vec3[] | undefined, points: Array<[number, number]>
): NonNullable<Placement['lay']> {
  const joint = curve === undefined ? b.pixel : points[points.length - 1]
  return { length, heading: [b.x - a.x, b.y - a.y], joint }
}

function stripPlacements (o: SkinnedOptions): Placement[] {
  const choice = chosenView(o)
  const found: Placement[] = []
  for (const part of o.mannequin.parts) {
    const single = part.a === part.b
    const shown = spriteFor(o, part.name, single, choice)
    const { sprite, span } = shown
    if (sprite === undefined || sprite.hidden === true || sprite.rows === undefined || sprite.pivotA === undefined) {
      continue
    }
    const a = snapped(o, jointOf(o.mannequin, o.pose, part.a), part.a)
    const b = snapped(o, jointOf(o.mannequin, o.pose, part.b), part.b)
    const length = single ? undefined : steadyLength(arcLength(o, part, a, b), o.lengths?.get(part.name))
    if (length !== undefined) o.lengths?.set(part.name, length)
    const curve = single ? undefined : o.curves?.[part.b]
    const { endOn, drop } = footingOf(o, part, length, shown, choice)
    const laid = endOn === undefined ? length : span
    const points = single || laid === undefined
      ? undefined
      : curve === undefined
        ? lowered(turned(o, part.name, a, b, laid, restAngle(o, part, choice), endOn), drop)
        : curve.map((at, k) => snapped(o, at, `${part.b}#${k}`).pixel)
    const level = choice?.mirror === true ? -drop : drop
    found.push({
      name: part.name,
      joints: [part.a, part.b],
      ...(sprite.layer === undefined ? {} : { layer: sprite.layer }),
      rows: sprite.rows,
      pivot: [sprite.pivotA[0], sprite.pivotA[1] + level],
      anchor: a.pixel,
      angle: 0,
      depth: (a.depth + b.depth) / 2,
      ...(points === undefined || laid === undefined
        ? {}
        : { points, lay: layOf(laid, a, b, curve, points) }),
      drawn: span
    })
  }
  if (choice !== undefined) shadeFar(found)
  const ordered = drawOrder(found.map(p => ({ ...p, layer: p.layer ?? 0 })), o.order)
  o.order?.splice(0, o.order.length, ...ordered.map(p => p.name))
  return ordered
}

function placements (o: SkinnedOptions): Placement[] {
  if (o.painter === 'strip') return stripPlacements(o)
  const found: Placement[] = []
  const choice = chosenView(o)
  for (const part of o.mannequin.parts) {
    const a: Screen = project(o.camera, jointOf(o.mannequin, o.pose, part.a))
    const b: Screen = project(o.camera, jointOf(o.mannequin, o.pose, part.b))
    const single = part.a === part.b
    const length = steadyLength(arcLength(o, part, a, b), o.lengths?.get(part.name))
    if (!single) o.lengths?.set(part.name, length)
    const { sprite, unmirrored, span } = spriteFor(o, part.name, single, choice, length)
    if (sprite === undefined || sprite.hidden === true || sprite.rows === undefined || sprite.pivotA === undefined) {
      continue
    }
    const raw = Math.atan2(b.y - a.y, b.x - a.x)
    const kept = o.angles?.get(part.name)
    const rest = single ? 0 : restAngle(o, part, choice)
    const angle = single ? 0 : o.rotation === 'clean' ? cleanStep(raw, kept) : snapAbout(raw, rest, kept)
    if (!single) o.angles?.set(part.name, angle)
    const curve = curveFor(o, part.b, single, sprite)
    found.push({
      name: part.name,
      joints: [part.a, part.b],
      ...(sprite.layer === undefined ? {} : { layer: sprite.layer }),
      ...(unmirrored?.rows === undefined || unmirrored.pivotA === undefined
        ? {}
        : { unmirrored: { rows: unmirrored.rows, pivot: unmirrored.pivotA } }),
      rows: sprite.rows,
      pivot: sprite.pivotA,
      anchor: steadyAnchor(a, o.anchors, part.a),
      angle,
      depth: (a.depth + b.depth) / 2,
      ...curve,
      drawn: span,
      ...(single ? {} : { shown: curve.curve === undefined ? spanOf(sprite) : length })
    })
  }
  if (choice !== undefined) shadeFar(found)
  return found.sort((p, q) => (p.layer ?? 0) - (q.layer ?? 0) || q.depth - p.depth)
}

const FAR_DEPTH = 0.05

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

export function cleanStep (radians: number, previous?: number): number {
  return steadyStep(radians, CLEAN_STEP, previous)
}

function arcLength (o: SkinnedOptions, part: Part, a: Screen, b: Screen): number {
  const curve = o.curves?.[part.b]
  if (curve === undefined || part.a === part.b) return Math.hypot(b.x - a.x, b.y - a.y)
  const points = curve.map(at => project(o.camera, at))
  return points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0)
}

function curveFor (o: SkinnedOptions, joint: string, single: boolean, sprite: SkinPart): Pick<Placement, 'curve'> {
  const curve = o.curves?.[joint]
  if (single || curve === undefined || sprite.pivotA === undefined || sprite.pivotB === undefined) return {}
  const points = curve.map((at, k) => {
    const screen = project(o.camera, at)
    return steadyAnchor(screen, o.anchors, `${joint}#${k}`)
  })
  return { curve: { points, span: spanOf(sprite) } }
}

function steadyAnchor (at: Screen, kept: Map<string, [number, number]> | undefined, joint: string): [number, number] {
  const previous = kept?.get(joint)
  const cell = (v: number, was: number | undefined): number => {
    const near = was !== undefined && v > was - ANCHOR_HYSTERESIS_PX && v < was + 1 + ANCHOR_HYSTERESIS_PX
    return near ? was : Math.floor(v)
  }
  const anchor: [number, number] = [cell(at.x, previous?.[0]), cell(at.y, previous?.[1])]
  kept?.set(joint, anchor)
  return anchor
}

const ANCHOR_HYSTERESIS_PX = 0.25

function steadyLength (pixels: number, previous?: number): number {
  return previous !== undefined && Math.abs(pixels - previous) < LENGTH_HYSTERESIS_PX ? previous : pixels
}

const LENGTH_HYSTERESIS_PX = 1

function steadyStep (radians: number, step: number, previous?: number): number {
  const nearest = Math.round(radians / step) * step
  if (previous === undefined) return nearest
  const off = Math.atan2(Math.sin(radians - previous), Math.cos(radians - previous))
  return Math.abs(off) <= step * (0.5 + HYSTERESIS) ? previous : nearest
}

const ROTATIONS = new Map<string, Rotated>()
const ROTATIONS_KEPT = 4096
const STEPS = Math.round(2 * Math.PI / CLEAN_STEP)

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

function rotated (p: Placement): Rotated {
  const steps = Math.round(p.angle / CLEAN_STEP)
  if (p.unmirrored === undefined) return rotatedBy(p.rows, p.pivot, steps)
  const turned = rotatedBy(p.unmirrored.rows, p.unmirrored.pivot, STEPS / 2 - steps)
  const width = turned.grid[0].length
  return { grid: turned.grid.map(row => [...row].reverse()), pivot: [width - 1 - turned.pivot[0], turned.pivot[1]] }
}

type Ink = { owner: Int16Array, index: number, shade: Map<number, number>, painted: number[], footprints?: number[][] }

function put (img: Image, x: number, y: number, colour: number, p: Placement, ink?: Ink): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return
  setPixel(img, x, y, ink !== undefined && p.far === true ? ink.shade.get(colour) ?? colour : colour)
  if (ink === undefined) return
  ink.owner[y * img.width + x] = ink.index
  ink.painted[ink.index]++
  ink.footprints?.[ink.index].push(y * img.width + x)
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

function paintCurve (
  img: Image, p: Placement, points: Array<[number, number]>, span: number, colours: Map<string, number>, ink?: Ink
): void {
  const lines = p.rows.map(row => [...row])
  const w = lines[0].length
  const h = lines.length
  const segments = points.slice(1).map((end, i) => {
    const start = points[i]
    const length = Math.hypot(end[0] - start[0], end[1] - start[1])
    return { start, length, u: length === 0 ? [1, 0] : [(end[0] - start[0]) / length, (end[1] - start[1]) / length] }
  }).filter(segment => segment.length > 0)
  if (segments.length === 0) return
  const total = segments.reduce((sum, segment) => sum + segment.length, 0)
  const reach = Math.ceil(Math.hypot(w, h))
  const xs = points.map(point => point[0])
  const ys = points.map(point => point[1])
  for (let y = Math.min(...ys) - reach; y <= Math.max(...ys) + reach; y++) {
    for (let x = Math.min(...xs) - reach; x <= Math.max(...xs) + reach; x++) {
      let best = Infinity
      let along = 0
      let across = 0
      let before = 0
      segments.forEach((segment, i) => {
        const dx = x - segment.start[0]
        const dy = y - segment.start[1]
        const raw = dx * segment.u[0] + dy * segment.u[1]
        const lowest = i === 0 ? -Infinity : 0
        const highest = i === segments.length - 1 ? Infinity : segment.length
        const t = Math.max(lowest, Math.min(highest, raw))
        const off = -dx * segment.u[1] + dy * segment.u[0]
        const gap = Math.hypot(raw - t, off)
        if (gap < best) {
          best = gap
          along = before + t
          across = off
        }
        before += segment.length
      })
      const column = along < 0
        ? p.pivot[0] + along
        : along > total ? p.pivot[0] + span + along - total : p.pivot[0] + along * span / total
      const sx = Math.floor(column + 0.5)
      const sy = Math.floor(p.pivot[1] + 0.5 + across)
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue
      const colour = colours.get(lines[sy][sx])
      if (colour === undefined) continue
      if (ink === undefined) setPixel(img, x, y, colour)
      else put(img, x, y, colour, p, ink)
    }
  }
}

function paintAlong (img: Image, p: Placement, colours: Map<string, number>, ink?: Ink): number {
  const sprite = { rows: p.rows, pivotA: p.pivot, pivotB: [p.pivot[0] + p.drawn, p.pivot[1]] as [number, number] }
  return paintStrip(sprite, p.points ?? [], (x, y, cell) => {
    const colour = colours.get(cell)
    if (colour !== undefined) put(img, x, y, colour, p, ink)
  }, p.lay)
}

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

export type DrawnPart = {
  name: string, drawn: number, shown?: number, missed?: number, painted: number, footprint?: number[]
}
export type Layers = { image: Image, owner?: Int16Array, parts: DrawnPart[], sector?: number }

function missedBy ({ points, lay, shown, joints }: Placement, placed: Placement[]): Pick<DrawnPart, 'missed'> {
  if (points === undefined || lay === undefined || shown === undefined) return {}
  const shares = (other: Placement): boolean => {
    return other.joints[0] !== other.joints[1] && other.joints[0] !== joints[0] && other.joints.includes(joints[1])
  }
  if (!placed.some(shares)) return {}
  const end = endOf(points, shown, lay.heading)
  return { missed: Math.hypot(end[0] - lay.joint[0], end[1] - lay.joint[1]) }
}

export function renderSkinned (options: SkinnedOptions): Image {
  return renderSkinnedLayers(options).image
}

export function renderSkinnedLayers (options: SkinnedOptions): Layers {
  const img = createImage(options.camera.width, options.camera.height)
  const colours = new Map(Object.entries(options.skin.palette).map(([key, hex]) => [key, parseHex(hex)]))
  const placed = placements(options)
  const ink: Ink | undefined = options.skin.views === undefined
    ? undefined
    : {
        owner: new Int16Array(img.width * img.height).fill(-1),
        index: 0,
        shade: darkerShades(colours),
        painted: placed.map(() => 0),
        ...(options.footprints === true ? { footprints: placed.map(() => []) } : {})
      }
  placed.forEach((p, index) => {
    if (ink !== undefined) ink.index = index
    if (p.points !== undefined) p.shown = paintAlong(img, p, colours, ink)
    else if (p.curve !== undefined) paintCurve(img, p, p.curve.points, p.curve.span, colours, ink)
    else if (options.rotation === 'clean' && p.angle !== 0) paintClean(img, p, colours, ink)
    else paint(img, p, colours, ink)
  })
  if (ink !== undefined) innerLines(img, placed, ink)
  drawOutline(img, [...colours.values()].reduce((a, b) => luminance(b) < luminance(a) ? b : a))
  const parts = placed.map(({ name, drawn, shown }, i): DrawnPart => {
    const footprint = ink?.footprints?.[i]
    const missed = options.footprints === true ? missedBy(placed[i], placed) : {}
    const lengths = { drawn, ...(shown === undefined ? {} : { shown }), ...missed }
    return { name, ...lengths, painted: ink?.painted[i] ?? 0, ...(footprint === undefined ? {} : { footprint }) }
  })
  const sector = options.view?.sector
  const owned = ink === undefined ? {} : { owner: ink.owner }
  return { image: img, ...owned, parts, ...(sector === undefined ? {} : { sector }) }
}
