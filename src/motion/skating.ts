import { legPhases, legsOf, stride } from '../formats/rig.ts'
import type { Vec3 } from '../math/vec.ts'
import { toWorld } from '../sim/body.ts'
import { horizontalSpeed, planGait } from './gait.ts'
import type { FootState, GaitFrame } from './gait.ts'
import { chainLength, soleHeight } from './pose.ts'

const PHASE_SHIFT = 0.25
const REACH_FRACTION = 0.98

type Options = Parameters<typeof planGait>[0]

export function planSkating (options: Options): GaitFrame[] {
  const { rig, rest, mannequin } = options
  const { gait } = rig
  const phases = legPhases(rig)
  return planGait(options).map(frame => {
    const amplitude = stride(gait, horizontalSpeed(frame.root)) / 4
    const feet = legsOf(rig).map((leg, index): FootState => {
      const phase = frame.phase + phases[index] + PHASE_SHIFT
      const wave = Math.sin(2 * Math.PI * phase)
      const lift = Math.max(0, Math.cos(2 * Math.PI * phase))
      const home = rest[leg.ankle]
      const height = home[1] - soleHeight(leg, rest, mannequin) + gait.stepHeight * lift
      const hip = rest[leg.hip]
      const legLength = chainLength(leg.chain, rest)
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
