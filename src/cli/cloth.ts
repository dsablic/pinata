import { gate } from '../../pocs/p3-secondary-motion/gates.ts'
import type { Character } from '../formats/character.ts'
import type { Vec3 } from '../math/vec.ts'
import type { CharacterRun } from '../motion/character.ts'
import { compile } from '../raster/gbuffer.ts'
import * as metrics from '../sim/metrics.ts'
import type { Recording } from '../sim/metrics.ts'
import type { Check } from './summary.ts'

const PIXEL_HEIGHT = 48
const START_FRAMES = 5
const BOTTOM_ROWS = 2
const LEG_JOINTS = ['knee', 'ankle', 'toe'] as const

type Context = { character: Character, run: CharacterRun }

export function hasCloth (character: Character): boolean {
  return character.scenario.cape !== undefined || character.scenario.chains.length > 0
}

function oneFrame (recording: Recording, frame: number): Recording {
  return { constraints: recording.constraints, frames: [recording.frames[frame]] }
}

function upTo (recording: Recording, frame: number): Recording {
  return { constraints: recording.constraints, frames: recording.frames.slice(Math.max(0, frame - 1), frame + 1) }
}

function firstWorstFrame (recording: Recording, measure: (r: Recording) => number, from = 0): number {
  let best = from
  let bestValue = -Infinity
  for (let i = from; i < recording.frames.length; i++) {
    const value = measure(upTo(recording, i))
    if (value > bestValue) {
      best = i
      bestValue = value
    }
  }
  return best
}

function at (ctx: Context, frame: number): string {
  return `frame ${frame} (t = ${(frame / ctx.character.scenario.fps).toFixed(2)} s)`
}

function particleName (character: Character, index: number): string {
  const { cape, chains } = character.scenario
  let rest = index
  if (cape !== undefined) {
    const count = cape.columns * cape.rows
    if (rest < count) {
      const row = Math.floor(rest / cape.columns)
      const column = rest % cape.columns
      return `cape row ${row} of ${cape.rows} (0 is the pinned top), column ${column} of ${cape.columns}`
    }
    rest -= count
  }
  for (const [i, chain] of chains.entries()) {
    if (rest <= chain.links) return `chains[${i}] (anchor '${chain.anchor}') particle ${rest} of ${chain.links}`
    rest -= chain.links + 1
  }
  return `particle ${index}`
}

function materialsOf (character: Character): string {
  const { cape, chains } = character.scenario
  const names = [...new Set([...(cape === undefined ? [] : [cape.material]), ...chains.map(c => c.material)])]
  return names.map(name => {
    const m = character.materials.find(x => x.name === name)
    return `'${name}' (stretchCompliance ${m?.stretchCompliance}, damping ${m?.damping}, ` +
      `particleMass ${m?.particleMass})`
  }).join(', ')
}

function nonFiniteHint (ctx: Context): string {
  const { recording } = ctx.run
  const frame = recording.frames.findIndex((_, i) => metrics.nonFinite(oneFrame(recording, i)) > 0)
  return `the cloth has NaN or infinite positions from ${at(ctx, frame)}: the solver diverged. Raise motion.json ` +
    `substeps (now ${ctx.character.scenario.substeps}, try double), raise damping, or make the cloth lighter or ` +
    `less stiff. Materials in use: ${materialsOf(ctx.character)}.`
}

function startsInside (ctx: Context, frame: number): string | undefined {
  const [first] = ctx.run.recording.frames
  const inside = first.penetration.some(d => d > 0) || first.linkPenetration.some(d => d > 0)
  if (!inside || frame >= START_FRAMES) return undefined
  const worst = deepest(ctx, 0)
  return `${worst.where} starts inside part '${nearestPart(ctx, 0, worst.point)}' ` +
    `(${(worst.depth * 1000).toFixed(0)} mm deep at frame 0), so the solver pushes it out violently`
}

function maxSpeedHint (ctx: Context): string {
  const { recording } = ctx.run
  const frame = firstWorstFrame(recording, r => metrics.maxSpeed(r), 1)
  const a = recording.frames[frame - 1]
  const b = recording.frames[frame]
  const dt = b.time - a.time
  let worst = 0
  let speed = 0
  for (let k = 0; k < b.positions.length / 3; k++) {
    const d = Math.hypot(b.positions[3 * k] - a.positions[3 * k], b.positions[3 * k + 1] - a.positions[3 * k + 1],
      b.positions[3 * k + 2] - a.positions[3 * k + 2]) / dt
    if (d > speed) {
      speed = d
      worst = k
    }
  }
  const inside = startsInside(ctx, frame)
  if (inside !== undefined) {
    return `${particleName(ctx.character, worst)} moves at ${speed.toFixed(1)} m/s in ${at(ctx, frame)}: ` +
      `${inside}. Move the cape anchors outward (away from the body) so the cloth starts clear of it.${anchorsOf(ctx)}`
  }
  return `${particleName(ctx.character, worst)} moves at ${speed.toFixed(1)} m/s in ${at(ctx, frame)}: the solver ` +
    `is injecting energy. Raise motion.json substeps (now ${ctx.character.scenario.substeps}), raise the material ` +
    `damping, or shorten the cape (a long light cloth whips). Materials in use: ${materialsOf(ctx.character)}.`
}

