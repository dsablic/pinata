import type { Mannequin } from '../formats/mannequin.ts'
import type { Rig } from '../formats/rig.ts'
import { scenarioDuration } from '../formats/sim.ts'
import type { Scenario, SimMaterial } from '../formats/sim.ts'
import { buildClothSystem } from '../sim/cloth.ts'
import type { System } from '../sim/cloth.ts'
import { partsCollider, posedParts } from '../sim/body.ts'
import { createRecording, recordFrame } from '../sim/metrics.ts'
import type { Recording } from '../sim/metrics.ts'
import { step } from '../sim/solver.ts'
import { planGait } from './gait.ts'
import type { GaitFrame } from './gait.ts'
import { poseSequence } from './sequence.ts'
import type { Transforms } from './skeleton.ts'
import { restPose } from './pose.ts'
import type { Pose } from './pose.ts'
import { createRootTrack } from './script.ts'

export type CharacterOptions = {
  mannequin: Mannequin
  rig: Rig
  scenario: Scenario
  materials: SimMaterial[]
}

export type CharacterRun = {
  frames: GaitFrame[]
  poses: Pose[]
  transforms: Transforms[]
  recording: Recording
  system: System
  timing: { planSeconds: number, simulateSeconds: number }
}

export function simulateCharacter (options: CharacterOptions): CharacterRun {
  const { mannequin, rig, scenario } = options
  const fps = scenario.fps
  const planStart = performance.now()
  const track = createRootTrack(scenario.script)
  const rest = restPose(mannequin)
  const duration = scenarioDuration(scenario)
  const frames = planGait({ track, rig, rest, mannequin, duration, fps })
  const posed = poseSequence(frames, { rig, rest, mannequin, fps, substeps: scenario.substeps })
  const poses = posed.poses.map(pose => ({ ...rest, ...pose }))
  const { transforms } = posed
  const simulateStart = performance.now()

  const system = buildClothSystem(options)
  const env = { gravity: scenario.gravity, wind: scenario.wind, particleRadius: scenario.particleRadius }
  const exclude = scenario.bodyExcludeParts
  const frameDt = 1 / fps
  const dt = frameDt / scenario.substeps
  const frameOf = (t: number): number => Math.min(frames.length - 1, Math.max(0, Math.ceil(t * fps - 1e-9)))
  const pose = (t: number): Pose => poses[frameOf(t)]
  const turns = (t: number): Transforms => transforms[frameOf(t)]
  const recording = createRecording(system)
  const record = (frame: number): void => {
    const root = track(frame * frameDt)
    const { distance } = partsCollider(posedParts(mannequin, exclude, poses[frame]), root)
    recordFrame(recording, {
      time: frame * frameDt, root, particles: system.particles, distance, particleRadius: scenario.particleRadius
    })
  }
  record(0)
  for (let frame = 1; frame < frames.length; frame++) {
    for (let s = 0; s < scenario.substeps; s++) {
      const k = (frame - 1) * scenario.substeps + s
      step(system, { env, body: mannequin, exclude, track, pose, transforms: turns, t: (k + 1) * dt, dt })
    }
    record(frame)
  }
  const end = performance.now()
  return {
    frames,
    poses,
    transforms,
    recording,
    system,
    timing: { planSeconds: (simulateStart - planStart) / 1000, simulateSeconds: (end - simulateStart) / 1000 }
  }
}
