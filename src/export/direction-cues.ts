import type { Mannequin } from '../formats/mannequin.ts'
import { armsOf } from '../formats/rig.ts'
import type { Rig } from '../formats/rig.ts'
import { TRANSPARENT_CHAR } from '../formats/skin.ts'
import type { Skin, SkinPart, ViewName } from '../formats/skin.ts'
import { mirrored } from '../style/views.ts'

export type Regions = { face: string[], features: string[], torso: string[] }
export type Finding = { view: ViewName, part: string, message: string }
export type Measurement = { findings: Finding[], reason?: string }
type Pixels = Map<string, string>

export const THREE_QUARTER_MIN = 8
export const PROFILE_MIN = 4
export const BACK_SLIVER = 3

export const DIRECTION_CUES: Record<ViewName, string> = {
  front: 'the face fully visible and centred, both eyes level, the shoulders level and equally wide',
  frontSide: 'the face shifted toward the facing side, the far eye smaller or half hidden, the nose or visor past ' +
    "the head's outline, the near shoulder and arm larger, a cape falling to the far side",
  side: "a profile: the nose past the head's outline, one eye, the toes pointing forward",
  backSide: 'the back of the head only (hair, hood or helmet back, no face and no beard), the head shifted toward ' +
    'the facing side, the near shoulder larger, a cape falling to the far side',
  back: 'the back of the head only (hair, hood, helmet back or cape): no face, no eyes, no beard or white patch'
}

const NEIGHBOURS: Record<'frontSide' | 'backSide', ViewName[]> = {
  frontSide: ['front', 'side'],
  backSide: ['back', 'side']
}
const BACK_VIEWS: ViewName[] = ['back', 'backSide']
const TOLERANCE = 1e-9
const RING = [[1, 0], [-1, 0], [0, 1], [0, -1]]

function limbJointsOf (rig: Rig): Set<string> {
  return new Set(rig.limbs.flatMap(limb => limb.joints))
}

export function regionsOf (mannequin: Mannequin, rig: Rig): Regions | undefined {
  const arms = armsOf(rig)
  if (arms.length === 0) return undefined
  const { joints } = mannequin
  const limb = limbJointsOf(rig)
  const shoulderY = Math.max(...arms.map(arm => joints[arm.shoulder][1]))
  const halfWidth = Math.max(...arms.map(arm => Math.abs(joints[arm.shoulder][0])))
  const pelvisY = joints[rig.pelvis][1]
  const central = mannequin.parts.filter(part => {
    const ends = [part.a, part.b]
    return ends.every(end => !limb.has(end) && Math.abs(joints[end][0]) <= halfWidth)
  })
  const heights = (part: { a: string, b: string }): number[] => [joints[part.a][1], joints[part.b][1]]
  const head = central.filter(part => Math.min(...heights(part)) >= shoulderY)
  const torso = central.filter(part => {
    const middle = (Math.min(...heights(part)) + Math.max(...heights(part))) / 2
    return !head.includes(part) && middle >= pelvisY - TOLERANCE && middle <= shoulderY + TOLERANCE
  })
  return {
    face: head.map(part => part.name),
    features: head.filter(part => part.a === part.b).map(part => part.name),
    torso: torso.map(part => part.name)
  }
}

type Keep = (x: number) => boolean

function pixelsOf (sprite: SkinPart | undefined, palette: Skin['palette'], keep: Keep = () => true): Pixels {
  const cells: Pixels = new Map()
  if (sprite?.rows === undefined || sprite.pivotA === undefined) return cells
  const [pivotX, pivotY] = sprite.pivotA
  sprite.rows.forEach((row, y) => [...row].forEach((char, x) => {
    if (char !== TRANSPARENT_CHAR && keep(x - pivotX)) cells.set(`${x - pivotX},${y - pivotY}`, palette[char])
  }))
  return cells
}

function difference (a: Pixels, b: Pixels): number {
  const keys = new Set([...a.keys(), ...b.keys()])
  return [...keys].filter(key => a.get(key) !== b.get(key)).length
}

function flipped (sprite: SkinPart | undefined): SkinPart | undefined {
  return sprite === undefined ? undefined : mirrored(sprite, sprite.pivotB !== undefined)
}

function spriteOf (skin: Skin, view: ViewName, part: string): SkinPart | undefined {
  return skin.views?.[view].parts[part]
}

function listed (parts: string[]): string {
  return parts.join(', ')
}

