import type { Mannequin } from '../formats/mannequin.ts'
import type { Rig } from '../formats/rig.ts'
import { scenarioDuration } from '../formats/sim.ts'
import type { Scenario, SimMaterial } from '../formats/sim.ts'
import { buildCape, buildChain, mergeSystems } from '../sim/cloth.ts'
import type { System } from '../sim/cloth.ts'
import { partsCollider, posedParts } from '../sim/body.ts'
import { createRecording, recordFrame } from '../sim/metrics.ts'
import type { Recording } from '../sim/metrics.ts'
import { step } from '../sim/solver.ts'
import { planGait } from './gait.ts'
import type { GaitFrame } from './gait.ts'
import { poseAt } from './locomotion.ts'
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
  recording: Recording
  system: System
  timing: { planSeconds: number, simulateSeconds: number }
}

function material (materials: SimMaterial[], name: string): SimMaterial {
  const found = materials.find(m => m.name === name)
  if (found === undefined) throw new Error(`unknown material '${name}'`)
  return found
}

function buildSystem (options: CharacterOptions): System {
  const { mannequin, scenario, materials } = options
  const systems: System[] = []
  if (scenario.cape !== undefined) {
    const cape = scenario.cape
    systems.push(buildCape(cape, mannequin, material(materials, cape.material)))
  }
  for (const chain of scenario.chains) {
    systems.push(buildChain(chain, mannequin, material(materials, chain.material)))
  }
  return mergeSystems(systems)
}

/**
 * Plans the gait for the scenario's script, poses every frame and simulates the scenario's cape and chains on the
 * posed body with the P3 conventions: `substeps` substeps per frame, frame 0 recorded before stepping. Frame i's
 * pose is held for the substeps that end in frame i. Poses are body-local; joints the rig does not move keep their
 * rest positions.
 */
export function simulateCharacter (options: CharacterOptions): CharacterRun {
  const { mannequin, rig, scenario } = options
  const fps = scenario.fps
  const planStart = performance.now()
  const track = createRootTrack(scenario.script)
  const rest = restPose(mannequin)
  const duration = scenarioDuration(scenario)
  const frames = planGait({ track, rig, rest, mannequin, duration, fps })
  const poses = frames.map(frame => ({ ...rest, ...poseAt({ frame, rig, rest, mannequin }).pose }))
  const simulateStart = performance.now()

  const system = buildSystem(options)
  const env = { gravity: scenario.gravity, wind: scenario.wind, particleRadius: scenario.particleRadius }
  const exclude = scenario.bodyExcludeParts
  const frameDt = 1 / fps
  const dt = frameDt / scenario.substeps
  const frameOf = (t: number): number => Math.min(frames.length - 1, Math.max(0, Math.ceil(t * fps - 1e-9)))
  const pose = (t: number): Pose => poses[frameOf(t)]
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
      step(system, { env, body: mannequin, exclude, track, pose, t: (k + 1) * dt, dt })
    }
    record(frame)
  }
  const end = performance.now()
  return {
    frames,
    poses,
    recording,
    system,
    timing: { planSeconds: (simulateStart - planStart) / 1000, simulateSeconds: (end - simulateStart) / 1000 }
  }
}
