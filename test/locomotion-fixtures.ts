import type { Mannequin } from '../src/formats/mannequin.ts'
import { translateLegacy } from '../src/formats/limbs.ts'
import type { LegacyArm, LegacyLeg } from '../src/formats/limbs.ts'
import type { Gait, Rig } from '../src/formats/rig.ts'
import type { SimMaterial } from '../src/formats/sim.ts'
import { planGait } from '../src/motion/gait.ts'
import type { GaitFrame } from '../src/motion/gait.ts'
import { recordLocomotion } from '../src/motion/metrics.ts'
import type { Geometry, LocomotionRecording } from '../src/motion/metrics.ts'
import { restPose } from '../src/motion/pose.ts'
import type { RootState } from '../src/motion/script.ts'
import type { Vec3 } from '../src/math/vec.ts'

export const FPS = 24

export const mannequin: Mannequin = {
  name: 'synthetic',
  height: 1.8,
  joints: {
    pelvis: [0, 0.9, 0],
    chest: [0, 1.3, 0],
    head: [0, 1.6, 0],
    hipL: [0.1, 0.9, 0],
    kneeL: [0.1, 0.5, 0.2],
    ankleL: [0.1, 0.1, 0],
    toeL: [0.1, 0.05, 0.15],
    hipR: [-0.1, 0.9, 0],
    kneeR: [-0.1, 0.5, 0.2],
    ankleR: [-0.1, 0.1, 0],
    toeR: [-0.1, 0.05, 0.15],
    shoulderL: [0.25, 1.4, 0],
    elbowL: [0.27, 1.15, 0.03],
    wristL: [0.27, 0.9, 0.05],
    handL: [0.27, 0.82, 0.06],
    shoulderR: [-0.25, 1.4, 0],
    elbowR: [-0.27, 1.15, 0.03],
    wristR: [-0.27, 0.9, 0.05],
    handR: [-0.27, 0.82, 0.06]
  },
  parts: [
    { name: 'footL', shape: 'capsule', a: 'ankleL', b: 'toeL', radiusA: 0.1, radiusB: 0.05, material: 'm' },
    { name: 'footR', shape: 'capsule', a: 'ankleR', b: 'toeR', radiusA: 0.1, radiusB: 0.05, material: 'm' }
  ],
  decals: []
}

type LegacyRig = { legs: LegacyLeg[], arms: LegacyArm[], pelvis: string, upperBody: string[], gait: Gait }

function legacyRig ({ legs, arms, ...rest }: LegacyRig): Rig {
  return { ...rest, limbs: translateLegacy(legs, arms) }
}

export const rig: Rig = legacyRig({
  legs: [
    { side: 'left', hip: 'hipL', knee: 'kneeL', ankle: 'ankleL', toe: 'toeL' },
    { side: 'right', hip: 'hipR', knee: 'kneeR', ankle: 'ankleR', toe: 'toeR' }
  ],
  arms: [
    { side: 'left', shoulder: 'shoulderL', elbow: 'elbowL', wrist: 'wristL', hand: 'handL' },
    { side: 'right', shoulder: 'shoulderR', elbow: 'elbowR', wrist: 'wristR', hand: 'handR' }
  ],
  pelvis: 'pelvis',
  upperBody: ['chest', 'head'],
  gait: {
    strideLength: 0.9,
    referenceSpeed: 1.2,
    stanceFraction: 0.62,
    stepHeight: 0.08,
    bobAmplitude: 0.02,
    armSwingDegrees: 20,
    footSpacing: 0.2
  }
})

export function walkTrack (speed: number, walkSeconds: number): (t: number) => RootState {
  return (t: number): RootState => {
    const moving = t < walkSeconds
    const z = speed * Math.min(t, walkSeconds)
    return { position: [0, 0, z], yaw: 0, velocity: [0, 0, moving ? speed : 0], angularVelocity: 0 }
  }
}

export const straightMannequin: Mannequin = {
  ...mannequin,
  joints: { ...mannequin.joints, kneeL: [0.1, 0.5, 0.02], kneeR: [-0.1, 0.5, 0.02] }
}

