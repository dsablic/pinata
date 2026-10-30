import { validateMannequin } from '../formats/mannequin.ts'
import type { Mannequin } from '../formats/mannequin.ts'
import { checkRig, resolveRig, validateRig } from '../formats/rig.ts'
import { checkRenderMaterials, checkScenario, validateScenario, validateSimMaterials } from '../formats/sim.ts'
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
  cast: Array<{ name: string, mannequin: unknown, style: unknown, rig: unknown, materials?: unknown, motion?: unknown }>
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
    const cloth = readCloth(member, mannequin.value, Object.keys(style.value.materials), errors, at)
    const dressed = cloth === undefined ? {} : { cloth }
    cast.push({ name: member.name, mannequin: mannequin.value, rig: resolved, ...dressed })
    const drape = cloth === undefined ? {} : { cloth: cloth.scenario }
    looks.push({ mannequin: mannequin.value, style: style.value, ...drape })
  })
  if (errors.length > 0 || config.value === undefined) return { errors }
  return { value: { config: config.value, cast, looks }, errors }
}

/**
 * The member's cape and chains from its motion file and materials, or undefined when it has none; the motion's script
 * is not used (the world plans its own walking).
 */
function readCloth (
  member: Record<string, unknown>,
  mannequin: Mannequin,
  styleMaterials: string[],
  errors: ValidationError[],
  at: (file: string, e: ValidationError) => ValidationError
): CastMember['cloth'] {
  if (member.motion === undefined || member.materials === undefined || !isRecord(member.motion)) return undefined
  const { exclude, ...motion } = member.motion
  const scenario = validateScenario({
    chains: [], ...motion, name: String(member.name), body: 'bundle', bodyExcludeParts: exclude ?? []
  })
  const materials = validateSimMaterials(member.materials)
  errors.push(...scenario.errors.map(e => at('motion', e)), ...materials.errors.map(e => at('materials', e)))
  if (scenario.value === undefined || materials.value === undefined) return undefined
  if (scenario.value.cape === undefined && scenario.value.chains.length === 0) return undefined
  const cross = [
    ...checkScenario(scenario.value, mannequin, materials.value),
    ...checkRenderMaterials(scenario.value, styleMaterials)
  ]
  errors.push(...cross.map(e => at('motion', e)))
  return cross.length > 0 ? undefined : { scenario: scenario.value, materials: materials.value }
}
