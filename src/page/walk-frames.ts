import type { Image } from '../image.ts'
import { strideOf, travelBetween } from '../formats/skin.ts'
import type { Pixel, Skin, ViewName, Walk, WalkFrame } from '../formats/skin.ts'
import { LANDING_RECOVERY_SECONDS } from '../mocap/player.ts'
import { SECTOR } from '../style/views.ts'
import type { ViewChoice } from '../style/views.ts'
import {
  changedShare, drawFrame, facingWalk, meanSoleX, plantedSole, sharedShare, silhouetteOf
} from '../style/walk.ts'
import type { Box, Silhouette } from '../style/walk.ts'
import type { WalkerFrame } from './walker.ts'

export type Shown = { image: Image, sole: Pixel, planted: number, index: number, gridX: number }
export type Tick = {
  walker: WalkerFrame
  choice: ViewChoice
  facing: number
  distance: number
  sinceAir: number
  gridX: number
  top: number
  cutout: () => Silhouette
}
export type WalkFrames = {
  update: (tick: Tick) => void
  shown: () => Shown | undefined
  carry: (gridShift: number) => void
  reset: () => void
}
export type WalkFramesOptions = { skin: Skin, box: Box, spritePerMetre: number, fps: number }

type Gait = { walk: Walk, stride: number, slowest: number, fastest: number }
type Playing = {
  view: ViewName
  mirror: boolean
  index: number
  phase: number
  origin: number
  waited: number
}

export const MOST_HOLD_TICKS = 6
export const LEAVE_SPEED_SHARE = 0.8
export const MOST_ENTER_MISMATCH = 0.2
export const MOST_LEAVE_MISMATCH = 0.25
export const MOST_WAIT_TICKS = 30
export const ENTER_OFF_DEGREES = 8
export const LEAVE_OFF_DEGREES = 20
const MOST_SHIFT = 8
const FOLLOW_TICKS = 2
const PHASE_START = 0.01

export function recoveryTicks (fps: number): number {
  return Math.ceil(LANDING_RECOVERY_SECONDS * fps)
}

export function gaitOf (walk: Walk, spritePerMetre: number, fps: number): Gait {
  const stride = strideOf(walk)
  const slot = stride / walk.frames.length / spritePerMetre
  return { walk, stride, slowest: slot * fps / MOST_HOLD_TICKS, fastest: slot * fps }
}

