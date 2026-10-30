import { apply, eulerXyz, IDENTITY, multiply, transpose } from '../math/matrix.ts'
import type { Matrix } from '../math/matrix.ts'
import { add, normalize, scale } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'

const DEGREES = Math.PI / 180
const INCH = 0.0254
const AXES = ['rx', 'ry', 'rz'] as const

type Axis = typeof AXES[number]

/** A bone of an ASF skeleton, in metres and radians; direction is its unit rest direction in the global frame. */
export type AsfBone = {
  name: string
  parent: string
  direction: Vec3
  length: number
  /** The bone's local axes (C in the ASF convention); motion rotates about them. */
  axis: Matrix
  dof: Axis[]
}
/** An ASF skeleton: the root, then every bone with its parent before it. */
export type AsfSkeleton = { bones: AsfBone[], metresPerUnit: number }
/** One AMC frame: the root's position and rotation channels, then each bone's channels in its dof order. */
export type AmcFrame = Record<string, number[]>
/** A posed skeleton: every bone's global rotation from its rest pose, and where it starts and ends, in metres. */
export type AsfPose = Record<string, { rotation: Matrix, start: Vec3, end: Vec3 }>

function sections (text: string): Map<string, string[]> {
  const result = new Map<string, string[]>()
  let current: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    if (line.startsWith(':')) {
      const [name, ...rest] = line.slice(1).split(/\s+/)
      current = rest.length > 0 ? [rest.join(' ')] : []
      result.set(name, current)
    } else current.push(line)
  }
  return result
}

function numbers (line: string): number[] {
  return line.split(/\s+/).slice(1).map(Number)
}

/** Reads an ASF skeleton file: units, bone data and hierarchy. Lengths become metres and angles radians. */
export function parseAsf (text: string): AsfSkeleton {
  const parts = sections(text)
  const units = parts.get('units') ?? []
  const lengthUnit = Number(units.find(line => line.startsWith('length'))?.split(/\s+/)[1] ?? 1)
  const angle = units.find(line => line.startsWith('angle'))?.split(/\s+/)[1] ?? 'deg'
  if (angle !== 'deg') throw new Error(`ASF angles in '${angle}' are not supported; expected deg`)
  const metresPerUnit = INCH / lengthUnit
  const rootData = new Map((parts.get('root') ?? []).map(line => {
    const [key, ...rest] = line.split(/\s+/)
    return [key, rest.join(' ')]
  }))
  const expected: Array<[string, string]> = [['order', 'TX TY TZ RX RY RZ'], ['axis', 'XYZ'], ['orientation', '0 0 0']]
  for (const [key, value] of expected) {
    const found = rootData.get(key)
    const normal = found?.split(/\s+/).map(v => key === 'orientation' ? String(Number(v)) : v).join(' ')
    if (found !== undefined && normal !== value) {
      throw new Error(`ASF root ${key} '${found}' is not supported; expected '${value}'`)
    }
  }
  const parents = new Map<string, string>()
  for (const line of parts.get('hierarchy') ?? []) {
    if (line === 'begin' || line === 'end') continue
    const [parent, ...children] = line.split(/\s+/)
    for (const child of children) parents.set(child, parent)
  }
  const data = new Map<string, Omit<AsfBone, 'parent'>>()
  let bone: Record<string, string> = {}
  for (const line of parts.get('bonedata') ?? []) {
    if (line === 'begin') bone = {}
    else if (line === 'end') {
      const direction = normalize(numbers(`d ${bone.direction}`) as Vec3)
      const [x, y, z] = numbers(`a ${bone.axis}`)
      const order = bone.axis.split(/\s+/)[3]
      if (order !== 'XYZ') throw new Error(`bone '${bone.name}': axis order ${order} is not supported; expected XYZ`)
      const dof = (bone.dof ?? '').split(/\s+/).filter((d): d is Axis => (AXES as readonly string[]).includes(d))
      data.set(bone.name, {
        name: bone.name,
        direction,
        length: Number(bone.length) * metresPerUnit,
        axis: eulerXyz(x * DEGREES, y * DEGREES, z * DEGREES),
        dof
      })
    } else {
      const [key, ...rest] = line.split(/\s+/)
      if (key !== 'limits' && !line.startsWith('(')) bone[key] = rest.join(' ')
    }
  }
  const root: AsfBone = { name: 'root', parent: '', direction: [0, 0, 0], length: 0, axis: IDENTITY, dof: [] }
  const bones: AsfBone[] = [root]
  const visit = (name: string): void => {
    for (const [child, parent] of parents) {
      if (parent !== name) continue
      const found = data.get(child)
      if (found === undefined) throw new Error(`hierarchy names bone '${child}', which has no bonedata`)
      bones.push({ ...found, parent })
      visit(child)
    }
  }
  visit('root')
  return { bones, metresPerUnit }
}

/** Reads an AMC motion file: one frame per numbered block, each bone's channel values in file order. */
export function parseAmc (text: string): AmcFrame[] {
  const frames: AmcFrame[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || line.startsWith(':')) continue
    if (/^\d+$/.test(line)) {
      frames.push({})
      continue
    }
    const frame = frames[frames.length - 1]
    if (frame === undefined) throw new Error(`AMC channel line before the first frame number: '${line}'`)
    const [name, ...values] = line.split(/\s+/)
    frame[name] = values.map(Number)
  }
  return frames
}

/**
 * Forward kinematics of one AMC frame: each bone's global rotation is its parent's times C · M · C⁻¹, where M
 * turns by the frame's channels in the bone's dof order (missing channels are zero), and the bone runs from its
 * parent's end along its rest direction turned by that rotation. The root's channels are TX TY TZ RX RY RZ.
 */
export function posed (skeleton: AsfSkeleton, frame: AmcFrame): AsfPose {
  const pose: AsfPose = {}
  const root = frame.root ?? [0, 0, 0, 0, 0, 0]
  const position = scale(root.slice(0, 3) as Vec3, skeleton.metresPerUnit)
  const rotation = eulerXyz(root[3] * DEGREES, root[4] * DEGREES, root[5] * DEGREES)
  pose.root = { rotation, start: position, end: position }
  for (const bone of skeleton.bones.slice(1)) {
    const values = frame[bone.name] ?? []
    const angles: Record<Axis, number> = { rx: 0, ry: 0, rz: 0 }
    bone.dof.forEach((axis, i) => { angles[axis] = (values[i] ?? 0) * DEGREES })
    const motion = eulerXyz(angles.rx, angles.ry, angles.rz)
    const parent = pose[bone.parent]
    const global = multiply(parent.rotation, multiply(bone.axis, multiply(motion, transpose(bone.axis))))
    const start = parent.end
    pose[bone.name] = { rotation: global, start, end: add(start, scale(apply(global, bone.direction), bone.length)) }
  }
  return pose
}
