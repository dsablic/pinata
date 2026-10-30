import { gate } from '../../pocs/p4-locomotion/gates.ts'
import type { Mannequin, Part } from '../formats/mannequin.ts'
import { stride } from '../formats/rig.ts'
import type { Leg } from '../formats/rig.ts'
import type { Character } from '../formats/character.ts'
import { length, sub } from '../math/vec.ts'
import { kneeBendsBackward, kneeFlexionDegrees } from '../motion/ik.ts'
import * as metrics from '../motion/metrics.ts'
import type { Geometry, LocomotionRecording, SteadySegment } from '../motion/metrics.ts'
import { footRadii, restPose } from '../motion/pose.ts'
import type { Pose } from '../motion/pose.ts'
import type { CharacterRun } from '../motion/character.ts'
import type { Gate } from '../diagnostics/report.ts'
import type { Check } from './summary.ts'

const PIXEL_HEIGHT = 48
const PLANT_METRES = 0.02

type Measure = (geometry: Geometry, recording: LocomotionRecording) => number
type Worst = { leg: Leg, label: string, frame: number, value: number }
type Context = { character: Character, recording: LocomotionRecording, windows: SteadySegment[], mpp: number }

export function locomotionRecording (character: Character, run: CharacterRun): LocomotionRecording {
  const { mannequin, rig, scenario } = character
  return metrics.recordLocomotion(run.frames, { rig, rest: restPose(mannequin), mannequin, fps: scenario.fps })
}

export function walkingWindows (character: Character): SteadySegment[] {
  return metrics.steadySegments(character.scenario.script).filter(s => s.speed > 0)
}

function upTo (recording: LocomotionRecording, frame: number): LocomotionRecording {
  return { fps: recording.fps, frames: recording.frames.slice(Math.max(0, frame - 1), frame + 1) }
}

function firstWorstFrame (recording: LocomotionRecording, measure: (r: LocomotionRecording) => number): number {
  let best = 0
  let bestValue = -Infinity
  recording.frames.forEach((_, i) => {
    const value = measure(upTo(recording, i))
    if (value > bestValue) {
      best = i
      bestValue = value
    }
  })
  return best
}

function legGeometry (character: Character, leg: Leg): Geometry {
  return { rig: { ...character.rig, legs: [leg] }, mannequin: character.mannequin }
}

function worstLeg (ctx: Context, measure: Measure): Worst {
  const found = ctx.character.rig.legs.map(leg => {
    const geometry = legGeometry(ctx.character, leg)
    return { leg, geometry, value: measure(geometry, ctx.recording) }
  }).reduce((a, b) => b.value > a.value ? b : a)
  const frame = firstWorstFrame(ctx.recording, r => measure(found.geometry, r))
  return { leg: found.leg, label: `${found.leg.side} foot`, frame, value: found.value }
}

function at (ctx: Context, frame: number): string {
  return `frame ${frame} (t = ${(frame / ctx.recording.fps).toFixed(2)} s)`
}

function restSoles (character: Character, leg: Leg): string {
  const rest = restPose(character.mannequin)
  const radii = footRadii(leg, character.mannequin)
  const ankle = rest[leg.ankle][1] - radii.ankle
  const toe = rest[leg.toe][1] - radii.toe
  return `at rest the ankle sole point is at y = ${ankle.toFixed(3)} m and the toe sole point at ` +
    `y = ${toe.toFixed(3)} m`
}

function soleAdvice (ctx: Context, leg: Leg): string {
  const { ankle, toe } = leg
  return `${restSoles(ctx.character, leg)}; both should be 0. Set the '${ankle}' joint y to the foot capsule's ` +
    `radiusA and the '${toe}' joint y to its radiusB`
}

function soleOffsets (ctx: Context, leg: Leg): number {
  const rest = restPose(ctx.character.mannequin)
  const radii = footRadii(leg, ctx.character.mannequin)
  return Math.max(Math.abs(rest[leg.ankle][1] - radii.ankle), Math.abs(rest[leg.toe][1] - radii.toe))
}

