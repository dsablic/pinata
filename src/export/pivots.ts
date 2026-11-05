import { legsOf } from '../formats/rig.ts'
import { VIEWS } from '../formats/skin.ts'
import type { SkinPart, ViewName } from '../formats/skin.ts'
import { footNames } from '../style/feet.ts'
import { counterpart } from '../style/views.ts'
import { DIRECTIONS, isMirrored, viewOf } from './directions.ts'
import type { Direction } from './directions.ts'
import { canvasOf, drawTake, footParts, withSkin } from './record.ts'
import type { Moment, Subject } from './record.ts'

export type Move = {
  view: ViewName
  part: string
  delta: 1 | -1
  direction: Direction
  affected: number
  shifts: Array<Array<number | undefined>>
}

export type Response = { pass: boolean, measured: boolean }

const DELTAS = [1, -1] as const

export type Blocked = { view: ViewName, part: string, delta: 1 | -1 }
export type Measured = { moves: Move[], blocked: Blocked[] }

function axisOf (sprite: SkinPart): 0 | 1 {
  return sprite.upright === true ? 0 : 1
}

function room (sprite: SkinPart, delta: number): boolean {
  const axis = axisOf(sprite)
  const size = axis === 0 ? [...sprite.rows![0]].length : sprite.rows!.length
  return [sprite.pivotA!, sprite.pivotB!].every(pivot => pivot[axis] + delta >= 0 && pivot[axis] + delta < size)
}

function shifted (pivot: [number, number], axis: 0 | 1, delta: number): [number, number] {
  return axis === 0 ? [pivot[0] + delta, pivot[1]] : [pivot[0], pivot[1] + delta]
}

function moved (sprite: SkinPart, delta: number): SkinPart {
  const axis = axisOf(sprite)
  return { ...sprite, pivotA: shifted(sprite.pivotA!, axis, delta), pivotB: shifted(sprite.pivotB!, axis, delta) }
}

export function withSprite (subject: Subject, view: ViewName, part: string, sprite: SkinPart): Subject {
  const { skin } = subject.look.skin
  const views = skin.views!
  const edited = { ...views, [view]: { parts: { ...views[view].parts, [part]: sprite } } }
  return withSkin(subject, { ...skin, views: edited })
}

function lowestRows (subject: Subject, frames: Moment[], direction: Direction): Array<Array<number | undefined>> {
  const track = drawTake(subject, frames, direction, canvasOf(subject), true)
  return Array.from({ length: track[0].feet.length }, (_, leg) => track.map(frame => frame.feet[leg].drawn?.y))
}

function affectedLeg (subject: Subject, part: string, direction: Direction): number {
  const shown = isMirrored(direction) ? counterpart(part) : part
  const leg = legsOf(subject.member.rig).findIndex(own => footParts(subject, own).includes(shown))
  if (leg < 0) throw new Error(`${subject.name}: no leg has a foot part '${shown}'`)
  return leg
}

function difference (now: Rows, before: Rows): Rows {
  return now.map((rows, leg) => rows.map((y, k) => {
    const was = before[leg][k]
    return y === undefined || was === undefined ? undefined : y - was
  }))
}

type Rows = Array<Array<number | undefined>>

export function pivotMoves (subject: Subject, frames: Moment[]): Measured {
  const feet = footNames(subject.member.mannequin, subject.member.rig)
  const views = subject.look.skin.skin.views!
  const base = new Map(DIRECTIONS.map(direction => [direction, lowestRows(subject, frames, direction)]))
  const measured: Measured = { moves: [], blocked: [] }
  for (const view of VIEWS) {
    for (const [part, sprite] of Object.entries(views[view].parts)) {
      if (!feet.includes(part) || sprite.rows === undefined || sprite.pivotB === undefined) continue
      for (const delta of DELTAS) {
        if (!room(sprite, delta)) {
          measured.blocked.push({ view, part, delta })
          continue
        }
        const edited = withSprite(subject, view, part, moved(sprite, delta))
        for (const direction of DIRECTIONS.filter(d => viewOf(d) === view)) {
          const shifts = difference(lowestRows(edited, frames, direction), base.get(direction)!)
          measured.moves.push({ view, part, delta, direction, affected: affectedLeg(subject, part, direction), shifts })
        }
      }
    }
  }
  return measured
}

export function responseOf ({ delta, affected, shifts }: Move): Response {
  const measured = shifts[affected].every(shift => shift !== undefined)
  const exact = shifts.every((rows, leg) => rows.every(shift => shift === (leg === affected ? -delta : 0)))
  return { pass: exact, measured }
}
