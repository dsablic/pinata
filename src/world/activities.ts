import { checkKnownKeys, isFiniteNumber, isNonEmptyString, isRecord } from '../formats/validate.ts'
import type { Validated, ValidationError } from '../formats/validate.ts'

/**
 * A step of an activity. `walk` goes to a target at a multiple of the character's reference speed: `random` (a spot
 * anywhere), `far` (a spot at least half the world away), `friend` (beside another character), `away` (away from
 * whoever poked it). `face` turns toward the friend or the camera; `turn` turns by degrees in place; `stand` waits for
 * a number of seconds (a range picks one), optionally showing a glyph above the head while it waits.
 */
export type Step =
  | { do: 'walk', to: 'random' | 'far' | 'friend' | 'away', speed: number }
  | { do: 'face', toward: 'friend' | 'camera' }
  | { do: 'turn', degrees: number }
  | { do: 'stand', seconds: [number, number], say?: string }
export type Activity = { weight: number, steps: Step[] }
export type Activities = { activities: Record<string, Activity>, reactions: { poke: Step[] } }

const TARGETS = ['random', 'far', 'friend', 'away']
const FACES = ['friend', 'camera']
const MAX_SPEED = 3
const MAX_SECONDS = 60
const MAX_GLYPH = 4

function validateSteps (input: unknown, path: string, errors: ValidationError[]): void {
  if (!Array.isArray(input) || input.length === 0) {
    errors.push({ path, message: 'expected a non-empty array of steps' })
    return
  }
  input.forEach((step: unknown, i) => {
    const here = `${path}[${i}]`
    if (!isRecord(step)) {
      errors.push({ path: here, message: 'expected an object with "do"' })
      return
    }
    switch (step.do) {
      case 'walk':
        checkKnownKeys(step, ['do', 'to', 'speed'], here, errors)
        if (!TARGETS.includes(step.to as string)) {
          errors.push({ path: `${here}.to`, message: `expected one of ${TARGETS.join(', ')}` })
        }
        if (!(isFiniteNumber(step.speed) && step.speed > 0 && step.speed <= MAX_SPEED)) {
          const message = `expected a multiple of the walking speed, above 0, at most ${MAX_SPEED}`
          errors.push({ path: `${here}.speed`, message })
        }
        break
      case 'face':
        checkKnownKeys(step, ['do', 'toward'], here, errors)
        if (!FACES.includes(step.toward as string)) {
          errors.push({ path: `${here}.toward`, message: `expected one of ${FACES.join(', ')}` })
        }
        break
      case 'turn':
        checkKnownKeys(step, ['do', 'degrees'], here, errors)
        if (!(isFiniteNumber(step.degrees) && Math.abs(step.degrees) <= 360 && step.degrees !== 0)) {
          errors.push({ path: `${here}.degrees`, message: 'expected degrees, -360 to 360, not 0' })
        }
        break
      case 'stand': {
        checkKnownKeys(step, ['do', 'seconds', 'say'], here, errors)
        const { seconds } = step
        const ok = Array.isArray(seconds) && seconds.length === 2 && seconds.every(isFiniteNumber) &&
          seconds[0] > 0 && seconds[0] <= seconds[1] && seconds[1] <= MAX_SECONDS
        if (!ok) {
          errors.push({ path: `${here}.seconds`, message: `expected [min, max] seconds, above 0, at most ${MAX_SECONDS}` })
        }
        if (step.say !== undefined && !(isNonEmptyString(step.say) && [...step.say].length <= MAX_GLYPH)) {
          errors.push({ path: `${here}.say`, message: `expected a short glyph, at most ${MAX_GLYPH} characters` })
        }
        break
      }
      default:
        errors.push({ path: `${here}.do`, message: 'expected walk, face, turn or stand' })
    }
  })
}

export function validateActivities (input: unknown): Validated<Activities> {
  if (!isRecord(input)) return { errors: [{ path: '', message: 'expected a JSON object' }] }
  const errors: ValidationError[] = []
  checkKnownKeys(input, ['activities', 'reactions'], '', errors)
  if (!isRecord(input.activities) || Object.keys(input.activities).length === 0) {
    errors.push({ path: 'activities', message: 'expected an object of named activities' })
  } else {
    for (const [name, activity] of Object.entries(input.activities)) {
      const path = `activities.${name}`
      if (!isRecord(activity)) {
        errors.push({ path, message: 'expected { weight, steps }' })
        continue
      }
      checkKnownKeys(activity, ['weight', 'steps'], path, errors)
      if (!(isFiniteNumber(activity.weight) && activity.weight > 0)) {
        errors.push({ path: `${path}.weight`, message: 'expected a number above 0: how often it is chosen' })
      }
      validateSteps(activity.steps, `${path}.steps`, errors)
    }
  }
  if (!isRecord(input.reactions)) errors.push({ path: 'reactions', message: 'expected { poke: [steps] }' })
  else {
    checkKnownKeys(input.reactions, ['poke'], 'reactions', errors)
    validateSteps(input.reactions.poke, 'reactions.poke', errors)
  }
  if (errors.length > 0) return { errors }
  return { value: structuredClone(input) as Activities, errors }
}

/** Picks an activity name by weight with the given random number in [0, 1). */
export function pickActivity (activities: Activities, random: number): string {
  const entries = Object.entries(activities.activities)
  const total = entries.reduce((sum, [, a]) => sum + a.weight, 0)
  let left = random * total
  for (const [name, activity] of entries) {
    left -= activity.weight
    if (left < 0) return name
  }
  return entries[entries.length - 1][0]
}
