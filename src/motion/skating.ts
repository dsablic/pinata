import { stride } from '../formats/rig.ts'
import type { Vec3 } from '../math/vec.ts'
import { toWorld } from '../sim/body.ts'
import { planGait } from './gait.ts'
import type { FootState, GaitFrame } from './gait.ts'
import { soleHeight } from './pose.ts'

type Options = Parameters<typeof planGait>[0]

/**
 * Control: the planned gait with the feet placed relative to the root every frame. Each ankle swings forward and
 * back by stride / 4 * sin(2 pi phase) under its hip and lifts while it moves forward relative to the body, so
 * nothing is planted in world space. Root, pelvis, arms and phase come from the planner unchanged.
 */
export function planSkating (options: Options): GaitFrame[] {
  const { rig, rest, mannequin } = options
  const { gait } = rig
  return planGait(options).map(frame => {
    const speed = Math.hypot(frame.root.velocity[0], frame.root.velocity[2])
    const amplitude = stride(gait, speed) / 4
    const feet = rig.legs.map((leg): FootState => {
      const phase = frame.phase + (leg.side === 'left' ? 0 : 0.5)
      const wave = Math.sin(2 * Math.PI * phase)
      const lift = Math.max(0, Math.cos(2 * Math.PI * phase))
      const home = rest[leg.ankle]
      const height = home[1] - soleHeight(leg, rest, mannequin) + gait.stepHeight * lift
      const local: Vec3 = [home[0], height, home[2] + amplitude * wave]
      const ankle = toWorld(local, frame.root)
      return { side: leg.side, ankle, toeYaw: frame.root.yaw, planted: false, lift, toePitch: lift }
    })
    return { ...frame, feet }
  })
}
