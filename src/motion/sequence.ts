import type { Mannequin } from '../formats/mannequin.ts'
import type { Rig } from '../formats/rig.ts'
import { animateAppendages, DEFAULT_APPENDAGE_SUBSTEPS } from './appendages.ts'
import type { GaitFrame } from './gait.ts'
import { poseAt } from './locomotion.ts'
import type { Pose } from './pose.ts'
import type { Transforms } from './skeleton.ts'

export type PosedSequence = { poses: Pose[], transforms: Transforms[], clamped: number[] }
type Options = { rig: Rig, rest: Pose, mannequin: Mannequin, fps: number, substeps?: number }

/**
 * Body-local poses and transforms of every frame: each frame posed on its own (poseAt), then the appendage springs
 * run over the whole sequence at `substeps` steps per frame (default 8).
 */
export function poseSequence (frames: GaitFrame[], options: Options): PosedSequence {
  const { rig, rest, mannequin, fps } = options
  const posed = frames.map(frame => poseAt({ frame, rig, rest, mannequin }))
  const sequence = { frames, poses: posed.map(p => p.pose), transforms: posed.map(p => p.transforms) }
  animateAppendages(sequence, { rig, rest, fps, substeps: options.substeps ?? DEFAULT_APPENDAGE_SUBSTEPS })
  return { poses: sequence.poses, transforms: sequence.transforms, clamped: posed.map(p => p.clamped) }
}