function slideHint (ctx: Context): string {
  const worst = worstLeg(ctx, (g, r) => metrics.footSlidePx(r, g, ctx.mpp))
  const clamped = metrics.reachViolations(ctx.recording)
  const { gait } = ctx.character.rig
  const cause = soleOffsets(ctx, worst.leg) > PLANT_METRES / 2
    ? `The foot does not lie flat at rest, so the heel or toe rolls and moves: ${soleAdvice(ctx, worst.leg)}.`
    : `The foot is flat at rest, so the slide comes from the gait: shorten rig.gait.strideLength (now ` +
      `${gait.strideLength}) or footSpacing (now ${gait.footSpacing}), or lower stepHeight (now ${gait.stepHeight}).`
  const drag = clamped > 0 ? ` ${clamped} frames also have an unreachable foot target (see reachViolations).` : ''
  return `the ${worst.label} moves ${worst.value.toFixed(2)} px (at ${PIXEL_HEIGHT}px) in ${at(ctx, worst.frame)} ` +
    `while its sole is within 2 cm of the floor. A planted foot must not move. ${cause}${drag}`
}

function groundHint (ctx: Context): string {
  const worst = worstLeg(ctx, (g, r) => metrics.groundPenetrationPx(r, g, ctx.mpp))
  const metresDeep = worst.value * ctx.mpp
  return `the ${worst.label} sole goes ${worst.value.toFixed(2)} px (${metresDeep.toFixed(3)} m) below the floor in ` +
    `${at(ctx, worst.frame)}. ${soleAdvice(ctx, worst.leg)}, or reduce rig.gait.bobAmplitude ` +
    `(now ${ctx.character.rig.gait.bobAmplitude}).`
}

function nonFootParts (character: Character): Part[] {
  const { rig, mannequin } = character
  return mannequin.parts.filter(p => !(p.shape === 'capsule' && rig.legs.some(l => p.a === l.ankle && p.b === l.toe)))
}

function partGround (ctx: Context, mannequin: Mannequin): number {
  return metrics.partGroundPenetrationPx(ctx.recording, { mannequin, rig: ctx.character.rig, metresPerPixel: ctx.mpp })
}

function partGroundHint (ctx: Context): string {
  const { character } = ctx
  const worst = nonFootParts(character).map(part => {
    return { part, value: partGround(ctx, { ...character.mannequin, parts: [part] }) }
  }).reduce((a, b) => b.value > a.value ? b : a)
  const single = { ...character.mannequin, parts: [worst.part] }
  const frame = firstWorstFrame(ctx.recording, r => metrics.partGroundPenetrationPx(r, {
    mannequin: single, rig: character.rig, metresPerPixel: ctx.mpp
  }))
  const restFrame = { ...ctx.recording.frames[0], joints: restPose(character.mannequin) }
  const atRest = metrics.partGroundPenetrationPx({ fps: ctx.recording.fps, frames: [restFrame] }, {
    mannequin: single, rig: character.rig, metresPerPixel: ctx.mpp
  })
  const where = atRest > 0 ? `it is already ${(atRest * ctx.mpp).toFixed(3)} m below y = 0 at rest: raise its joints ` +
    `'${worst.part.a}' and '${worst.part.b}' in the mannequin` : 'it reaches the floor only while posed: raise its ' +
    `joints '${worst.part.a}' and '${worst.part.b}' in the mannequin, or reduce rig.gait.bobAmplitude and ` +
    'armSwingDegrees'
  return `part '${worst.part.name}' goes ${worst.value.toFixed(2)} px (${(worst.value * ctx.mpp).toFixed(3)} m) ` +
    `through the floor in ${at(ctx, frame)}; ${where}. Parts other than the feet must stay above y = 0.`
}

function reachHint (ctx: Context): string {
  const frames = ctx.recording.frames.map((f, i) => f.clamped > 0 ? i : -1).filter(i => i >= 0)
  const { gait } = ctx.character.rig
  const legs = ctx.character.rig.legs.map(leg => {
    const rest = restPose(ctx.character.mannequin)
    const total = length(sub(rest[leg.hip], rest[leg.knee])) + length(sub(rest[leg.knee], rest[leg.ankle]))
    return `${leg.side} ${total.toFixed(2)} m`
  }).join(', ')
  return `a foot target was out of the leg's reach in frames ${frames[0]} to ${frames[frames.length - 1]} (first at ` +
    `${at(ctx, frames[0])}), so the leg was straightened and clamped. Leg length hip to ankle: ${legs}. Shorten ` +
    `rig.gait.strideLength (now ${gait.strideLength}) or footSpacing (now ${gait.footSpacing}), lower bobAmplitude ` +
    `(now ${gait.bobAmplitude}), or lengthen the legs in the mannequin.`
}

