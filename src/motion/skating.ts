import { stride } from '../formats/rig.ts'
import { length, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { toWorld } from '../sim/body.ts'
import { planGait } from './gait.ts'
import type { FootState, GaitFrame } from './gait.ts'
import { soleHeight } from './pose.ts'

const PHASE_SHIFT = 0.25
const REACH_FRACTION = 0.98

type Options = Parameters<typeof planGait>[0]

/**
 * Control: the planned gait with the feet placed relative to the root every frame. Each ankle swings forward and
 * back by stride / 4 * sin(2 pi (phase + 1/4)) under its hip and lifts while it moves forward relative to the
 * body, so nothing is planted in world space. The quarter-cycle shift puts the foot cycle in step with the
 * planner's pelvis bob, and the ankle stays within the leg's reach of the bobbing hip so the legs are never locked
 * straight. Root, pelvis, arms and phase come from the planner unchanged.
 */
export function planSkating (options: Options): GaitFrame[] {
  const { rig, rest, mannequin } = options
  const { gait } = rig
  return planGait(options).map(frame => {
    const speed = Math.hypot(frame.root.velocity[0], frame.root.velocity[2])
    const amplitude = stride(gait, speed) / 4
    const feet = rig.legs.map((leg): FootState => {
      const phase = frame.phase + (leg.side === 'left' ? 0 : 0.5) + PHASE_SHIFT
      const wave = Math.sin(2 * Math.PI * phase)
      const lift = Math.max(0, Math.cos(2 * Math.PI * phase))
      const home = rest[leg.ankle]
      const height = home[1] - soleHeight(leg, rest, mannequin) + gait.stepHeight * lift
      const hip = rest[leg.hip]
      const legLength = length(sub(rest[leg.knee], hip)) + length(sub(rest[leg.ankle], rest[leg.knee]))
      const reach = legLength * REACH_FRACTION
      const drop = hip[1] + frame.pelvisOffset[1] - height
      const room = Math.sqrt(Math.max(0, reach * reach - drop * drop - (home[0] - hip[0]) ** 2))
      const swing = Math.max(-room, Math.min(room, home[2] - hip[2] + amplitude * wave))
      const local: Vec3 = [home[0], height, hip[2] + swing]
      const ankle = toWorld(local, frame.root)
      return { side: leg.side, ankle, toeYaw: frame.root.yaw, planted: false, lift, toePitch: lift }
    })
    return { ...frame, feet }
  })
}
