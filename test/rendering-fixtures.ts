import type { CapsulePart } from '../src/formats/mannequin.ts'
import type { Vec3 } from '../src/math/vec.ts'
import type { RootState } from '../src/motion/script.ts'

export function rootAt (position: Vec3 = [0, 0, 0], yaw = 0): RootState {
  return { position, yaw, velocity: [0, 0, 0], angularVelocity: 0 }
}

export function capsule (name: string, a: string, b: string, radius: number, material = 'm'): CapsulePart {
  return { name, shape: 'capsule', a, b, radiusA: radius, radiusB: radius, material }
}

export function ball (name: string, joint: string, radius: number, material = 'm'): CapsulePart {
  return capsule(name, joint, joint, radius, material)
}