function kneeProblem (ctx: Context, leg: Leg, frame: number): string {
  const f = ctx.recording.frames[frame]
  const [hip, knee, ankle] = [f.joints[leg.hip], f.joints[leg.knee], f.joints[leg.ankle]]
  const forward: [number, number, number] = [Math.sin(f.root.yaw), 0, Math.cos(f.root.yaw)]
  if (kneeBendsBackward(hip, knee, ankle, forward)) {
    return `the knee bends backwards there. In the mannequin the '${leg.knee}' joint must sit in front of (larger z ` +
      `than) the straight line from '${leg.hip}' to '${leg.ankle}' at rest`
  }
  const flexion = kneeFlexionDegrees(hip, knee, ankle)
  return `the knee flexion there is ${flexion.toFixed(0)} degrees, outside 0 to ${metrics.MAX_KNEE_FLEXION}. ` +
    `Lower rig.gait.stepHeight (now ${ctx.character.rig.gait.stepHeight}) or lengthen the legs`
}

function kneeLimitHint (ctx: Context): string {
  const worst = worstLeg(ctx, (g, r) => metrics.kneeLimitViolations(r, g))
  return `${worst.value} frames of the ${worst.label} violate the knee limits, first in ${at(ctx, worst.frame)}: ` +
    `${kneeProblem(ctx, worst.leg, worst.frame)}.`
}

function kneeSpeedHint (ctx: Context): string {
  const worst = worstLeg(ctx, (g, r) => metrics.kneeSpeedDegPerSec(r, g))
  const { gait } = ctx.character.rig
  return `the ${worst.label} knee flexes at ${worst.value.toFixed(0)} degrees/s in ${at(ctx, worst.frame)}, which ` +
    `reads as a pop. Lower rig.gait.stepHeight (now ${gait.stepHeight}) or lower stanceFraction (now ` +
    `${gait.stanceFraction}; a smaller value gives a longer, slower swing), or walk slower.`
}

function limbGeometries (character: Character): Array<{ label: string, geometry: Geometry }> {
  const { rig, mannequin } = character
  return [
    ...rig.legs.map(leg => {
      return { label: `${leg.side} leg`, geometry: { rig: { ...rig, legs: [leg], arms: [] }, mannequin } }
    }),
    ...rig.arms.map(arm => {
      return { label: `${arm.side} arm`, geometry: { rig: { ...rig, legs: [], arms: [arm] }, mannequin } }
    })
  ]
}

function boneHint (ctx: Context): string {
  const rest: Pose = restPose(ctx.character.mannequin)
  const worst = limbGeometries(ctx.character).map(l => {
    return { ...l, value: metrics.boneLengthError(ctx.recording, l.geometry, rest) }
  }).reduce((a, b) => b.value > a.value ? b : a)
  return `the ${worst.label} bones change length by ${(worst.value * 100).toFixed(1)}%. Two-bone IK preserves bone ` +
    'lengths, so a joint of this limb is also moved by something else (listed again in upperBody or carried) or ' +
    'two joints of the limb coincide in the mannequin, giving a zero-length bone.'
}

function windowText (w: SteadySegment): string {
  return `${w.start.toFixed(2)}-${w.end.toFixed(2)} s at ${w.speed} m/s`
}

function rootSpeedHint (ctx: Context): string {
  const { gait } = ctx.character.rig
  const bad = ctx.windows.map(w => ({ w, value: metrics.rootSpeedError(ctx.recording, geometryOf(ctx), [w]) }))
    .reduce((a, b) => b.value > a.value ? b : a)
  const cycle = stride(gait, bad.w.speed) / bad.w.speed
  const seconds = bad.w.end - bad.w.start
  const why = Number.isFinite(bad.value)
    ? `the feet advance ${(bad.value * 100).toFixed(1)}% differently from the script speed`
    : 'neither foot has two plants in it, so the speed cannot be measured'
  return `steady walking window ${windowText(bad.w)} (${seconds.toFixed(2)} s long): ${why}. One step cycle at ` +
    `this speed takes ${cycle.toFixed(2)} s (stride ${stride(gait, bad.w.speed).toFixed(2)} m), and the window needs ` +
    `at least two plants per foot: make this 'move' segment longer (at least ${(2.5 * cycle).toFixed(1)} s ` +
    `after accelSeconds ${ctx.character.scenario.script.accelSeconds}), or reduce rig.gait.strideLength ` +
    `(now ${gait.strideLength}).`
}

function geometryOf (ctx: Context): Geometry {
  return { rig: ctx.character.rig, mannequin: ctx.character.mannequin }
}

