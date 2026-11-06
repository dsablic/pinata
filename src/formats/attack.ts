import { ATTACKS } from '../mocap/clip.ts'
import type { AttackKind } from '../mocap/clip.ts'
import type { Mannequin } from './mannequin.ts'
import { armsOf } from './rig.ts'
import type { Rig } from './rig.ts'
import type { ValidationError } from './validate.ts'

export type Attack = { attack: AttackKind, reason: string }

const STAFF = /staff|wand|rod|sceptre|scepter/i

export function isAttack (value: unknown): value is AttackKind {
  return typeof value === 'string' && ATTACKS.some(kind => kind === value)
}

export function attackErrors (value: unknown, path = 'attack'): ValidationError[] {
  if (value === undefined || isAttack(value)) return []
  return [{ path, message: `expected one of ${ATTACKS.join(', ')}; leave it out for the default from what the ` +
    'character carries (a weapon part swings, a staff casts, empty hands punch)' }]
}

function carriedParts (rig: Rig, mannequin: Mannequin): string[] {
  const carried = new Set(armsOf(rig).flatMap(arm => arm.carried ?? []))
  return mannequin.parts.filter(part => carried.has(part.a) || carried.has(part.b)).map(part => part.name)
}

export function attackOf (rig: Rig, mannequin: Mannequin, named?: AttackKind): Attack {
  if (named !== undefined) return { attack: named, reason: 'named in character.json' }
  const parts = carriedParts(rig, mannequin)
  const staff = parts.find(name => STAFF.test(name))
  if (staff !== undefined) return { attack: 'cast', reason: `the default: it carries a staff ('${staff}')` }
  if (parts.length > 0) {
    return { attack: 'swing', reason: `the default: it carries a weapon (${parts.map(p => `'${p}'`).join(', ')})` }
  }
  return { attack: 'punch', reason: 'the default: its hands carry nothing' }
}
