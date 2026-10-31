import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Mannequin } from '../src/formats/mannequin.ts'
import type { Rig } from '../src/formats/rig.ts'
import type { Vec3 } from '../src/math/vec.ts'
import * as metrics from '../src/motion/metrics.ts'
import type { LocomotionRecording } from '../src/motion/metrics.ts'
import { validateWorldConfig } from '../src/world/config.ts'
import type { CastMember, World, WorldFrame } from '../src/world/world.ts'
import { character, readJson } from './mocap-fixtures.ts'

export const FPS = 24
export const showcaseConfig = validateWorldConfig(readJson('site/world.json')).value!

export function plainCast (): CastMember[] {
  return showcaseConfig.cast.map(name => {
    const { mannequin, rig } = character(name)
    return { name, mannequin, rig }
  })
}

export function bundleMembers (): Array<Record<string, unknown> & { name: string }> {
  return showcaseConfig.cast.map(name => {
    const dir = join('examples', name)
    const read = (file: string): unknown => readJson(join(dir, file))
    const skin = existsSync(join(dir, 'skin.json')) ? { skin: read('skin.json') } : {}
    return { name, mannequin: read('mannequin.json'), style: read('style.json'), rig: read('rig.json'), ...skin }
  })
}

export function run (world: World, frames: number, each?: (frame: number) => void): WorldFrame[] {
  return Array.from({ length: frames }, (_, i) => {
    each?.(i)
    return world.step()
  })
}

export function activityStarts (frames: WorldFrame[], k: number): string[] {
  const activities = frames.map(f => f.actors[k].activity)
  return activities.filter((a, i) => i === 0 || a !== activities[i - 1] || frames[i].actors[k].handover)
}

export function distanceAlongX (frames: WorldFrame[], k: number): number {
  let moved = 0
  for (let i = 1; i < frames.length; i++) {
    moved += Math.abs(frames[i].actors[k].root.position[0] - frames[i - 1].actors[k].root.position[0])
  }
  return moved
}

export function actorRecording (frames: WorldFrame[], k: number): LocomotionRecording {
  return {
    fps: FPS,
    frames: frames.map(f => {
      const actor = f.actors[k]
      return { time: f.time, root: actor.root, joints: actor.joints, clamped: 0, planted: {} }
    })
  }
}

export function aboveGround (
  recording: LocomotionRecording,
  ground: (x: number, z: number) => number
): LocomotionRecording {
  return {
    fps: recording.fps,
    frames: recording.frames.map(frame => ({
      ...frame,
      joints: Object.fromEntries(Object.entries(frame.joints).map(([name, p]): [string, Vec3] => {
        return [name, [p[0], p[1] - ground(p[0], p[2]), p[2]]]
      }))
    }))
  }
}

export function assertFeetStay (
  relative: LocomotionRecording,
  geometry: { rig: Rig, mannequin: Mannequin },
  metresPerPixel: number,
  where: string
): void {
  const slide = metrics.footSlidePx(relative, geometry, metresPerPixel)
  const penetration = metrics.groundPenetrationPx(relative, geometry, metresPerPixel)
  assert.ok(slide <= 0.25, `${where}: slide ${slide} px`)
  assert.ok(penetration <= 0.5, `${where}: penetration ${penetration} px`)
}