function maxStrainHint (ctx: Context): string {
  const { recording } = ctx.run
  if (metrics.nonFinite(recording) > 0) return 'the cloth positions are not finite; fix nonFinite first.'
  const worst = recording.constraints.map(c => {
    return { c, value: metrics.maxStrain({ constraints: [c], frames: recording.frames }) }
  }).reduce((a, b) => b.value > a.value ? b : a)
  const frame = firstWorstFrame({ ...recording, constraints: [worst.c] }, r => metrics.maxStrain(r))
  return `the link between ${particleName(ctx.character, worst.c.a)} and ${particleName(ctx.character, worst.c.b)} ` +
    `stretches ${(worst.value * 100).toFixed(1)}% in ${at(ctx, frame)}. Raise motion.json substeps (now ` +
    `${ctx.character.scenario.substeps}), lower stretchCompliance of the material, or reduce particleMass. ` +
    `Materials in use: ${materialsOf(ctx.character)}.`
}

function anchorsOf (ctx: Context): string {
  const { cape } = ctx.character.scenario
  return cape === undefined ? '' : ` Cape anchors: '${cape.anchorLeft}' and '${cape.anchorRight}'.`
}

function nearestPart (ctx: Context, frame: number, point: Vec3): string {
  const { mannequin, scenario } = ctx.character
  const root = ctx.run.frames[frame].root
  const pose = ctx.run.poses[frame]
  const posed = { ...mannequin, joints: pose }
  const [dx, dy, dz] = [point[0] - root.position[0], point[1] - root.position[1], point[2] - root.position[2]]
  const c = Math.cos(root.yaw)
  const s = Math.sin(root.yaw)
  const local: Vec3 = [dx * c - dz * s, dy, dx * s + dz * c]
  const candidates = mannequin.parts.filter(p => !scenario.bodyExcludeParts.includes(p.name))
  return candidates.map(part => ({ name: part.name, d: compile(posed, part).sdf(local) }))
    .reduce((a, b) => b.d < a.d ? b : a).name
}

type Deepest = { frame: number, depth: number, point: Vec3, where: string, row: number }

function capeRow (character: Character, index: number): number {
  const { cape } = character.scenario
  return cape !== undefined && index < cape.columns * cape.rows ? Math.floor(index / cape.columns) : -1
}

function deepest (ctx: Context, lastFrame = Infinity): Deepest {
  const { recording } = ctx.run
  let best: Deepest = { frame: 0, depth: -Infinity, point: [0, 0, 0], where: '', row: -1 }
  recording.frames.forEach((f, frame) => {
    if (frame > lastFrame) return
    f.penetration.forEach((depth, i) => {
      if (depth <= best.depth) return
      const p = f.positions
      const point: Vec3 = [p[3 * i], p[3 * i + 1], p[3 * i + 2]]
      best = { frame, depth, point, where: particleName(ctx.character, i), row: capeRow(ctx.character, i) }
    })
    f.linkPenetration.forEach((depth, i) => {
      if (depth <= best.depth) return
      const { a, b } = recording.constraints[i]
      const p = f.positions
      const mid = [0, 1, 2].map(k => (p[3 * a + k] + p[3 * b + k]) / 2) as Vec3
      const where = `the link between ${particleName(ctx.character, a)} and ${particleName(ctx.character, b)}`
      best = { frame, depth, point: mid, where, row: Math.max(capeRow(ctx.character, a), capeRow(ctx.character, b)) }
    })
  })
  return best
}

function isLegPart (ctx: Context, name: string): boolean {
  const part = ctx.character.mannequin.parts.find(p => p.name === name)
  const joints = ctx.character.rig.legs.flatMap(leg => LEG_JOINTS.map(f => leg[f]))
  return part !== undefined && (joints.includes(part.a) || joints.includes(part.b))
}

function legHit (ctx: Context, worst: Deepest, part: string): string {
  const { cape } = ctx.character.scenario
  if (cape === undefined || worst.row < cape.rows - BOTTOM_ROWS || !isLegPart(ctx, part)) return ''
  return `The bottom rows of the cape hang into '${part}': the cloth has no floor or leg-sweep collision of its ` +
    `own, so shorten cape.length (now ${cape.length}) until the hem stays above the legs. `
}

function penetrationHint (ctx: Context, limit: number): string {
  const { recording } = ctx.run
  const hits = recording.frames.map((f, i) => {
    return f.penetration.some(d => d > limit) || f.linkPenetration.some(d => d > limit) ? i : -1
  }).filter(i => i >= 0)
  const worst = deepest(ctx)
  const part = nearestPart(ctx, worst.frame, worst.point)
  const { cape, bodyExcludeParts } = ctx.character.scenario
  const anchors = anchorsOf(ctx)
  return `${legHit(ctx, worst, part)}${hits.length} of ${recording.frames.length} frames have cloth inside the ` +
    `body (first ${at(ctx, hits[0])}, ` +
    `last frame ${hits[hits.length - 1]}); deepest is ${worst.where} at ${at(ctx, worst.frame)}, ` +
    `${(worst.depth * 1000).toFixed(0)} mm in part '${part}'. If '${part}' is a stand-in for the cloth, list it ` +
    'in motion.json exclude ' +
    `(now [${bodyExcludeParts.map(n => `'${n}'`).join(', ')}]); otherwise move the anchors outward ` +
    `or lengthen the cloth so it hangs clear of the body.${anchors}`
}

export function clothChecks (character: Character, run: CharacterRun): Check[] {
  const ctx = { character, run }
  const { recording } = run
  const limit = 0.5 * character.mannequin.height / PIXEL_HEIGHT
  return [
    { gate: gate('nonFinite', metrics.nonFinite(recording)), hint: () => nonFiniteHint(ctx) },
    { gate: gate('maxSpeed', metrics.maxSpeed(recording)), hint: () => maxSpeedHint(ctx) },
    { gate: gate('maxStrain', metrics.maxStrain(recording)), hint: () => maxStrainHint(ctx) },
    {
      gate: gate('penetratingFrames', metrics.penetratingFrames(recording, limit)),
      hint: () => penetrationHint(ctx, limit)
    }
  ]
}
