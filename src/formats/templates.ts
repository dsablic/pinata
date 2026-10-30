import type { Bend, Limb, LegLimb } from './limbs.ts'

export type TemplateName = 'biped' | 'quadruped' | 'hexapod' | 'octopod'
export type GaitPerLegLength = {
  strideLength: number
  referenceSpeed: number
  stepHeight: number
  bobAmplitude: number
  footSpacing: number
}
export type TemplateDefaults = {
  name: TemplateName
  description: string
  legCount: number
  stanceFraction: number
  armSwingDegrees: number
  phaseStep: number
  bends: Bend[]
  gaitPerLegLength: GaitPerLegLength
}
export type TemplateGait = { stanceFraction?: number, armSwingDegrees?: number }

const TEMPLATES: Record<TemplateName, TemplateDefaults> = {
  biped: {
    name: 'biped',
    description: 'two legs, alternating, with arms that swing against the legs',
    legCount: 2,
    stanceFraction: 0.6,
    armSwingDegrees: 20,
    phaseStep: 0.5,
    bends: ['forward'],
    gaitPerLegLength: {
      strideLength: 1.4, referenceSpeed: 1.8, stepHeight: 0.12, bobAmplitude: 0.035, footSpacing: 0.37
    }
  },
  quadruped: {
    name: 'quadruped',
    description: 'four legs in a walk: left hind, left front, right hind, right front; hind legs bend backward',
    legCount: 4,
    stanceFraction: 0.75,
    armSwingDegrees: 0,
    phaseStep: 0.25,
    bends: ['backward', 'forward'],
    gaitPerLegLength: {
      strideLength: 0.85, referenceSpeed: 0.75, stepHeight: 0.15, bobAmplitude: 0.017, footSpacing: 0.38
    }
  },
  hexapod: {
    name: 'hexapod',
    description: 'six legs in an alternating tripod gait',
    legCount: 6,
    stanceFraction: 0.6,
    armSwingDegrees: 0,
    phaseStep: 0.5,
    bends: ['forward'],
    gaitPerLegLength: {
      strideLength: 0.6, referenceSpeed: 0.8, stepHeight: 0.12, bobAmplitude: 0.01, footSpacing: 0.35
    }
  },
  octopod: {
    name: 'octopod',
    description: 'eight legs in an alternating tetrapod gait',
    legCount: 8,
    stanceFraction: 0.6,
    armSwingDegrees: 0,
    phaseStep: 0.5,
    bends: ['forward'],
    gaitPerLegLength: {
      strideLength: 0.5, referenceSpeed: 0.6, stepHeight: 0.1, bobAmplitude: 0.008, footSpacing: 0.3
    }
  }
}

export const TEMPLATE_NAMES = Object.keys(TEMPLATES) as TemplateName[]

export function isTemplateName (v: unknown): v is TemplateName {
  return typeof v === 'string' && TEMPLATE_NAMES.includes(v as TemplateName)
}

export function listTemplates (): TemplateDefaults[] {
  return TEMPLATE_NAMES.map(name => structuredClone(TEMPLATES[name]))
}

/**
 * Fills what the limbs and gait leave out. A leg's position counts the legs of its side before it in the file
 * (hind to front): a left leg gets phase position * phaseStep, a right leg half a cycle later. Explicit values win.
 */
export function applyTemplate (name: TemplateName, limbs: Limb[], gait: TemplateGait): void {
  const defaults = TEMPLATES[name]
  const seen = { left: 0, right: 0 }
  for (const limb of limbs) {
    if (limb.kind !== 'leg') continue
    const position = seen[limb.side]++
    fillLeg(limb, defaults, position)
  }
  gait.stanceFraction ??= defaults.stanceFraction
  gait.armSwingDegrees ??= defaults.armSwingDegrees
}

function fillLeg (leg: LegLimb, defaults: TemplateDefaults, position: number): void {
  const offset = leg.side === 'left' ? 0 : 0.5
  leg.phase ??= (offset + position * defaults.phaseStep) % 1
  leg.bend ??= defaults.bends[position % defaults.bends.length]
}