function lacking (sprite: SkinPart | undefined): boolean {
  return sprite === undefined || (sprite.hidden !== true && (sprite.rows === undefined || sprite.pivotA === undefined))
}

function absent (skin: Skin, views: ViewName[], parts: string[]): Finding[] {
  return views.flatMap(view => parts.filter(part => lacking(spriteOf(skin, view, part))).map(part => {
    return { view, part, message: 'has no sprite with a pivotA, so it cannot be compared: draw it' }
  }))
}

function distinct (findings: Finding[]): Finding[] {
  const seen = new Set<string>()
  return findings.filter(({ view, part, message }) => {
    const key = `${view}|${part}|${message}`
    return seen.has(key) ? false : Boolean(seen.add(key))
  })
}

function groupDifference (skin: Skin, view: ViewName, other: ViewName, parts: string[], mirror: boolean): number {
  return parts.reduce((sum, part) => {
    const against = spriteOf(skin, other, part)
    const own = pixelsOf(spriteOf(skin, view, part), skin.palette)
    return sum + difference(own, pixelsOf(mirror ? flipped(against) : against, skin.palette))
  }, 0)
}

function apartBetween (skin: Skin, view: ViewName, other: ViewName, parts: string[]): number {
  return Math.min(groupDifference(skin, view, other, parts, false), groupDifference(skin, view, other, parts, true))
}

function compared (skin: Skin, view: ViewName, other: ViewName, region: string, parts: string[]): Finding[] {
  const gaps = absent(skin, [view, other], parts)
  if (gaps.length > 0) return gaps
  const apart = apartBetween(skin, view, other, parts)
  if (apart >= THREE_QUARTER_MIN) return []
  const message = `the ${region} differs from the ${other} view, or from it mirrored, by ${apart} px ` +
    `(at least ${THREE_QUARTER_MIN} needed): draw ${DIRECTION_CUES[view]}`
  return [{ view, part: listed(parts), message }]
}

export function threeQuarterFindings (skin: Skin, regions: Regions): Measurement {
  const groups = Object.entries({ head: regions.face, torso: regions.torso }).filter(([, parts]) => parts.length > 0)
  if (groups.length === 0) return { findings: [], reason: 'the rig has no head or torso part to compare' }
  const views = Object.keys(NEIGHBOURS) as Array<keyof typeof NEIGHBOURS>
  const findings = views.flatMap(view => NEIGHBOURS[view].flatMap(other => {
    return groups.flatMap(([region, parts]) => compared(skin, view, other, region, parts))
  }))
  return { findings: distinct(findings) }
}

function coloursOf (pixels: Pixels): Set<string> {
  return new Set(pixels.values())
}

function mergedColours (skin: Skin, view: ViewName, parts: string[], keep?: Keep): Set<string> {
  return new Set(parts.flatMap(part => [...coloursOf(pixelsOf(spriteOf(skin, view, part), skin.palette, keep))]))
}

function rimColours (skin: Skin, view: ViewName, parts: string[]): Set<string> {
  return new Set(parts.flatMap(part => {
    const pixels = pixelsOf(spriteOf(skin, view, part), skin.palette)
    return [...pixels].filter(([key]) => {
      const [x, y] = key.split(',').map(Number)
      return RING.some(([dx, dy]) => !pixels.has(`${x + dx},${y + dy}`))
    }).map(([, colour]) => colour)
  }))
}

export function faceColours (skin: Skin, regions: Regions): Set<string> {
  const framing = new Set([
    ...mergedColours(skin, 'side', regions.features, x => x < 0),
    ...rimColours(skin, 'front', regions.face)
  ])
  return new Set([...mergedColours(skin, 'front', regions.features)].filter(colour => !framing.has(colour)))
}

function carriedFace (skin: Skin, view: ViewName, regions: Regions, face: Set<string>): Finding[] {
  const carried = regions.face.map(part => {
    const own = pixelsOf(spriteOf(skin, view, part), skin.palette)
    return { part, count: [...own.values()].filter(colour => face.has(colour)).length }
  }).filter(({ count }) => count > 0)
  const total = carried.reduce((sum, { count }) => sum + count, 0)
  if (total <= BACK_SLIVER) return []
  const where = carried.map(({ part, count }) => `${part} ${count} px`).join(', ')
  const message = `the head carries ${total} px in colours the front view's face uses and the back of the side ` +
    `view's head does not (${where}; at most ${BACK_SLIVER} allowed): draw ${DIRECTION_CUES[view]}`
  return [{ view, part: listed(carried.map(({ part }) => part)), message }]
}

