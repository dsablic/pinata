import type { Mannequin } from '../formats/mannequin.ts'
import type { Skin, SkinPart, ViewName } from '../formats/skin.ts'
import { VIEWS } from '../formats/skin.ts'
import type { RootState } from '../motion/script.ts'
import { restPose } from '../motion/pose.ts'
import { project } from '../raster/camera.ts'
import type { Camera } from '../raster/camera.ts'
import { toWorld } from '../sim/body.ts'
import { lengthBounds } from './strip.ts'
import { counterpart, spanOf } from './views.ts'

export type FitFlag = {
  part: string
  view: ViewName
  mirror: boolean
  span: number
  floor: number
  ceiling: number
  projectedLeast: number
  projectedMost: number
}

export type FitOptions = { mannequin: Mannequin, skin: Skin, camera: Camera, offsetsDeg?: number[], slack?: number }

const SECTOR_DEGREES = 45
const SECTORS: Record<ViewName, number[]> = {
  front: [0], frontSide: [1, -1], side: [2, -2], backSide: [3, -3], back: [4]
}

function yawFacing (camera: Camera, facing: number): number {
  const toCamera = [-camera.forward[0], -camera.forward[2]]
  const tilt = Math.hypot(toCamera[0], toCamera[1])
  return Math.atan2(tilt * Math.sin(facing), Math.cos(facing)) + Math.atan2(toCamera[0], toCamera[1])
}

function spriteIn (skin: Skin, view: ViewName, name: string, mirror: boolean): SkinPart | undefined {
  const parts = skin.views![view].parts
  return parts[mirror ? counterpart(name) : name] ?? parts[name]
}

function boneLength (o: FitOptions, a: string, b: string, yaw: number): number {
  const rest = restPose(o.mannequin)
  const root: RootState = { position: [0, 0, 0], yaw, velocity: [0, 0, 0], angularVelocity: 0 }
  const from = project(o.camera, toWorld(rest[a], root))
  const to = project(o.camera, toWorld(rest[b], root))
  return Math.hypot(to.x - from.x, to.y - from.y)
}

export function fitFlags (o: FitOptions): FitFlag[] {
  if (o.skin.views === undefined) return []
  const slack = o.slack ?? 1
  const offsets = o.offsetsDeg ?? [0]
  const flags: FitFlag[] = []
  for (const view of VIEWS) {
    for (const sector of SECTORS[view]) {
      const mirror = sector < 0
      for (const part of o.mannequin.parts) {
        const sprite = part.a === part.b ? undefined : spriteIn(o.skin, view, part.name, mirror)
        if (sprite === undefined || sprite.hidden === true || sprite.rows === undefined) continue
        const span = spanOf(sprite)
        const { floor, ceiling } = lengthBounds(span)
        const lengths = offsets.map(offset => {
          const facing = (sector * SECTOR_DEGREES + offset) * Math.PI / 180
          return boneLength(o, part.a, part.b, yawFacing(o.camera, facing))
        })
        const projectedLeast = Math.min(...lengths)
        const projectedMost = Math.max(...lengths)
        if (projectedLeast >= floor - slack && projectedMost <= ceiling + slack) continue
        flags.push({ part: part.name, view, mirror, span, floor, ceiling, projectedLeast, projectedMost })
      }
    }
  }
  return flags
}

export function formatFlag (flag: FitFlag): string {
  const shown = flag.projectedLeast === flag.projectedMost
    ? flag.projectedLeast.toFixed(1)
    : `${flag.projectedLeast.toFixed(1)}-${flag.projectedMost.toFixed(1)}`
  return `${flag.part} ${flag.view}${flag.mirror ? ' (mirrored)' : ''}: sprite span ${flag.span} ` +
    `(drawn ${flag.floor} to ${flag.ceiling.toFixed(2)}), bone projects ${shown} px`
}
