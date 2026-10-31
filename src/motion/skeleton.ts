import type { Rig } from '../formats/rig.ts'
import { add, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { apply } from '../math/matrix.ts'
import type { Matrix } from '../math/matrix.ts'
import type { Pose } from './pose.ts'

export type Transform = { rotation?: Matrix, translation: Vec3 }
export type Transforms = Record<string, Transform>
export type Parents = Record<string, string | undefined>

export function placed (transform: Transform, rest: Vec3): Vec3 {
  const { rotation, translation } = transform
  return rotation === undefined ? add(rest, translation) : add(apply(rotation, rest), translation)
}

export function transformTo (rotation: Matrix | undefined, rest: Vec3, posed: Vec3): Transform {
  if (rotation === undefined) return { translation: sub(posed, rest) }
  return { rotation, translation: sub(posed, apply(rotation, rest)) }
}

export function parentsOf (rig: Rig): Parents {
  const parents: Parents = { [rig.pelvis]: undefined }
  for (const joint of rig.upperBody) parents[joint] = rig.pelvis
  for (const [joint, parent] of Object.entries(rig.attached ?? {})) parents[joint] = parent
  for (const limb of rig.limbs) {
    const first = limb.kind === 'appendage' ? (limb.parent ?? rig.pelvis) : rig.pelvis
    limb.joints.forEach((joint, i) => { parents[joint] = i === 0 ? first : limb.joints[i - 1] })
    if (limb.kind !== 'arm') continue
    for (const joint of limb.carried ?? []) parents[joint] = limb.joints[limb.joints.length - 1]
  }
  return parents
}

export function findCycle (parents: Parents): string[] | undefined {
  try {
    hierarchyOrder(parents)
    return undefined
  } catch (err) {
    if (!(err instanceof CycleError)) throw err
    return err.joints
  }
}

class CycleError extends Error {
  readonly joints: string[]
  constructor (joints: string[]) {
    super(`joints form a cycle: ${joints.join(' -> ')}`)
    this.joints = joints
  }
}

export function hierarchyOrder (parents: Parents): string[] {
  const order: string[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (joint: string, path: string[]): void => {
    if (state.get(joint) === 'done') return
    if (state.get(joint) === 'visiting') throw new CycleError([...path.slice(path.indexOf(joint)), joint])
    state.set(joint, 'visiting')
    const parent = parents[joint]
    if (parent !== undefined) visit(parent, [...path, joint])
    state.set(joint, 'done')
    order.push(joint)
  }
  for (const joint of Object.keys(parents)) visit(joint, [])
  return order
}

export function inherit (
  pose: Pose,
  transforms: Transforms,
  options: { rest: Pose, parents: Parents, order: string[], driven: ReadonlySet<string> }
): void {
  for (const joint of options.order) {
    const parent = options.parents[joint]
    if (options.driven.has(joint) || parent === undefined) continue
    const transform = transforms[parent]
    if (transform === undefined) throw new Error(`joint '${joint}' hangs from '${parent}', which is not placed`)
    transforms[joint] = transform
    pose[joint] = placed(transform, options.rest[joint])
  }
}
