import { createImage, getPixel, neighbours4, parseHex, setPixel, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import type { Mannequin } from '../formats/mannequin.ts'
import type { Style } from '../formats/style.ts'
import { dot, normalize } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { project } from '../raster/camera.ts'
import type { Camera } from '../raster/camera.ts'
import { EMPTY } from '../raster/gbuffer.ts'
import type { GBuffer } from '../raster/gbuffer.ts'

const MAX_STRAY_PASSES = 5

export type StylizeResult = { image: Image, decalMask: Uint8Array }

export function stylize (g: GBuffer, m: Mannequin, cam: Camera, style: Style): StylizeResult {
  const shaded = createImage(g.width, g.height)
  shade(shaded, g, m, style)
  drawInnerLines(shaded, g, m, style)
  const image = removeStrays(shaded, g, m)
  const decalMask = drawDecals(image, g, m, cam, style)
  drawOutline(image, parseHex(style.outline))
  return { image, decalMask }
}

function rampOf (g: GBuffer, m: Mannequin, style: Style, i: number): string[] {
  return style.materials[m.parts[g.part[i]].material]
}

function shade (image: Image, g: GBuffer, m: Mannequin, style: Style): void {
  const light = normalize(style.light)
  for (let i = 0; i < g.part.length; i++) {
    if (g.part[i] === EMPTY) continue
    const n: Vec3 = [g.normal[i * 3], g.normal[i * 3 + 1], g.normal[i * 3 + 2]]
    const brightness = dot(n, light)
    const shadeIndex = style.bands.filter(t => brightness >= t).length
    const ramp = rampOf(g, m, style, i)
    const colour = m.parts[g.part[i]].allowThin === true ? ramp[Math.floor(ramp.length / 2)] : ramp[shadeIndex]
    setPixel(image, i % g.width, Math.floor(i / g.width), parseHex(colour))
  }
}

function drawInnerLines (image: Image, g: GBuffer, m: Mannequin, style: Style): void {
  const marks: number[] = []
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const i = y * g.width + x
      if (g.part[i] === EMPTY) continue
      const right = x + 1 < g.width ? i + 1 : -1
      const below = y + 1 < g.height ? i + g.width : -1
      for (const j of [right, below]) {
        if (j === -1 || g.part[j] === EMPTY || g.part[j] === g.part[i]) continue
        if (Math.abs(g.depth[i] - g.depth[j]) <= style.innerLineDepth) continue
        marks.push(g.depth[i] > g.depth[j] ? i : j)
      }
    }
  }
  for (const i of marks) {
    setPixel(image, i % g.width, Math.floor(i / g.width), parseHex(rampOf(g, m, style, i)[0]))
  }
}

function mostCommon (values: number[]): number {
  const counts = new Map<number, number>()
  let best = values[0]
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1
    counts.set(v, n)
    if (n > (counts.get(best) ?? 0)) best = v
  }
  return best
}

function removeStrays (image: Image, g: GBuffer, m: Mannequin): Image {
  const out: Image = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) }
  for (let pass = 0; pass < MAX_STRAY_PASSES; pass++) {
    if (!strayPass(out, g, m)) break
  }
  return out
}

function strayPass (image: Image, g: GBuffer, m: Mannequin): boolean {
  let changed = false
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const part = g.part[y * g.width + x]
      if (part === EMPTY) continue
      const c = getPixel(image, x, y)
      const same: number[] = []
      const other: number[] = []
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= g.width || ny >= g.height) continue
          const neighbour = g.part[ny * g.width + nx]
          if (neighbour === EMPTY) continue
          const list = neighbour === part ? same : other
          list.push(getPixel(image, nx, ny))
        }
      }
      if (same.length === 0 && m.parts[part].allowThin === true) continue
      const around = same.length > 0 ? same : other
      if (around.length === 0 || around.includes(c)) continue
      setPixel(image, x, y, mostCommon(around))
      changed = true
    }
  }
  return changed
}

function drawDecals (image: Image, g: GBuffer, m: Mannequin, cam: Camera, style: Style): Uint8Array {
  const mask = new Uint8Array(g.width * g.height)
  const pixelDepth = 1 / cam.pixelsPerUnit
  for (const decal of m.decals) {
    if (-dot(normalize(decal.normal), cam.forward) < style.decalMinFacing) continue
    const p = project(cam, m.joints[decal.anchor])
    const cx = Math.floor(p.x)
    const cy = Math.floor(p.y)
    if (cx < 0 || cy < 0 || cx >= g.width || cy >= g.height) continue
    const centre = cy * g.width + cx
    if (g.part[centre] === EMPTY || g.depth[centre] < p.depth - pixelDepth) continue
    const ox = cx - Math.floor(decal.pattern[0].length / 2)
    const oy = cy - Math.floor(decal.pattern.length / 2)
    decal.pattern.forEach((row, dy) => {
      [...row].forEach((ch, dx) => {
        const x = ox + dx
        const y = oy + dy
        if (ch === '.' || x < 0 || y < 0 || x >= g.width || y >= g.height) return
        if (g.part[y * g.width + x] === EMPTY) return
        setPixel(image, x, y, parseHex(style.decalColors[ch]))
        mask[y * g.width + x] = 1
      })
    })
  }
  return mask
}

function drawOutline (image: Image, colour: number): void {
  const edge: Array<[number, number]> = []
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (getPixel(image, x, y) !== TRANSPARENT) continue
      if (neighbours4(image, x, y).some(n => n !== TRANSPARENT)) edge.push([x, y])
    }
  }
  for (const [x, y] of edge) setPixel(image, x, y, colour)
}
