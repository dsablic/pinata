import type { Vec3 } from '../math/vec.ts'
import type { Part } from './mannequin.ts'
import { listTemplates } from './templates.ts'
import type { TemplateDefaults, TemplateName } from './templates.ts'

export type StarterFiles = Record<string, unknown>

type Joints = Record<string, Vec3>
type Body = {
  joints: Joints
  parts: Part[]
  legs: Array<{ tag: string, side: 'left' | 'right' }>
  arms: Array<{ tag: string, side: 'left' | 'right', joints: string[] }>
  appendages: Array<{ name: string, joints: string[] }>
  upperBody: string[]
  legLength: number
  tunedGait?: Record<string, number>
}

const LEG_RADIUS = 0.035
const FOOT_RADIUS = 0.045
const MIN_STEP_HEIGHT = 0.05
const SIDES = [{ side: 'left', sign: 1, tag: 'L' }, { side: 'right', sign: -1, tag: 'R' }] as const
const JOINT_PRECISION = 1e6
const SIZE_PRECISION = 1000

function roundTo (value: number, precision: number): number {
  return Math.round(value * precision) / precision
}

function round (v: Vec3): Vec3 {
  return v.map(x => roundTo(x, JOINT_PRECISION)) as Vec3
}

function capsule (name: string, a: string, b: string, radiusA: number, radiusB: number, material: string): Part {
  return { name, shape: 'capsule', a, b, radiusA, radiusB, material }
}

type LegShape = {
  knee: number
  splay?: number
  toe: number
  foot?: [number, number]
  radius?: number
}

function addLeg (body: Body, tag: string, hip: Vec3, shape: LegShape): void {
  const [x, y, z] = hip
  const [ankleRadius, toeRadius] = shape.foot ?? [FOOT_RADIUS, FOOT_RADIUS]
  const radius = shape.radius ?? LEG_RADIUS
  const ankleX = x + Math.sign(x) * (shape.splay ?? 0)
  body.joints[`hip${tag}`] = round(hip)
  body.joints[`knee${tag}`] = round([(x + ankleX) / 2, (y + ankleRadius) / 2, z + shape.knee])
  body.joints[`ankle${tag}`] = round([ankleX, ankleRadius, z])
  body.joints[`toe${tag}`] = round([ankleX, toeRadius, z + shape.toe])
  body.parts.push(
    capsule(`thigh${tag}`, `hip${tag}`, `knee${tag}`, radius * 1.2, radius, 'limb'),
    capsule(`shin${tag}`, `knee${tag}`, `ankle${tag}`, radius, radius * 0.9, 'limb'),
    capsule(`foot${tag}`, `ankle${tag}`, `toe${tag}`, ankleRadius, toeRadius, 'dark')
  )
}

function biped (): Body {
  const body: Body = {
    joints: {
      pelvis: [0, 0.55, 0], chest: [0, 0.86, 0], head: [0, 1.04, 0], headTop: [0, 1.1, 0]
    },
    parts: [
      capsule('torso', 'pelvis', 'chest', 0.11, 0.12, 'body'),
      capsule('head', 'head', 'headTop', 0.13, 0.1, 'skin')
    ],
    legs: [],
    arms: [],
    appendages: [],
    upperBody: ['chest', 'head', 'headTop'],
    legLength: 0.52,
    tunedGait: { stanceFraction: 0.55, stepHeight: 0.066 }
  }
  for (const { side, sign, tag } of SIDES) {
    addLeg(body, tag, [sign * 0.08, 0.55, 0], { knee: 0.03, toe: 0.13, foot: [0.07, 0.05], radius: 0.06 })
    body.legs.push({ tag, side })
    const arm = ['shoulder', 'elbow', 'wrist', 'hand'].map(n => `${n}${tag}`)
    body.joints[arm[0]] = [sign * 0.18, 0.95, 0]
    body.joints[arm[1]] = [sign * 0.2, 0.75, 0.02]
    body.joints[arm[2]] = [sign * 0.2, 0.58, 0.04]
    body.joints[arm[3]] = [sign * 0.2, 0.52, 0.05]
    body.parts.push(
      capsule(`upperArm${tag}`, arm[0], arm[1], 0.06, 0.055, 'body'),
      capsule(`forearm${tag}`, arm[1], arm[2], 0.055, 0.05, 'skin')
    )
    body.arms.push({ tag, side, joints: arm })
  }
  return body
}

function quadruped (): Body {
  const body: Body = {
    joints: {
      pelvis: [0, 0.5, 0], rump: [0, 0.5, -0.22], chest: [0, 0.5, 0.22], neck: [0, 0.6, 0.3], head: [0, 0.66, 0.4],
      tail1: [0, 0.54, -0.3], tail2: [0, 0.6, -0.4], tail3: [0, 0.64, -0.5]
    },
    parts: [
      capsule('trunk', 'rump', 'chest', 0.1, 0.11, 'body'),
      capsule('neckPart', 'chest', 'neck', 0.08, 0.07, 'body'),
      capsule('headPart', 'neck', 'head', 0.07, 0.09, 'skin'),
      capsule('tailBase', 'tail1', 'tail2', 0.035, 0.03, 'body'),
      capsule('tailTip', 'tail2', 'tail3', 0.03, 0.025, 'body')
    ],
    legs: [],
    arms: [],
    appendages: [{ name: 'tail', joints: ['tail1', 'tail2', 'tail3'] }],
    upperBody: ['rump', 'chest', 'neck', 'head'],
    legLength: 0.41
  }
  for (const { side, sign, tag } of SIDES) {
    for (const [end, z, knee] of [['H', -0.22, -1], ['F', 0.22, 1]] as const) {
      addLeg(body, `${tag}${end}`, [sign * 0.09, 0.44, z], { knee: knee * 0.12, toe: 0.08 })
      body.legs.push({ tag: `${tag}${end}`, side })
    }
  }
  return body
}