export function backFaceFindings (skin: Skin, regions: Regions): Measurement {
  if (regions.face.length === 0) return { findings: [], reason: 'the rig has no head part above the shoulders' }
  const gaps = absent(skin, ['front', 'side', ...BACK_VIEWS], regions.face)
  if (gaps.length > 0) return { findings: gaps }
  const face = faceColours(skin, regions)
  if (face.size === 0) {
    return { findings: [], reason: 'the front face has no colour of its own: every colour is on its outline or in ' +
      'the back of the side head' }
  }
  return { findings: BACK_VIEWS.flatMap(view => carriedFace(skin, view, regions, face)) }
}

function carriedColours (skin: Skin, view: ViewName, regions: Regions, face: Set<string>): number {
  return regions.face.reduce((sum, part) => {
    const own = pixelsOf(spriteOf(skin, view, part), skin.palette)
    return sum + [...own.values()].filter(colour => face.has(colour)).length
  }, 0)
}

function asymmetry (sprite: SkinPart, palette: Skin['palette']): number {
  const pixels = pixelsOf(sprite, palette)
  const columns = [...pixels.keys()].map(key => Number(key.split(',')[0]))
  if (columns.length === 0) return 0
  const axis = Math.min(...columns) + Math.max(...columns)
  const reflected: Pixels = new Map([...pixels].map(([key, colour]) => {
    const [x, y] = key.split(',').map(Number)
    return [`${axis - x},${y}`, colour]
  }))
  return difference(pixels, reflected)
}

export function profileFindings (skin: Skin, regions: Regions): Measurement {
  if (regions.face.length === 0) return { findings: [], reason: 'the rig has no head part above the shoulders' }
  const gaps = absent(skin, ['side'], regions.face)
  if (gaps.length > 0) return { findings: gaps }
  const apart = regions.face.reduce((sum, part) => sum + asymmetry(spriteOf(skin, 'side', part)!, skin.palette), 0)
  if (apart >= PROFILE_MIN) return { findings: [] }
  const message = `the head is left-right symmetric (${apart} px differ from its mirror, at least ` +
    `${PROFILE_MIN} needed): draw ${DIRECTION_CUES.side}`
  return { findings: [{ view: 'side', part: listed(regions.face), message }] }
}

function neighbouring (view: ViewName, other: ViewName): boolean {
  const near = (a: ViewName, b: ViewName): boolean => (NEIGHBOURS as Partial<Record<ViewName, ViewName[]>>)[a]
    ?.includes(b) ?? false
  return near(view, other) || near(other, view)
}

function sideMeasure (skin: Skin, regions: Regions): string | undefined {
  if (regions.face.length === 0 || absent(skin, ['side'], regions.face).length > 0) return undefined
  const apart = regions.face.reduce((sum, part) => sum + asymmetry(spriteOf(skin, 'side', part)!, skin.palette), 0)
  return `its head differs from its own mirror by ${apart} px, the minimum is ${PROFILE_MIN}`
}

function backMeasure (skin: Skin, regions: Regions, view: ViewName): string | undefined {
  if (regions.face.length === 0 || absent(skin, ['front', 'side', view], regions.face).length > 0) return undefined
  const face = faceColours(skin, regions)
  if (face.size === 0) return undefined
  return `its head carries ${carriedColours(skin, view, regions, face)} px in colours only the front face uses, ` +
    `at most ${BACK_SLIVER} allowed`
}

function neighbourMeasure (skin: Skin, regions: Regions, view: ViewName, named: ViewName): string | undefined {
  const groups = Object.entries({ head: regions.face, torso: regions.torso }).filter(([, parts]) => parts.length > 0)
  const said = groups.filter(([, parts]) => absent(skin, [view, named], parts).length === 0).map(([region, parts]) => {
    return `its ${region} differs from the ${named} ${region} by ${apartBetween(skin, view, named, parts)} px`
  })
  return said.length === 0 ? undefined : `${said.join(', ')}, the minimum is ${THREE_QUARTER_MIN}`
}

export function misreadMeasure (skin: Skin, regions: Regions, view: ViewName, named: ViewName): string | undefined {
  if (view === named) return undefined
  if (neighbouring(view, named)) return neighbourMeasure(skin, regions, view, named)
  if (BACK_VIEWS.includes(view) && !BACK_VIEWS.includes(named)) return backMeasure(skin, regions, view)
  return view === 'side' ? sideMeasure(skin, regions) : undefined
}
