import { check } from '../formats/schema.ts'
import type { Schema } from '../formats/schema.ts'
import type { Validated, ValidationError } from '../formats/validate.ts'

export type Step =
  | { do: 'walk', to: 'random' | 'far' | 'friend' | 'away', speed: number }
  | { do: 'face', toward: 'friend' | 'camera' }
  | { do: 'turn', degrees: number }
  | { do: 'stand', seconds: [number, number], say?: string }
export type Activity = { weight: number, steps: Step[] }

export type Palette = { top: string, side: string, edge: string, sky: string }
export type Look = { material: string, radius: number }
export type Dress = { cape?: Look, chains?: Record<string, Look>, hide?: string[] }

export type WorldConfig = {
  cast: string[]
  terrain: {
    length: number
    maxSlopeDegrees: number
    maxHeight: number
    heightStep: number
    riseOfLeg: number
    treadOfFoot: number
  }
  lanes: { spacing: number }
  dress: Record<string, Dress>
  life: {
    lean: { frequency: number, damping: number, perAcceleration: number, perTurn: number, perWind: number, max: number }
    breathe: { amplitude: number, period: number }
    sway: { degrees: number, period: number }
    squash: { amount: number, seconds: number }
    anticipation: number
    head: { above: number, frequency: number, damping: number, gain: number }
    exaggerate: { bob: number, armSwing: number }
  }
  environment: {
    gravity: number
    wind: { direction: [number, number, number], speed: number, gust: number }
    clothSubsteps: number
    springs: { gravity: number, windDrag: number }
  }
  motion: { settleSeconds: number, turnSecondsPerRadian: number, minTurnSeconds: number, springSubsteps: number }
  targets: { random: number, far: number, friendGap: number, away: [number, number] }
  activities: Record<string, Activity>
  reactions: { poke: { say: string, steps: Step[] } }
  view: {
    pixelsPerMetre: number
    azimuthDeg: number
    elevationDeg: number
    samples: number
    floorPx: number
    scene: string
  }
  scenes: Record<string, Palette>
  glyphs: Record<string, string[]>
}

const positive = (max: number, note?: string): Schema => ({ kind: 'number', min: 0, max, note })
const glyph: Schema = { kind: 'string', maxLength: 4, note: 'a short glyph shown above the head' }

const STEP: Schema = {
  kind: 'union',
  by: 'do',
  cases: {
    walk: {
      fields: {
        to: { kind: 'string', oneOf: ['random', 'far', 'friend', 'away'] },
        speed: { kind: 'number', min: 0.05, max: 3, note: 'a multiple of the character\'s walking speed' }
      }
    },
    face: { fields: { toward: { kind: 'string', oneOf: ['friend', 'camera'] } } },
    turn: { fields: { degrees: { kind: 'number', min: -360, max: 360 } } },
    stand: { fields: { seconds: { kind: 'range', min: 0.1, max: 60 }, say: glyph }, optional: ['say'] }
  }
}
const STEPS: Schema = { kind: 'array', of: STEP, minItems: 1 }
const CLOTH_LOOK: Schema = {
  kind: 'object',
  fields: { material: { kind: 'string', note: 'a material of the character\'s style' }, radius: positive(1, 'metres') }
}
const DRESS: Schema = {
  kind: 'object',
  fields: {
    cape: CLOTH_LOOK,
    chains: { kind: 'map', of: CLOTH_LOOK, note: 'by chain index' },
    hide: { kind: 'array', of: { kind: 'string' }, note: 'mannequin parts the cloth replaces' }
  },
  optional: ['cape', 'chains', 'hide']
}

