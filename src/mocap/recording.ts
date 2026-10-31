import type { LocomotionRecording } from '../motion/metrics.ts'
import { legLabels } from '../motion/pose.ts'
import type { Pose } from '../motion/pose.ts'
import { toWorld } from '../sim/body.ts'
import type { RetargetedFrame, RetargetOptions } from './retarget.ts'

export function retargetedRecording (
  frames: RetargetedFrame[],
  options: RetargetOptions & { fps: number }
): LocomotionRecording {
  const labels = legLabels(options.rig, options.rest)
  return {
    fps: options.fps,
    frames: frames.map((frame, i) => {
      const joints: Pose = {}
      for (const [name, local] of Object.entries({ ...options.rest, ...frame.pose })) {
        joints[name] = toWorld(local, frame.root)
      }
      const planted = Object.fromEntries(labels.map((label, k) => [label, frame.contact[k]]))
      return { time: i / options.fps, root: frame.root, joints, clamped: 0, planted }
    })
  }
}
