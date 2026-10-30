import type { Mannequin } from '../src/formats/mannequin.ts'
import type { Rig } from '../src/formats/rig.ts'
import type { RootState } from '../src/motion/script.ts'

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

export const rig: Rig = {
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
}

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
