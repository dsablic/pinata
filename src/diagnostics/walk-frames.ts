import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateSkin } from '../formats/skin.ts'
import type { Pixel, Walk, WalkView } from '../formats/skin.ts'
import type { Drawable } from '../page/cast.ts'
import { readLayout } from '../page/fixture.ts'
import type { WalkerFrame } from '../page/walker.ts'
import { changedShare, silhouetteOf } from '../style/walk.ts'
import type { Silhouette } from '../style/walk.ts'
import type { ReadWorld } from '../world/bundle.ts'
import { run, scenario } from './page-scenarios.ts'

export type Placed = { sole: Pixel, planted: number, ground: number, index: number, sector: number | undefined }
export type Observed = { frame: WalkerFrame, root: number, silhouette: Silhouette, placed: Placed | undefined }
export type WalkStats = {
  walking: number
  shown: number
  stances: number
  compared: number
  worstX: number
  worstY: number
  switches: number
  smooth: number
}

export const MOST_SOLE_MOVE_PX = 1
export const MOST_SWITCH_CHANGE = 0.25
export const FEWEST_SMOOTH_SWITCHES = 0.95
const WALKING_SPEED = 0.3
const FIXTURE = ['test', 'fixtures', 'walk-frames']

export function readWalk (root: string, name: string): Walk {
  return JSON.parse(readFileSync(join(root, ...FIXTURE, `${name}.json`), 'utf8')) as Walk
}

export function withWalk (world: ReadWorld, name: string, view: WalkView, walk: Walk): ReadWorld {
  const index = world.cast.findIndex(member => member.name === name)
  const own = world.looks[index]?.skin
  if (own?.skin.views === undefined) throw new Error(`${name} has no eight-direction skin to carry a walk`)
  const views = { ...own.skin.views, [view]: { ...own.skin.views[view], walk } }
  const { parts: _, ...bare } = own.skin
  const checked = validateSkin({ ...bare, views })
  if (checked.value === undefined) {
    throw new Error(checked.errors.map(e => `${e.path}: ${e.message}`).join('; '))
  }
  const skin = checked.value
  return { ...world, looks: world.looks.map((l, i) => i === index ? { ...l, skin: { ...own, skin } } : l) }
}

function silhouetteOfDrawn (d: Drawable, scale: number): Silhouette {
  const { image, camera } = d.sprite()
  const left = Math.round((d.x - camera.width / 2 * scale) / scale)
  const top = Math.round((d.y - camera.baseline * scale) / scale)
  return silhouetteOf(image, left, top)
}

function placedOf (d: Drawable, scale: number): Placed | undefined {
  const { walk, camera, sector } = d.sprite()
  if (walk === undefined) return undefined
  const sole: Pixel = [
    (d.x + (walk.sole[0] + 0.5 - camera.width / 2) * scale) / scale,
    (d.y + (walk.sole[1] + 1 - camera.baseline) * scale) / scale
  ]
  return { sole, planted: walk.planted, ground: d.y, index: walk.index, sector }
}

export function watch (
  world: ReadWorld, layout: string, root: string, seconds: number, name: string, each: (seen: Observed) => void
): void {
  const fixture = readLayout(root, layout)
  const s = scenario(world, fixture)
  run(s, seconds, () => {
    const d = s.cast.drawables().find(x => x.name === name)
    const m = s.cast.moving().find(x => x.name === name)
    if (d === undefined || m === undefined) return
    const silhouette = silhouetteOfDrawn(d, fixture.scale)
    const root = m.frame.root.position[0] * fixture.pixelsPerMetre / fixture.scale
    each({ frame: m.frame, root, silhouette, placed: placedOf(d, fixture.scale) })
  })
}

export function walkStats (world: ReadWorld, layout: string, root: string, seconds: number, name: string): WalkStats {
  const stats: WalkStats = {
    walking: 0, shown: 0, stances: 0, compared: 0, worstX: 0, worstY: 0, switches: 0, smooth: 0
  }
  let before: Observed | undefined
  watch(world, layout, root, seconds, name, seen => {
    const { frame, placed: own } = seen
    const speed = Math.hypot(frame.root.velocity[0], frame.root.velocity[2])
    if (!frame.falling && frame.support !== undefined && speed > WALKING_SPEED) stats.walking++
    if (own !== undefined) stats.shown++
    const previous = before?.placed
    if (before !== undefined && (previous === undefined) !== (own === undefined)) {
      stats.switches++
      if (changedShare(before.silhouette, seen.silhouette) <= MOST_SWITCH_CHANGE) stats.smooth++
    }
    if (previous !== undefined && own !== undefined && previous.planted === own.planted) {
      stats.compared++
      stats.worstX = Math.max(stats.worstX, Math.abs(own.sole[0] - previous.sole[0]))
      if (own.ground === previous.ground) {
        stats.worstY = Math.max(stats.worstY, Math.abs(own.sole[1] - previous.sole[1]))
      }
    } else if (own !== undefined) {
      stats.stances++
    }
    before = seen
  })
  return stats
}
