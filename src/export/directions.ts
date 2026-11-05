import type { ViewName } from '../formats/skin.ts'
import { pageCamera } from '../page/sprite.ts'
import { chooseView, facingAngle } from '../style/views.ts'
import type { ViewChoice } from '../style/views.ts'

export const SPRITE_PER_METRE = 27
export const DIRECTIONS = [
  'front', 'front-right', 'right', 'back-right', 'back', 'back-left', 'left', 'front-left'
] as const
export type Direction = typeof DIRECTIONS[number]

const QUARTER = Math.PI / 4

export function yawOf (direction: Direction): number {
  return DIRECTIONS.indexOf(direction) * QUARTER
}

function chosenView (direction: Direction): ViewChoice {
  return chooseView(facingAngle(pageCamera(SPRITE_PER_METRE), yawOf(direction)))
}

export function expectedSector (direction: Direction): number {
  return chosenView(direction).sector
}

export function viewOf (direction: Direction): ViewName {
  return chosenView(direction).view
}

export function isMirrored (direction: Direction): boolean {
  return chosenView(direction).mirror
}
