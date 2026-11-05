import type { Mannequin } from '../formats/mannequin.ts'
import { legsOf } from '../formats/rig.ts'
import type { Leg, Rig } from '../formats/rig.ts'
import type { SkinPart, ViewName } from '../formats/skin.ts'
import { TRANSPARENT_CHAR } from '../formats/skin.ts'

const END_ON_VIEWS: ViewName[] = ['front', 'back']

export function legFootParts (mannequin: Mannequin, leg: Leg): string[] {
  return mannequin.parts.filter(part => {
    return part.shape === 'capsule' && part.a === leg.ankle && part.b === leg.toe
  }).map(part => part.name)
}

export function footNames (mannequin: Mannequin, rig: Rig): string[] {
  return legsOf(rig).flatMap(leg => legFootParts(mannequin, leg))
}

export function isEndOnView (view: ViewName): boolean {
  return END_ON_VIEWS.includes(view)
}

export function endOnAngle (sprite: SkinPart): number {
  return sprite.upright === true ? Math.PI / 2 : 0
}

export function soleDrop (authored: SkinPart): number {
  const rows = authored.rows ?? []
  const last = rows.reduce((found, row, y) => [...row].some(c => c !== TRANSPARENT_CHAR) ? y : found, 0)
  return last - (authored.pivotA?.[1] ?? 0)
}
