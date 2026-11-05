import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Regions } from '../src/export/direction-cues.ts'
import { VIEWS } from '../src/formats/skin.ts'
import type { Skin, SkinPart, ViewName } from '../src/formats/skin.ts'
import { CHARACTER_OK, characterVariant, patchJson } from './formats-fixtures.ts'

export type Sprites = Record<string, string[]>
export type Views = Partial<Record<ViewName, Sprites>>

export const HEAD = ['.hhhhh.', 'hhhhhhh', 'hsesesh', 'hsssssh', '.hhhhh.']
export const DISTINCT = ['sssssss', 'sssssss', 'sssssss', 'sssssss', 'sssssss']
export const FACE_ONLY: Regions = { face: ['head'], features: ['head'], torso: [] }
export const TORSO_ONLY: Regions = { face: [], features: [], torso: ['torso'] }

const PALETTE = { h: '#4a3326', s: '#e0a886', e: '#202040', n: '#9a6a50', m: '#3b55c4', b: '#1e2a6b' }

export function sprite (rows: string[], pivot: [number, number] = [3, 2]): SkinPart {
  return { rows, pivotA: pivot }
}

export function recoloured (rows: string[], from: string, to: string, count: number): string[] {
  let left = count
  return rows.map(row => [...row].map(char => char === from && left-- > 0 ? to : char).join(''))
}

export function mirroredRows (rows: string[]): string[] {
  return rows.map(row => [...row].reverse().join(''))
}

export function skinOf (views: Views): Skin {
  const parts = (view: ViewName): Record<string, SkinPart> => {
    return Object.fromEntries(Object.entries(views[view] ?? {}).map(([name, rows]) => [name, sprite(rows)]))
  }
  const drawn = Object.fromEntries(VIEWS.map(view => [view, { parts: parts(view) }])) as Skin['views']
  return { name: 'case', palette: PALETTE, parts: drawn!.side.parts, views: drawn }
}

export function headSkin (views: Views): Skin {
  const head = (rows: string[]): Sprites => ({ head: rows })
  return skinOf({
    front: head(HEAD), frontSide: head(DISTINCT), side: head(DISTINCT), backSide: head(DISTINCT), back: head(HEAD),
    ...views
  })
}

export function pivoted (skin: Skin, view: ViewName, part: string, pivot: [number, number]): Skin {
  const copy = structuredClone(skin)
  copy.views![view].parts[part].pivotA = pivot
  return copy
}

const COMPLETE: Required<Views> = {
  front: { head: HEAD, torso: ['mmmm', 'mmmm', 'mmmm'] },
  frontSide: { head: ['.hhhhh.', 'hhhhhhh', 'hhseses', 'hhssssn', '.hhhhh.'], torso: ['bbbbbb', 'bbbbbb', 'bbbbbb'] },
  side: { head: ['.hhhhh.', 'hhhhsss', 'hhhhsee', 'hhhhsss', '.hhhhh.'], torso: ['mmmm', 'bbbb', 'bbbb'] },
  backSide: { head: ['.hhhhh.', 'hhhhhnn', 'hhhhnnn', 'hhhhhnn', '.hhhhh.'], torso: ['mmmmmm', 'mmmmmm', 'mmmmmm'] },
  back: { head: ['.hhhhh.', 'hhhnnhh', 'hhnnnhh', 'hhhnnhh', '.hhhhh.'], torso: ['bbbb', 'bbbb', 'bbbb'] }
}

export function completeViews (changes: Views): Views {
  return Object.fromEntries(VIEWS.map(view => [view, { ...COMPLETE[view], ...changes[view] }]))
}

export function characterWithViews (changes: Views, edit: (dir: string) => void = () => {}): string {
  return characterVariant(dir => {
    const { parts, ...skin } = skinOf(completeViews(changes))
    writeFileSync(join(dir, 'skin.json'), JSON.stringify(skin))
    patchJson(dir, 'mannequin.json', mannequin => {
      const head = mannequin.parts.find((part: { name: string }) => part.name === 'head')
      Object.assign(head, { b: 'head', radiusB: head.radiusA })
      mannequin.height = 1.17
    })
    edit(dir)
  }, CHARACTER_OK)
}
