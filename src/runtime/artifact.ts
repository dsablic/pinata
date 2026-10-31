import type { Mannequin } from '../formats/mannequin.ts'
import { validateMannequin } from '../formats/mannequin.ts'
import { checkReferences } from '../formats/references.ts'
import { checkRig, resolveRig, validateRig } from '../formats/rig.ts'
import type { Rig } from '../formats/rig.ts'
import type { Style } from '../formats/style.ts'
import { validateStyle } from '../formats/style.ts'
import { isRecord } from '../formats/validate.ts'
import type { ValidationError } from '../formats/validate.ts'
import { validateBehaviours } from './behaviours.ts'
import type { Behaviours } from './behaviours.ts'

export type Artifact = {
  format: 'pinata-live'
  version: 1
  name: string
  description?: string
  mannequin: unknown
  style: unknown
  rig: unknown
  behaviours: unknown
}
export type LiveCharacter = {
  name: string
  mannequin: Mannequin
  style: Style
  rig: Rig
  behaviours: Behaviours
}

function tagged (file: string, errors: ValidationError[]): ValidationError[] {
  return errors.map(e => ({ path: `${file}${e.path === '' ? '' : `.${e.path}`}`, message: e.message }))
}

export function readArtifact (input: unknown): { value?: LiveCharacter, errors: ValidationError[] } {
  if (!isRecord(input) || input.format !== 'pinata-live' || input.version !== 1) {
    const message = "expected a Piñata live artifact: { format: 'pinata-live', version: 1 }"
    return { errors: [{ path: '', message }] }
  }
  const mannequin = validateMannequin(input.mannequin)
  const style = validateStyle(input.style)
  const rig = validateRig(input.rig)
  const behaviours = validateBehaviours(input.behaviours)
  const errors = [
    ...tagged('mannequin', mannequin.errors), ...tagged('style', style.errors), ...tagged('rig', rig.errors),
    ...tagged('behaviours', behaviours.errors)
  ]
  if (mannequin.value === undefined || style.value === undefined || rig.value === undefined ||
    behaviours.value === undefined || errors.length > 0) return { errors }
  const resolved = resolveRig(rig.value, mannequin.value)
  const cross = [
    ...tagged('mannequin', checkReferences(mannequin.value, style.value)),
    ...tagged('rig', checkRig(resolved, mannequin.value))
  ]
  const joint = behaviours.value.hang.joint
  if (mannequin.value.joints[joint] === undefined) {
    cross.push({ path: 'behaviours.hang.joint', message: `unknown joint '${joint}'` })
  }
  if (cross.length > 0) return { errors: cross }
  const name = typeof input.name === 'string' ? input.name : mannequin.value.name
  return {
    value: { name, mannequin: mannequin.value, style: style.value, rig: resolved, behaviours: behaviours.value },
    errors: []
  }
}