function alternationHint (ctx: Context): string {
  const g = geometryOf(ctx)
  const bad = ctx.windows.map(w => ({ w, value: metrics.alternationViolations(ctx.recording, g, [w]) }))
    .reduce((a, b) => b.value > a.value ? b : a)
  return `the same foot plants twice in a row ${bad.value} time(s) in steady window ${windowText(bad.w)}. A swing ` +
    `foot that rises less than ${PLANT_METRES * 100} cm still counts as planted: raise rig.gait.stepHeight (now ` +
    `${ctx.character.rig.gait.stepHeight}, it must clearly exceed ${PLANT_METRES} m) and keep stanceFraction (now ` +
    `${ctx.character.rig.gait.stanceFraction}) below 0.7.`
}

function unsupportedHint (ctx: Context): string {
  const frames = ctx.recording.frames.map((_, i) => i).filter(i => {
    return metrics.unsupportedFrames({ fps: ctx.recording.fps, frames: [ctx.recording.frames[i]] }, geometryOf(ctx)) > 0
  })
  const [first] = frames
  const leg = ctx.character.rig.legs[0]
  return `neither foot has a sole point within 2 cm of the floor in ${frames.length} frames, first in ` +
    `${at(ctx, first)}: the character hovers. Check the sole heights (${restSoles(ctx.character, leg)}), ` +
    `and lower rig.gait.stepHeight (now ${ctx.character.rig.gait.stepHeight}) or bobAmplitude (now ` +
    `${ctx.character.rig.gait.bobAmplitude}).`
}

function plantedGate (side: string, value: number): Gate {
  return {
    name: `plantedFrames.${side}`,
    value,
    op: '>=',
    threshold: 1,
    rationale: 'The foot must be planted at least once or the foot-slide gate measures nothing.'
  }
}

function plantedHint (ctx: Context, side: string): string {
  const leg = ctx.character.rig.legs.find(l => l.side === side) as Leg
  const lowest = Math.min(...ctx.recording.frames.flatMap(f => {
    return metrics.solePoints(f.joints, leg, ctx.character.mannequin).map(p => p[1])
  }))
  return `the ${side} foot never has a sole point within ${PLANT_METRES * 100} cm of the floor for two frames in a ` +
    `row; its lowest sole point is ${lowest.toFixed(3)} m above y = 0. ${soleAdvice(ctx, leg)}.`
}

export function locomotionChecks (character: Character, recording: LocomotionRecording): Check[] {
  const mpp = character.mannequin.height / PIXEL_HEIGHT
  const windows = walkingWindows(character)
  const ctx: Context = { character, recording, windows, mpp }
  const g = geometryOf(ctx)
  const rest = restPose(character.mannequin)
  const planted = metrics.plantedFrames(recording, g)
  const checks: Check[] = [
    { gate: gate('footSlidePx', metrics.footSlidePx(recording, g, mpp)), hint: () => slideHint(ctx) },
    {
      gate: gate('groundPenetrationPx', metrics.groundPenetrationPx(recording, g, mpp)),
      hint: () => groundHint(ctx)
    },
    {
      gate: gate('partGroundPenetrationPx', metrics.partGroundPenetrationPx(recording, {
        mannequin: character.mannequin, rig: character.rig, metresPerPixel: mpp
      })),
      hint: () => partGroundHint(ctx)
    },
    { gate: gate('reachViolations', metrics.reachViolations(recording)), hint: () => reachHint(ctx) },
    { gate: gate('kneeLimitViolations', metrics.kneeLimitViolations(recording, g)), hint: () => kneeLimitHint(ctx) },
    { gate: gate('kneeSpeedDegPerSec', metrics.kneeSpeedDegPerSec(recording, g)), hint: () => kneeSpeedHint(ctx) },
    { gate: gate('boneLengthError', metrics.boneLengthError(recording, g, rest)), hint: () => boneHint(ctx) },
    { gate: gate('rootSpeedError', metrics.rootSpeedError(recording, g, windows)), hint: () => rootSpeedHint(ctx) },
    { gate: gate('unsupportedFrames', metrics.unsupportedFrames(recording, g)), hint: () => unsupportedHint(ctx) },
    {
      gate: gate('alternationViolations', metrics.alternationViolations(recording, g, windows)),
      hint: () => alternationHint(ctx)
    }
  ]
  for (const side of ['left', 'right'] as const) {
    checks.push({ gate: plantedGate(side, planted[side]), hint: () => plantedHint(ctx, side) })
  }
  return checks
}