function manyLegged (count: number, spacing: number): Body {
  const perSide = count / 2
  const reach = spacing * (perSide - 1) / 2
  const body: Body = {
    joints: {
      pelvis: [0, 0.32, 0], abdomen: [0, 0.32, -reach - 0.08], thorax: [0, 0.33, reach], head: [0, 0.33, reach + 0.14]
    },
    parts: [
      capsule('abdomenPart', 'abdomen', 'pelvis', 0.12, 0.1, 'body'),
      capsule('thoraxPart', 'pelvis', 'thorax', 0.1, 0.09, 'body'),
      capsule('headPart', 'thorax', 'head', 0.07, 0.08, 'skin')
    ],
    legs: [],
    arms: [],
    appendages: [],
    upperBody: ['abdomen', 'thorax', 'head'],
    legLength: 0.27
  }
  for (const { side, sign, tag } of SIDES) {
    for (let k = 0; k < perSide; k++) {
      const legTag = `${tag}${k + 1}`
      addLeg(body, legTag, [sign * 0.11, 0.3, reach - k * spacing], { knee: 0.06, splay: 0.04 * (k % 2), toe: 0.07 })
      body.legs.push({ tag: legTag, side })
    }
  }
  return body
}

const BODIES: Record<TemplateName, () => Body> = {
  biped,
  quadruped,
  hexapod: () => manyLegged(6, 0.3),
  octopod: () => manyLegged(8, 0.24)
}

function gaitOf (template: TemplateDefaults, legLength: number): Record<string, number> {
  const scaled = Object.entries(template.gaitPerLegLength).map(([key, ratio]) => {
    return [key, roundTo(ratio * legLength, SIZE_PRECISION)]
  })
  const gait = Object.fromEntries(scaled)
  gait.stepHeight = Math.max(gait.stepHeight, MIN_STEP_HEIGHT)
  return gait
}

function motionOf (gait: Record<string, number>): unknown {
  const speed = gait.referenceSpeed
  const cycle = gait.strideLength / speed
  const accelSeconds = 1
  const move = Math.ceil((accelSeconds + 3.5 * cycle) * 10) / 10
  return {
    script: {
      accelSeconds,
      segments: [
        { action: 'move', speed, duration: move },
        { action: 'turn', degrees: 90, duration: 2 },
        { action: 'move', speed, duration: move },
        { action: 'hold', duration: 1 }
      ]
    },
    gravity: [0, -9.81, 0],
    fps: 24,
    substeps: 8,
    particleRadius: 0.02
  }
}

export function starterPackage (name: TemplateName): StarterFiles {
  const template = listTemplates().find(t => t.name === name)
  if (template === undefined) throw new Error(`unknown template '${name}'`)
  const body = BODIES[name]()
  const top = (part: Part): number => {
    if (part.shape !== 'capsule') return 0
    return Math.max(body.joints[part.a][1] + part.radiusA, body.joints[part.b][1] + part.radiusB)
  }
  const height = roundTo(Math.max(...body.parts.map(top)), SIZE_PRECISION)
  const limbs = [
    ...body.legs.map(({ tag, side }) => {
      return { kind: 'leg', name: `leg${tag}`, side, joints: ['hip', 'knee', 'ankle', 'toe'].map(n => `${n}${tag}`) }
    }),
    ...body.arms.map(({ tag, side, joints }) => ({ kind: 'arm', name: `arm${tag}`, side, joints })),
    ...body.appendages.map(({ name, joints }) => ({ kind: 'appendage', name, joints, stiffness: 0.4, damping: 0.3 }))
  ]
  const gait = { ...gaitOf(template, body.legLength), ...body.tunedGait }
  return {
    'character.json': { name: `${name}-starter`, description: `A starter ${name}: ${template.description}.` },
    'mannequin.json': { name: `${name}-starter`, height, joints: body.joints, parts: body.parts, decals: [] },
    'rig.json': { template: name, pelvis: 'pelvis', upperBody: body.upperBody, limbs, gait },
    'style.json': {
      name: `${name}-starter`,
      light: [-0.5, 0.7, 0.5],
      bands: [0.05, 0.6],
      outline: '#1b1421',
      outlineMode: 'selective',
      innerLineDepth: 0.12,
      decalMinFacing: 0.3,
      materials: {
        body: ['#2e3a5e', '#4d6aa8', '#9bb4e0'],
        skin: ['#7a3b2e', '#c9704f', '#f0b48a'],
        limb: ['#3a2b3e', '#6b4f6e', '#a98aa8'],
        dark: ['#3a1f26', '#7a4a2c', '#c99a5b']
      },
      decalColors: {}
    },
    'materials.json': [
      { name: 'cloth', particleMass: 0.02, stretchCompliance: 1e-7, bendCompliance: 1e-4, damping: 2.4, drag: 0.015 }
    ],
    'motion.json': motionOf(gait)
  }
}