export const WORLD_SCHEMA: Schema = {
  kind: 'object',
  fields: {
    cast: { kind: 'array', of: { kind: 'string' }, minItems: 1, note: 'example character names' },
    terrain: {
      kind: 'object',
      fields: {
        length: positive(200),
        maxSlopeDegrees: positive(45),
        maxHeight: positive(10),
        heightStep: { kind: 'number', min: 0.01, max: 5 },
        riseOfLeg: { kind: 'number', min: 0.05, max: 0.6, note: 'stair rise as a fraction of the shortest leg' },
        treadOfFoot: { kind: 'number', min: 1, max: 4, note: 'stair tread as a multiple of the longest foot' }
      }
    },
    lanes: { kind: 'object', fields: { spacing: { kind: 'number', min: 0.1, max: 3 } } },
    dress: { kind: 'map', of: DRESS },
    life: {
      kind: 'object',
      fields: {
        lean: {
          kind: 'object',
          fields: {
            frequency: { kind: 'number', min: 0.1, max: 20, note: 'Hz of the lean spring' },
            damping: positive(2, 'damping ratio, 1 settles without overshoot'),
            perAcceleration: positive(45, 'degrees per m/s^2'),
            perTurn: positive(45, 'degrees per rad/s'),
            perWind: positive(20, 'degrees of lean into the wind per m/s'),
            max: positive(60, 'degrees')
          }
        },
        breathe: {
          kind: 'object',
          fields: { amplitude: positive(0.1, 'metres'), period: { kind: 'number', min: 0.5, max: 30 } }
        },
        sway: { kind: 'object', fields: { degrees: positive(20), period: { kind: 'number', min: 0.5, max: 60 } } },
        squash: { kind: 'object', fields: { amount: positive(0.4), seconds: { kind: 'number', min: 0.02, max: 2 } } },
        anticipation: positive(5),
        head: {
          kind: 'object',
          fields: {
            above: { kind: 'number', min: 0.3, max: 1, note: 'fraction of the height' },
            frequency: { kind: 'number', min: 0.1, max: 20 },
            damping: positive(2),
            gain: positive(100)
          }
        },
        exaggerate: { kind: 'object', fields: { bob: positive(5), armSwing: positive(5) } }
      }
    },
    environment: {
      kind: 'object',
      fields: {
        gravity: positive(50, 'm/s^2, downward'),
        wind: {
          kind: 'object',
          fields: { direction: { kind: 'vec3' }, speed: positive(30, 'm/s'), gust: positive(1, '0 steady to 1 gusty') }
        },
        clothSubsteps: { kind: 'number', min: 1, max: 64, integer: true },
        springs: {
          kind: 'object',
          fields: { gravity: positive(1, 'share of gravity on spring chains'), windDrag: positive(50, 'per second') }
        }
      }
    },
    motion: {
      kind: 'object',
      fields: {
        settleSeconds: positive(5),
        turnSecondsPerRadian: positive(5),
        minTurnSeconds: positive(5),
        springSubsteps: { kind: 'number', min: 1, max: 32, integer: true }
      }
    },
    targets: {
      kind: 'object',
      fields: {
        random: positive(120, 'longest wander, seconds of walking'),
        far: positive(120, 'longest dash, seconds of walking'),
        friendGap: positive(5, 'metres between visitors'),
        away: { kind: 'range', min: 0, max: 50, note: 'metres a startled character runs' }
      }
    },
    activities: {
      kind: 'map',
      minItems: 1,
      of: { kind: 'object', fields: { weight: { kind: 'number', min: 0.001, max: 1000 }, steps: STEPS } }
    },
    reactions: {
      kind: 'object',
      fields: { poke: { kind: 'object', fields: { say: glyph, steps: STEPS } } }
    },
    view: {
      kind: 'object',
      fields: {
        pixelsPerMetre: { kind: 'number', min: 4, max: 400 },
        azimuthDeg: { kind: 'number', min: -180, max: 180 },
        elevationDeg: { kind: 'number', min: -89, max: 89 },
        samples: { kind: 'number', min: 1, max: 4, integer: true },
        floorPx: positive(1000),
        scene: { kind: 'string', note: 'a name in scenes' }
      }
    },
    scenes: {
      kind: 'map',
      minItems: 1,
      of: {
        kind: 'object',
        fields: { top: { kind: 'colour' }, side: { kind: 'colour' }, edge: { kind: 'colour' }, sky: { kind: 'colour' } }
      }
    },
    glyphs: { kind: 'map', minItems: 1, of: { kind: 'array', of: { kind: 'string' }, minItems: 1 } }
  }
}

export function validateWorldConfig (input: unknown): Validated<WorldConfig> {
  const errors: ValidationError[] = []
  check(input, WORLD_SCHEMA, '', errors)
  if (errors.length === 0) {
    const config = input as WorldConfig
    if (config.scenes[config.view.scene] === undefined) {
      errors.push({ path: 'view.scene', message: `expected one of ${Object.keys(config.scenes).join(', ')}` })
    }
  }
  return errors.length > 0 ? { errors } : { value: structuredClone(input) as WorldConfig, errors }
}

export function pickActivity (activities: Record<string, Activity>, random: number): string {
  const entries = Object.entries(activities)
  const total = entries.reduce((sum, [, a]) => sum + a.weight, 0)
  let left = random * total
  for (const [name, activity] of entries) {
    left -= activity.weight
    if (left < 0) return name
  }
  return entries[entries.length - 1][0]
}
