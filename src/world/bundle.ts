import { validateMannequin } from '../formats/mannequin.ts'
import type { Mannequin } from '../formats/mannequin.ts'
import { checkRig, resolveRig, validateRig } from '../formats/rig.ts'
import { checkRenderMaterials, checkScenario, validateScenario, validateSimMaterials } from '../formats/sim.ts'
import { validateStyle } from '../formats/style.ts'
import { checkSkin, validateSkin } from '../formats/skin.ts'
import { isRecord } from '../formats/validate.ts'
import type { ValidationError } from '../formats/validate.ts'
import type { Look } from './render.ts'
import { validateWorldConfig } from './config.ts'
import type { Dress, WorldConfig } from './config.ts'
import type { Scenario } from '../formats/sim.ts'
import type { CastMember } from './world.ts'
import { captureFor, readClips } from '../mocap/capture.ts'
import type { CaptureData } from '../mocap/capture.ts'

/** A world in one file for the browser: its config and every cast member's mannequin, style and rig as written. */
export type WorldBundle = {
  config: unknown
  cast: Array<{
    name: string
    mannequin: unknown
    style: unknown
    rig: unknown
    materials?: unknown
    motion?: unknown
    skin?: unknown
  }>
  /** Motion capture for the cast members it names. */
  capture?: CaptureData
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
  const capture = readCapture(input.capture, errors)
  const clips = capture === undefined ? [] : readClips(capture.clips, errors, 'capture.clips')
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
    const read = readCloth(member, mannequin.value, Object.keys(style.value.materials), errors, at)
    const dress = config.value?.dress[member.name]
    const cloth = read === undefined || dress === undefined
      ? read
      : { ...read, scenario: dressed(read.scenario, dress) }
    if (cloth !== undefined) {
      const known = Object.keys(style.value.materials)
      const wrong = checkRenderMaterials(cloth.scenario, known)
      errors.push(...wrong.map(e => ({ ...e, path: `config.dress.${member.name}` })))
    }
    const hidden = new Set(dress?.hide ?? [])
    const missing = [...hidden].filter(name => !mannequin.value!.parts.some(part => part.name === name))
    for (const name of missing) {
      errors.push({ path: `config.dress.${member.name}.hide`, message: `'${name}' is not a part of ${member.name}` })
    }
    const look = { ...mannequin.value, parts: mannequin.value.parts.filter(part => !hidden.has(part.name)) }
    const clothed = cloth === undefined ? {} : { cloth }
    const own = capture !== undefined && Object.hasOwn(capture.members, member.name)
      ? capture.members[member.name]
      : undefined
    const database = own === undefined
      ? undefined
      : captureFor({ rig: resolved, mannequin: look }, clips, capture?.base, own, errors,
        `capture.members.${member.name}`)
    const captured = database === undefined ? {} : { capture: database }
    cast.push({ name: member.name, mannequin: look, rig: resolved, ...clothed, ...captured })
    const drape = cloth === undefined ? {} : { cloth: cloth.scenario }
    const skin = member.skin === undefined ? undefined : validateSkin(member.skin)
    errors.push(...(skin?.errors ?? []).map(e => at('skin', e)))
    if (skin?.value !== undefined) errors.push(...checkSkin(skin.value, mannequin.value).map(e => at('skin', e)))
    const skinned = skin?.value === undefined ? {} : { skin: { skin: skin.value, mannequin: mannequin.value } }
    looks.push({ mannequin: look, style: style.value, ...drape, ...skinned })
  })
  const named = new Set(input.cast.map(member => isRecord(member) ? member.name : undefined))
  for (const name of Object.keys(capture?.members ?? {})) {
    if (!named.has(name)) errors.push({ path: `capture.members.${name}`, message: 'not a member of the cast' })
  }
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

/** The scenario with the world's dress: how its cape and chains are drawn. */
function dressed (scenario: Scenario, dress: Dress): Scenario {
  return {
    ...scenario,
    ...(scenario.cape === undefined || dress.cape === undefined
      ? {}
      : { cape: { ...scenario.cape, render: dress.cape } }),
    chains: scenario.chains.map((chain, i) => {
      const render = dress.chains?.[String(i)]
      return render === undefined ? chain : { ...chain, render }
    })
  }
}

/** The bundle's motion capture, when it has any: clips, the shared retargeting and each member's, each checked. */
function readCapture (input: unknown, errors: ValidationError[]): CaptureData | undefined {
  if (input === undefined) return undefined
  if (!isRecord(input)) {
    errors.push({ path: 'capture', message: 'expected { clips, base, members }' })
    return undefined
  }
  const clips = Array.isArray(input.clips) ? input.clips : undefined
  if (clips === undefined) errors.push({ path: 'capture.clips', message: 'expected an array of motion clips' })
  if (!isRecord(input.base)) errors.push({ path: 'capture.base', message: 'expected the shared retargeting' })
  if (!isRecord(input.members)) {
    errors.push({ path: 'capture.members', message: 'expected each member\'s retargeting, by name' })
  }
  if (clips === undefined || !isRecord(input.base) || !isRecord(input.members)) return undefined
  return { clips, base: input.base, members: input.members }
}
