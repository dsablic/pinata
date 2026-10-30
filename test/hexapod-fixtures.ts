import type { Mannequin } from '../src/formats/mannequin.ts'
import type { Limb, Rig } from '../src/formats/rig.ts'

const LEGS = [
  { tag: 'LF', side: 'left', x: 0.1, z: 0.3, phase: 0 },
  { tag: 'LM', side: 'left', x: 0.1, z: 0, phase: 0.5 },
  { tag: 'LH', side: 'left', x: 0.1, z: -0.3, phase: 0 },
  { tag: 'RF', side: 'right', x: -0.1, z: 0.3, phase: 0.5 },
  { tag: 'RM', side: 'right', x: -0.1, z: 0, phase: 0 },
  { tag: 'RH', side: 'right', x: -0.1, z: -0.3, phase: 0.5 }
] as const

const ARMS = [
  { tag: 'L', side: 'left', x: 0.12 },
  { tag: 'R', side: 'right', x: -0.12 }
] as const

export const hexMannequin: Mannequin = {
  name: 'hexapod',
  height: 0.7,
  joints: {
    pelvis: [0, 0.5, 0],
    chest: [0, 0.55, 0.25],
    ...Object.fromEntries(LEGS.flatMap(({ tag, x, z }) => [
      [`hip${tag}`, [x, 0.5, z]],
      [`knee${tag}`, [x, 0.3, z + 0.12]],
      [`hock${tag}`, [x, 0.15, z - 0.05]],
      [`ankle${tag}`, [x, 0.03, z + 0.02]],
      [`toe${tag}`, [x, 0.03, z + 0.1]]
    ])),
    ...Object.fromEntries(ARMS.flatMap(({ tag, x }) => [
      [`shoulder${tag}`, [x, 0.6, 0.3]],
      [`elbow${tag}`, [x, 0.5, 0.36]],
      [`claw${tag}`, [x, 0.4, 0.4]],
      [`gem${tag}`, [x, 0.38, 0.42]]
    ])),
    tail1: [0, 0.5, -0.2],
    tail2: [0, 0.5, -0.3],
    tail3: [0, 0.48, -0.4]
  },
  parts: LEGS.map(({ tag }) => ({
    name: `foot${tag}`,
    shape: 'capsule',
    a: `ankle${tag}`,
    b: `toe${tag}`,
    radiusA: 0.03,
    radiusB: 0.03,
    material: 'm'
  })),
  decals: []
}

const limbs: Limb[] = [
  ...LEGS.map(({ tag, side, phase }): Limb => ({
    kind: 'leg',
    name: `leg${tag}`,
    joints: ['hip', 'knee', 'hock', 'ankle', 'toe'].map(n => `${n}${tag}`),
    side,
    phase,
    bend: ['forward', 'backward']
  })),
  ...ARMS.map(({ tag, side }): Limb => ({
    kind: 'arm',
    name: `arm${tag}`,
    joints: [`shoulder${tag}`, `elbow${tag}`, `claw${tag}`],
    side,
    carried: [`gem${tag}`]
  })),
  { kind: 'appendage', name: 'tail', joints: ['tail1', 'tail2', 'tail3'], stiffness: 0.6, damping: 0.4 }
]

export const hexRig: Rig = {
  limbs,
  pelvis: 'pelvis',
  upperBody: ['chest'],
  gait: {
    strideLength: 0.4,
    referenceSpeed: 0.5,
    stanceFraction: 0.6,
    stepHeight: 0.04,
    bobAmplitude: 0.004,
    armSwingDegrees: 20,
    footSpacing: 0.2
  }
}
