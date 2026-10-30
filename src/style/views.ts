import type { ViewName } from '../formats/skin.ts'
import type { SkinPart } from '../formats/skin.ts'
import { dot } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import type { Camera } from '../raster/camera.ts'

/** Which drawn view shows a direction, and whether it is mirrored (the character faces screen-left). */
export type ViewChoice = { view: ViewName, mirror: boolean, sector: number }

const SECTOR = Math.PI / 4
/** How far past the edge between two sectors the facing must turn before the view changes. */
const HYSTERESIS = 10 * Math.PI / 180
const BY_SECTOR: ViewName[] = ['front', 'frontSide', 'side', 'backSide', 'back']

/**
 * The character's facing seen from the camera, radians: 0 faces the viewer, +pi/2 faces screen-right, +-pi faces
 * away. Yaw is the character's, forward (sin yaw, 0, cos yaw) as the world uses.
 */
export function facingAngle (camera: Camera, yaw: number): number {
  const forward: Vec3 = [Math.sin(yaw), 0, Math.cos(yaw)]
  // measured across the ground, so the camera's tilt does not move the sectors' edges
  const toCamera: Vec3 = [-camera.forward[0], 0, -camera.forward[2]]
  return Math.atan2(dot(forward, camera.right), dot(forward, toCamera))
}

/**
 * The view for a facing, in eight 45-degree sectors (-4 and 4 are both the back); with the previous sector, the view
 * changes only once the facing is well past the edge between the two, so a character turning slowly does not flicker
 * between views.
 */
export function chooseView (facing: number, previous?: number): ViewChoice {
  let sector = Math.round(facing / SECTOR)
  if (previous !== undefined) {
    const off = Math.atan2(Math.sin(facing - previous * SECTOR), Math.cos(facing - previous * SECTOR))
    if (Math.abs(off) <= SECTOR / 2 + HYSTERESIS) sector = previous
  }
  if (sector === -4) sector = 4
  return { view: BY_SECTOR[Math.abs(sector)], mirror: sector < 0, sector }
}

/** The part on the other side: a name ending in L or R, or containing Left or Right, swapped; others unchanged. */
export function counterpart (name: string): string {
  if (/Left/.test(name)) return name.replace('Left', 'Right')
  if (/Right/.test(name)) return name.replace('Right', 'Left')
  if (name.endsWith('L')) return `${name.slice(0, -1)}R`
  if (name.endsWith('R')) return `${name.slice(0, -1)}L`
  return name
}

/**
 * A sprite as it looks mirrored left for right: a two-joint sprite, drawn along its bone, flips top for bottom (the
 * bone's direction is set by the joints); an upright one flips left for right.
 */
export function mirrored (sprite: SkinPart, twoJoint: boolean): SkinPart {
  if (sprite.rows === undefined || sprite.pivotA === undefined) return sprite
  const rows = sprite.rows
  const height = rows.length
  const width = [...rows[0]].length
  if (twoJoint) {
    const flip = (p: [number, number]): [number, number] => [p[0], height - 1 - p[1]]
    return {
      ...sprite,
      rows: [...rows].reverse(),
      pivotA: flip(sprite.pivotA),
      ...(sprite.pivotB === undefined ? {} : { pivotB: flip(sprite.pivotB) })
    }
  }
  return {
    ...sprite,
    rows: rows.map(row => [...row].reverse().join('')),
    pivotA: [width - 1 - sprite.pivotA[0], sprite.pivotA[1]]
  }
}

/**
 * A two-joint sprite fitted to a bone of a given on-screen length: the end caps past each pivot are kept, and the
 * columns between the pivots are resampled (repeated or dropped evenly) so the pivots end that length apart. Within
 * a pixel of the drawn length the sprite is returned as it is.
 */
export function fitted (sprite: SkinPart, length: number): SkinPart {
  const { rows, pivotA, pivotB } = sprite
  if (rows === undefined || pivotA === undefined || pivotB === undefined) return sprite
  const drawn = pivotB[0] - pivotA[0]
  const target = Math.max(1, Math.round(length))
  if (Math.abs(length - drawn) < 1 || drawn < 1) return sprite
  const fit = rows.map(row => {
    const cells = [...row]
    const before = cells.slice(0, pivotA[0])
    const after = cells.slice(pivotB[0])
    const middle = Array.from({ length: target }, (_, i) => cells[pivotA[0] + Math.floor(i * drawn / target)])
    return [...before, ...middle, ...after].join('')
  })
  return { ...sprite, rows: fit, pivotB: [pivotA[0] + target, pivotB[1]] }
}
