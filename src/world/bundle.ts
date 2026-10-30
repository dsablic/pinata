import { validateMannequin } from '../formats/mannequin.ts'
import { checkRig, resolveRig, validateRig } from '../formats/rig.ts'
import { validateStyle } from '../formats/style.ts'
import { isRecord } from '../formats/validate.ts'
import type { ValidationError } from '../formats/validate.ts'
import type { Look } from './render.ts'
import { validateWorldConfig } from './config.ts'
import type { WorldConfig } from './config.ts'
import type { CastMember } from './world.ts'

/** A world in one file for the browser: its config and every cast member's mannequin, style and rig as written. */
export type WorldBundle = {
  config: unknown
  cast: Array<{ name: string, mannequin: unknown, style: unknown, rig: unknown }>
}
export type ReadWorld = { config: WorldConfig, cast: CastMember[], looks: Look[] }

/** Validates a world bundle the way loading the packages does; errors name the member and file they are in. */
export function readWorldBundle (input: unknown): { value?: ReadWorld, errors: ValidationError[] } {
  if (!isRecord(input) || !Array.isArray(input.cast)) {
    return { errors: [{ path: '', message: 'expected { config, cast }' }] }
  }
  const config = validateWorldConfig(input.config)
  const errors: ValidationError[] = config.errors.map(e => ({ ...e, path: `config.${e.path}` }))
  const cast: CastMember[] = []
  const looks: Look[] = []
  input.cast.forEach((member: unknown, i) => {
    const at = (file: string, e: ValidationError): ValidationError => ({ ...e, path: `cast[${i}].${file}.${e.path}` })
    if (!isRecord(member) || typeof member.name !== 'string') {
      errors.push({ path: `cast[${i}]`, message: 'expected { name, mannequin, style, rig }' })
      return
    }
    const mannequin = validateMannequin(member.mannequin)
    const style = validateStyle(member.style)
    const rig = validateRig(member.rig)
    errors.push(...mannequin.errors.map(e => at('mannequin', e)), ...style.errors.map(e => at('style', e)),
      ...rig.errors.map(e => at('rig', e)))
    if (mannequin.value === undefined || style.value === undefined || rig.value === undefined) return
    const resolved = resolveRig(rig.value, mannequin.value)
    errors.push(...checkRig(resolved, mannequin.value).map(e => at('rig', e)))
    cast.push({ name: member.name, mannequin: mannequin.value, rig: resolved })
    looks.push({ mannequin: mannequin.value, style: style.value })
  })
  if (errors.length > 0 || config.value === undefined) return { errors }
  return { value: { config: config.value, cast, looks }, errors }
}
