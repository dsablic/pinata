import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  backFaceFindings, misreadMeasure, profileFindings, regionsOf, threeQuarterFindings
} from '../export/direction-cues.ts'
import type { Measurement, Regions } from '../export/direction-cues.ts'
import type { Character } from '../formats/character.ts'
import { DIRECTIONS, viewOf } from '../export/directions.ts'
import type { Direction as Facing } from '../export/directions.ts'
import { validateSkin } from '../formats/skin.ts'
import type { Skin } from '../formats/skin.ts'
import type { DeclaredGate } from '../checks/gate-spec.ts'
import type { Check } from '../cli/summary.ts'

type Measure = (skin: Skin, regions: Regions) => Measurement
export type Direction = { declared: DeclaredGate, name: string, measure: Measure, rationale: string }

export const DIRECTION_CHECKS: Direction[] = [
  {
    declared: 'threeQuarterViews',
    name: 'threeQuarterViewFindings',
    measure: threeQuarterFindings,
    rationale: 'a three-quarter view\'s head and torso sprites differ from both neighbouring cardinal views, and ' +
      'from each mirrored, by enough pixels to carry a cue'
  },
  {
    declared: 'backViewFace',
    name: 'backViewFaceFindings',
    measure: backFaceFindings,
    rationale: 'a back view\'s head carries no more than a sliver of the colours that only the front face uses'
  },
  {
    declared: 'sideProfile',
    name: 'sideProfileFindings',
    measure: profileFindings,
    rationale: 'a side view\'s head is not left-right symmetric, so it carries a profile'
  }
]

export type DirectionChecks = { checks: Check[], notes: string[] }

function skinOf (dir: string): Skin | string | undefined {
  const file = join(dir, 'skin.json')
  if (!existsSync(file)) return undefined
  try {
    const read = validateSkin(JSON.parse(readFileSync(file, 'utf8')))
    if (read.value === undefined) return 'the skin is invalid'
    return read.value.views === undefined ? 'the skin draws one view, not five' : read.value
  } catch {
    return 'the skin cannot be read'
  }
}

function unmeasured (reason: string): DirectionChecks {
  return { checks: [], notes: [`direction checks not measured: ${reason}`] }
}

export function directionChecks (character: Character): DirectionChecks {
  const skin = skinOf(character.dir)
  if (skin === undefined) return { checks: [], notes: [] }
  if (typeof skin === 'string') return unmeasured(skin)
  const regions = regionsOf(character.mannequin, character.rig)
  if (regions === undefined) {
    return unmeasured('the rig has no arms, so there are no shoulders to place the head against')
  }
  const checks: Check[] = []
  const notes: string[] = []
  for (const { name, measure, rationale } of DIRECTION_CHECKS) {
    const { findings, reason } = measure(skin, regions)
    if (reason !== undefined) {
      notes.push(`${name} not measured: ${reason}`)
      continue
    }
    checks.push({
      gate: { name, value: findings.length, op: '<=', threshold: 0, rationale },
      hint: () => findings.map(finding => `${finding.view} ${finding.part}: ${finding.message}`).join('; ')
    })
  }
  return { checks, notes }
}

export type Measurer = (label: string, named: string) => string | undefined

const isDirection = (label: string): label is Facing => (DIRECTIONS as readonly string[]).includes(label)

export function measurerFor (character: Character): Measurer {
  const skin = skinOf(character.dir)
  const regions = typeof skin === 'object' ? regionsOf(character.mannequin, character.rig) : undefined
  if (typeof skin !== 'object' || regions === undefined) return () => undefined
  return (label, named) => {
    return isDirection(label) && isDirection(named)
      ? misreadMeasure(skin, regions, viewOf(label), viewOf(named))
      : undefined
  }
}
