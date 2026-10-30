import type { Mannequin } from './mannequin.ts'
import type { Style } from './style.ts'
import type { ValidationError } from './validate.ts'

export function checkReferences (m: Mannequin, s: Style): ValidationError[] {
  const errors: ValidationError[] = []
  m.parts.forEach((part, i) => {
    if (!Object.hasOwn(s.materials, part.material)) {
      errors.push({
        path: `parts[${i}].material`,
        message: `material '${part.material}' has no ramp in style '${s.name}'; add materials['${part.material}']`
      })
    }
  })
  m.decals.forEach((decal, i) => {
    for (const ch of new Set(decal.pattern.join(''))) {
      if (ch !== '.' && !Object.hasOwn(s.decalColors, ch)) {
        errors.push({
          path: `decals[${i}].pattern`,
          message: `character '${ch}' has no colour in style '${s.name}' decalColors; use '.' for transparent`
        })
      }
    }
  })
  return errors
}
