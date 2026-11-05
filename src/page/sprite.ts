import type { Vec3 } from '../math/vec.ts'
import type { Pose } from '../motion/pose.ts'
import { makeCamera } from '../raster/camera.ts'
import type { Camera } from '../raster/camera.ts'
import { renderSkinnedLayers } from '../style/skins.ts'
import type { DrawnPart } from '../style/skins.ts'
import type { Look } from '../world/render.ts'
import type { Image } from '../image.ts'

export type Sprite = { image: Image, camera: Camera, owner?: Int16Array, parts?: DrawnPart[], sector?: number }
export type Skinned = Look & { skin: NonNullable<Look['skin']> }
export type Painting = {
  view: { sector?: number }
  angles: Map<string, number>
  lengths: Map<string, number>
  order: string[]
  anchors: Map<string, [number, number]>
}
export type Placed = { joints: Pose, curves: Record<string, Vec3[]>, anchor: Vec3, yaw: number }
export type PaintOptions = { painter?: 'strip' | 'rotate', footprints?: boolean, feet?: readonly string[] }

const CAMERA_ELEVATION_DEGREES = 8
const SPRITE_BOX_IN_CHARACTER_HEIGHTS = 1.6
const FEET_LINE_SHARE_OF_BOX = 0.85

export function spriteReach (pixelsPerMetre: number): number {
  return SPRITE_BOX_IN_CHARACTER_HEIGHTS * 2 * pixelsPerMetre
}

export function pageCamera (spritePerMetre: number): Camera {
  return makeCamera({
    azimuthDeg: 0, elevationDeg: CAMERA_ELEVATION_DEGREES, targetHeightPx: spritePerMetre, modelHeight: 1, margin: 0
  })
}

export function freshPainting (): Painting {
  return { view: {}, angles: new Map(), lengths: new Map(), order: [], anchors: new Map() }
}

export function clonePainting (painting: Painting): Painting {
  return {
    view: { ...painting.view },
    angles: new Map(painting.angles),
    lengths: new Map(painting.lengths),
    order: [...painting.order],
    anchors: new Map([...painting.anchors].map(([name, [x, y]]): [string, [number, number]] => [name, [x, y]]))
  }
}

export function spriteBox (look: Skinned, spritePerMetre: number): Camera {
  const height = Math.max(...Object.values(look.skin.mannequin.joints).map(p => p[1]))
  const size = Math.ceil(SPRITE_BOX_IN_CHARACTER_HEIGHTS * height * spritePerMetre)
  const baseline = Math.round(size * FEET_LINE_SHARE_OF_BOX)
  return { ...pageCamera(spritePerMetre), width: size, height: size, baseline }
}

export function paintSprite (
  look: Skinned, painting: Painting, box: Camera, placed: Placed, options: PaintOptions = {}
): Sprite {
  const { mannequin, skin } = look.skin
  const [x, y, z] = placed.anchor
  const pose: Pose = {}
  for (const [name, p] of Object.entries(placed.joints)) pose[name] = [p[0] - x, p[1] - y, p[2] - z]
  const curves = Object.fromEntries(Object.entries(placed.curves)
    .map(([joint, points]) => [joint, points.map((p): Vec3 => [p[0] - x, p[1] - y, p[2] - z])]))
  const { angles, lengths, anchors, order } = painting
  const painted = options.painter === 'rotate'
    ? { angles, lengths, anchors }
    : { painter: 'strip' as const, order, angles, lengths, anchors }
  const { image, owner, parts, sector } = renderSkinnedLayers({
    mannequin, pose: { ...mannequin.joints, ...pose }, skin, camera: box, yaw: placed.yaw, view: painting.view,
    ...painted, curves, footprints: options.footprints === true,
    ...(options.feet === undefined ? {} : { feet: options.feet })
  })
  const layers = { parts, ...(owner === undefined ? {} : { owner }), ...(sector === undefined ? {} : { sector }) }
  return { image, camera: box, ...layers }
}
