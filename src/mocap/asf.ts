import { apply, eulerXyz, IDENTITY, multiply, transpose } from '../math/matrix.ts'
import type { Matrix } from '../math/matrix.ts'
import { add, normalize, scale } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'

const DEGREES = Math.PI / 180
const INCH = 0.0254
const AXES = ['rx', 'ry', 'rz'] as const

type Axis = typeof AXES[number]

export type AsfBone = {
  name: string
  parent: string
  direction: Vec3
  length: number
  axis: Matrix
  dof: Axis[]
}
export type AsfSkeleton = { bones: AsfBone[], metresPerUnit: number }
export type AmcFrame = Record<string, number[]>
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

function metresPerUnitOf (units: string[]): number {
  const lengthUnit = Number(units.find(line => line.startsWith('length'))?.split(/\s+/)[1] ?? 1)
  const angle = units.find(line => line.startsWith('angle'))?.split(/\s+/)[1] ?? 'deg'
  if (angle !== 'deg') throw new Error(`ASF angles in '${angle}' are not supported; expected deg`)
  return INCH / lengthUnit
}

const SUPPORTED_ROOT: Array<[string, string]> = [
  ['order', 'TX TY TZ RX RY RZ'], ['axis', 'XYZ'], ['orientation', '0 0 0']
]

function checkRoot (lines: string[]): void {
  const rootData = new Map(lines.map(line => {
    const [key, ...rest] = line.split(/\s+/)
    return [key, rest.join(' ')]
  }))
  for (const [key, value] of SUPPORTED_ROOT) {
    const found = rootData.get(key)
    const normal = found?.split(/\s+/).map(v => key === 'orientation' ? String(Number(v)) : v).join(' ')
    if (found !== undefined && normal !== value) {
      throw new Error(`ASF root ${key} '${found}' is not supported; expected '${value}'`)
    }
  }
}

function parentsFrom (hierarchy: string[]): Map<string, string> {
  const parents = new Map<string, string>()
  for (const line of hierarchy) {
    if (line === 'begin' || line === 'end') continue
    const [parent, ...children] = line.split(/\s+/)
    for (const child of children) parents.set(child, parent)
  }
  return parents
}

function boneFrom (bone: Record<string, string>, metresPerUnit: number): Omit<AsfBone, 'parent'> {
  const direction = normalize(numbers(`d ${bone.direction}`) as Vec3)
  const [x, y, z] = numbers(`a ${bone.axis}`)
  const order = bone.axis.split(/\s+/)[3]
  if (order !== 'XYZ') throw new Error(`bone '${bone.name}': axis order ${order} is not supported; expected XYZ`)
  const dof = (bone.dof ?? '').split(/\s+/).filter((d): d is Axis => (AXES as readonly string[]).includes(d))
  return {
    name: bone.name,
    direction,
    length: Number(bone.length) * metresPerUnit,
    axis: eulerXyz(x * DEGREES, y * DEGREES, z * DEGREES),
    dof
  }
}

function boneData (lines: string[], metresPerUnit: number): Map<string, Omit<AsfBone, 'parent'>> {
  const data = new Map<string, Omit<AsfBone, 'parent'>>()
  let bone: Record<string, string> = {}
  for (const line of lines) {
    if (line === 'begin') bone = {}
    else if (line === 'end') data.set(bone.name, boneFrom(bone, metresPerUnit))
    else {
      const [key, ...rest] = line.split(/\s+/)
      if (key !== 'limits' && !line.startsWith('(')) bone[key] = rest.join(' ')
    }
  }
  return data
}

function parentsFirst (parents: Map<string, string>, data: Map<string, Omit<AsfBone, 'parent'>>): AsfBone[] {
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
  return bones
}

export function parseAsf (text: string): AsfSkeleton {
  const parts = sections(text)
  const metresPerUnit = metresPerUnitOf(parts.get('units') ?? [])
  checkRoot(parts.get('root') ?? [])
  const parents = parentsFrom(parts.get('hierarchy') ?? [])
  const data = boneData(parts.get('bonedata') ?? [], metresPerUnit)
  return { bones: parentsFirst(parents, data), metresPerUnit }
}

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