export function turnTrack (rate: number, turnSeconds: number): (t: number) => RootState {
  return (t: number): RootState => {
    const turning = t < turnSeconds
    return {
      position: [0, 0, 0],
      yaw: rate * Math.min(t, turnSeconds),
      velocity: [0, 0, 0],
      angularVelocity: turning ? rate : 0
    }
  }
}

const QUAD_LEGS = [
  { name: 'LH', x: 0.08, z: -0.2, knee: -0.32, toe: -0.1 },
  { name: 'LF', x: 0.08, z: 0.2, knee: 0.22, toe: 0.3 },
  { name: 'RH', x: -0.08, z: -0.2, knee: -0.32, toe: -0.1 },
  { name: 'RF', x: -0.08, z: 0.2, knee: 0.22, toe: 0.3 }
]

export const quadMannequin: Mannequin = {
  name: 'quad',
  height: 0.8,
  joints: {
    pelvis: [0, 0.6, 0],
    chest: [0, 0.62, 0.3],
    ...Object.fromEntries(QUAD_LEGS.flatMap(({ name, x, z, knee, toe }) => [
      [`hip${name}`, [x, 0.6, z]],
      [`knee${name}`, [x, 0.32, knee]],
      [`ankle${name}`, [x, 0.06, z]],
      [`toe${name}`, [x, 0.03, toe]]
    ]))
  },
  parts: QUAD_LEGS.map(({ name }) => ({
    name: `foot${name}`,
    shape: 'capsule',
    a: `ankle${name}`,
    b: `toe${name}`,
    radiusA: 0.06,
    radiusB: 0.03,
    material: 'm'
  })),
  decals: []
}

export const quadRig: Rig = legacyRig({
  legs: QUAD_LEGS.map(({ name, x }, i): LegacyLeg => ({
    side: x > 0 ? 'left' : 'right',
    hip: `hip${name}`,
    knee: `knee${name}`,
    ankle: `ankle${name}`,
    toe: `toe${name}`,
    phase: [0, 0.25, 0.5, 0.75][i],
    bend: name.endsWith('H') ? 'backward' : 'forward'
  })),
  arms: [],
  pelvis: 'pelvis',
  upperBody: ['chest'],
  gait: {
    strideLength: 0.6,
    referenceSpeed: 0.9,
    stanceFraction: 0.75,
    stepHeight: 0.05,
    bobAmplitude: 0.01,
    armSwingDegrees: 0,
    footSpacing: 0.16
  }
})

export const biped: Geometry = { rig, mannequin }
export const quad: Geometry = { rig: quadRig, mannequin: quadMannequin }

export function plan (body: Geometry, track: (t: number) => RootState, duration: number): GaitFrame[] {
  const { rig, mannequin } = body
  return planGait({ track, rig, rest: restPose(mannequin), mannequin, duration, fps: FPS })
}

export function record (body: Geometry, frames: GaitFrame[]): LocomotionRecording {
  const { rig, mannequin } = body
  return recordLocomotion(frames, { rig, rest: restPose(mannequin), mannequin, fps: FPS })
}

export type Landing = { frame: number, leg: number, side: string, ankle: Vec3 }

export function landings (frames: GaitFrame[]): Landing[] {
  const found: Landing[] = []
  for (let i = 1; i < frames.length; i++) {
    frames[i].feet.forEach((foot, leg) => {
      if (!foot.planted || frames[i - 1].feet[leg].planted) return
      found.push({ frame: i, leg, side: foot.side, ankle: foot.ankle })
    })
  }
  return found
}

export function widestArmSwing (frames: GaitFrame[]): GaitFrame {
  return frames.reduce((best, f) => Math.abs(f.armSwings[0]) > Math.abs(best.armSwings[0]) ? f : best)
}

export const silk: SimMaterial = {
  name: 'silk', particleMass: 0.01, stretchCompliance: 1e-6, bendCompliance: 1e-3, damping: 0.3, drag: 0.02
}