export function createWalkFrames (options: WalkFramesOptions): WalkFrames | undefined {
  const { skin, box, spritePerMetre, fps } = options
  const gaits = new Map<ViewName, Gait>()
  for (const [view, drawn] of Object.entries(skin.views ?? {}) as Array<[ViewName, { walk?: Walk }]>) {
    if (drawn.walk !== undefined) gaits.set(view, gaitOf(drawn.walk, spritePerMetre, fps))
  }
  if (gaits.size === 0) return undefined
  const centre = Math.floor(box.width / 2)
  let playing: Playing | undefined
  let current: Shown | undefined
  let last: Silhouette | undefined

  const frameOf = (p: Playing): WalkFrame => facingWalk((gaits.get(p.view) as Gait).walk, p.mirror).frames[p.index]
  const compose = (p: Playing, gridX: number): Shown => {
    const frame = frameOf(p)
    const sole = plantedSole(frame)
    const origin: Pixel = [p.origin - (gridX - centre), box.baseline - 1 - sole[1]]
    return {
      image: drawFrame(frame, skin.palette, box, origin),
      sole: [origin[0] + sole[0], origin[1] + sole[1]],
      planted: frame.planted,
      index: p.index,
      gridX
    }
  }
  const silhouetteOfShown = (shown: Shown, top: number): Silhouette => {
    return silhouetteOf(shown.image, shown.gridX - centre, top)
  }
  const hardOk = (t: Tick): boolean => {
    const { walker } = t
    return !walker.falling && walker.support !== undefined && walker.activity !== 'drop' &&
      walker.jumpTo === undefined && t.sinceAir >= recoveryTicks(fps)
  }
  const softOk = (t: Tick, gait: Gait | undefined, sticky: boolean): boolean => {
    if (gait === undefined) return false
    const speed = t.distance * fps
    const slowest = sticky ? LEAVE_SPEED_SHARE * gait.slowest : gait.slowest
    const off = Math.abs(t.facing - t.choice.sector * SECTOR)
    const limit = (sticky ? LEAVE_OFF_DEGREES : ENTER_OFF_DEGREES) * Math.PI / 180
    const { velocity, yaw } = t.walker.root
    const ahead = velocity[0] * Math.sin(yaw) + velocity[2] * Math.cos(yaw) > 0
    return speed >= slowest && speed <= gait.fastest && off <= limit && ahead && t.walker.cruising
  }
  const enter = (t: Tick, gait: Gait, drawn: Silhouette): void => {
    const walk = facingWalk(gait.walk, t.choice.mirror)
    let best: { index: number, origin: number, share: number } | undefined
    walk.frames.forEach((frame, index) => {
      const top = t.top + box.baseline - 1 - plantedSole(frame)[1]
      for (let shift = -MOST_SHIFT; shift <= MOST_SHIFT; shift++) {
        const origin = t.gridX - Math.round(meanSoleX(frame)) + shift
        const share = sharedShare(frame, origin, top, drawn)
        if (best === undefined || share < best.share) best = { index, origin, share }
      }
    })
    if (best === undefined || best.share > MOST_ENTER_MISMATCH) return
    playing = {
      view: t.choice.view,
      mirror: t.choice.mirror,
      index: best.index,
      phase: (best.index + PHASE_START) / walk.frames.length,
      origin: best.origin,
      waited: 0
    }
  }
  const advance = (p: Playing, gait: Gait, travelled: number): void => {
    const { frames } = facingWalk(gait.walk, p.mirror)
    p.phase = (p.phase + travelled * spritePerMetre / gait.stride) % 1
    const index = Math.floor(p.phase * frames.length)
    while (p.index !== index) {
      const next = (p.index + 1) % frames.length
      p.origin += travelBetween(frames[p.index], frames[next])
      p.index = next
    }
  }
  const draw = (t: Tick, p: Playing): void => {
    current = compose(p, t.gridX)
    last = silhouetteOfShown(current, t.top)
  }
  const rest = (): void => {
    playing = undefined
    current = undefined
    last = undefined
  }
  const idle = (t: Tick, gait: Gait | undefined): void => {
    if (gait === undefined || !hardOk(t) || !t.walker.moving) {
      last = undefined
      return
    }
    const cutout = t.cutout()
    if (softOk(t, gait, false)) enter(t, gait, last ?? cutout)
    last = cutout
    if (playing !== undefined) draw(t, playing)
  }
  const follow = (t: Tick, p: Playing, gait: Gait, cutout: Silhouette): void => {
    const { frames } = facingWalk(gait.walk, p.mirror)
    const count = frames.length
    const at = (offset: number): number => (p.index + offset + count) % count
    let best = { offset: 0, origin: p.origin, share: Infinity }
    for (let offset = -FOLLOW_TICKS; offset <= FOLLOW_TICKS; offset++) {
      let origin = p.origin
      for (let k = 0; k < offset; k++) origin += travelBetween(frames[at(k)], frames[at(k + 1)])
      for (let k = 0; k > offset; k--) origin -= travelBetween(frames[at(k - 1)], frames[at(k)])
      const frame = frames[at(offset)]
      const share = sharedShare(frame, origin, t.top + box.baseline - 1 - plantedSole(frame)[1], cutout)
      if (share < best.share) best = { offset, origin, share }
    }
    p.index = at(best.offset)
    p.origin = best.origin
    p.phase = (p.index + PHASE_START) / count
  }
  const playOn = (t: Tick, p: Playing, gait: Gait | undefined): void => {
    const own = gaits.get(p.view) as Gait
    const hard = hardOk(t)
    const wanted = hard && gait === own && softOk(t, gait, true) && t.choice.mirror === p.mirror
    advance(p, own, t.distance)
    p.waited = wanted ? 0 : p.waited + 1
    if (!wanted) {
      const cutout = t.cutout()
      const smooth = last !== undefined && changedShare(last, cutout) <= MOST_LEAVE_MISMATCH
      if (!hard || smooth || p.waited > MOST_WAIT_TICKS) {
        rest()
        last = cutout
        return
      }
      follow(t, p, own, cutout)
    }
    draw(t, p)
  }

  return {
    update: t => {
      const gait = gaits.get(t.choice.view)
      if (playing === undefined) idle(t, gait)
      else playOn(t, playing, gait)
    },
    shown: () => current,
    carry: gridShift => {
      if (playing === undefined) return
      playing.origin += gridShift
    },
    reset: rest
  }
}
