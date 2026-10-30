import { gate } from '../../pocs/p4-locomotion/gates.ts'
import type { Mannequin, Part } from '../formats/mannequin.ts'
import { armsOf, legBend, legPhases, legsOf, stride, withLimbs } from '../formats/rig.ts'
import type { Leg } from '../formats/rig.ts'
import type { Character } from '../formats/character.ts'
import { length, sub } from '../math/vec.ts'
import { kneeBendsBackward, kneeFlexionDegrees } from '../motion/ik.ts'
import * as metrics from '../motion/metrics.ts'
import type { Geometry, LocomotionRecording, SteadySegment } from '../motion/metrics.ts'
import { footRadii, legLabels, restPose } from '../motion/pose.ts'
import type { Pose } from '../motion/pose.ts'
import type { CharacterRun } from '../motion/character.ts'
import type { Check } from './summary.ts'

const PIXEL_HEIGHT = 48
const PLANT_METRES = 0.02
const STEP_HEIGHT_FACTOR = 0.15
const MIN_STEP_FACTOR = 0.1
const TILT_METRES = 0.01

type Measure = (geometry: Geometry, recording: LocomotionRecording) => number
type Worst = { leg: Leg, label: string, frame: number, value: number }
type Limb = 'foot' | 'leg'
type Context = {
  character: Character
  recording: LocomotionRecording
  windows: SteadySegment[]
  mpp: number
  labels: string[]
}

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
  const { rig, mannequin } = character
  return { rig: withLimbs(rig, rig.limbs.filter(l => l.kind !== 'leg' || l === leg.limb)), mannequin }
}

function worstLeg (ctx: Context, measure: Measure, limb: Limb = 'foot'): Worst {
  const found = legsOf(ctx.character.rig).map((leg, index) => {
    const geometry = legGeometry(ctx.character, leg)
    return { leg, index, geometry, value: measure(geometry, ctx.recording) }
  }).reduce((a, b) => b.value > a.value ? b : a)
  const frame = firstWorstFrame(ctx.recording, r => measure(found.geometry, r))
  return { leg: found.leg, label: `${ctx.labels[found.index]} ${limb}`, frame, value: found.value }
}

function at (ctx: Context, frame: number): string {
  return `frame ${frame} (t = ${(frame / ctx.recording.fps).toFixed(2)} s)`
}

function legLength (character: Character, leg: Leg): number {
  const rest = restPose(character.mannequin)
  return rest[leg.hip][1] - rest[leg.ankle][1]
}

function tiltOf (character: Character, leg: Leg): { ankle: number, toe: number, tilt: number, toeY: number } {
  const rest = restPose(character.mannequin)
  const radii = footRadii(leg, character.mannequin)
  const ankle = rest[leg.ankle][1] - radii.ankle
  const toe = rest[leg.toe][1] - radii.toe
  return { ankle, toe, tilt: toe - ankle, toeY: ankle + radii.toe }
}

function isTilted (character: Character, leg: Leg): boolean {
  return Math.abs(tiltOf(character, leg).tilt) > TILT_METRES
}

function soleAdvice (ctx: Context, leg: Leg): string {
  const { ankle, toe, tilt, toeY } = tiltOf(ctx.character, leg)
  return `at rest the ankle sole point (ankle y - radiusA) is at y = ${ankle.toFixed(3)} m and the toe sole point ` +
    `(toe y - radiusB) at y = ${toe.toFixed(3)} m, so the foot is tilted by ${Math.abs(tilt).toFixed(3)} m; the two ` +
    `must be equal (the absolute height does not matter, the gait grounds the lowest point). Set the '${leg.toe}' ` +
    `joint y to ${toeY.toFixed(3)}, or change the foot capsule radii or the '${leg.ankle}' joint y to match`
}

function stepAdvice (ctx: Context, leg: Leg): string {
  const { stepHeight } = ctx.character.rig.gait
  const length = legLength(ctx.character, leg)
  const suggested = Math.max(STEP_HEIGHT_FACTOR * length, 1.25 * stepHeight)
  return `raise rig.gait.stepHeight (now ${stepHeight}, try ${suggested.toFixed(3)}; the usual start is ` +
    `${STEP_HEIGHT_FACTOR} x the ${length.toFixed(2)} m leg length). Raising it raises knee speed, which a lower ` +
    'stanceFraction offsets'
}

function capitalise (text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function nearTransition (ctx: Context, worst: Worst): boolean {
  const geometry = legGeometry(ctx.character, worst.leg)
  return metrics.plantedRuns(ctx.recording, geometry).some(run => {
    return run.start <= worst.frame && worst.frame <= run.end &&
      (worst.frame - run.start <= 1 || run.end - worst.frame <= 1)
  })
}

function slideHint (ctx: Context): string {
  const worst = worstLeg(ctx, (g, r) => metrics.footSlidePx(r, g, ctx.mpp))
  const clamped = metrics.reachViolations(ctx.recording)
  const { gait } = ctx.character.rig
  const low = gait.stepHeight < MIN_STEP_FACTOR * legLength(ctx.character, worst.leg)
  let cause: string
  if (isTilted(ctx.character, worst.leg)) {
    cause = `The foot is not level at rest, so the heel or toe rolls and moves: ${soleAdvice(ctx, worst.leg)}.`
  } else if (low || nearTransition(ctx, worst)) {
    const where = low
      ? `stepHeight is below ${MIN_STEP_FACTOR} x the leg length`
      : 'the slide happens within a frame of lift-off or touch-down, where the foot is still close to the floor'
    cause = `The foot is level at rest and ${where}: ${stepAdvice(ctx, worst.leg)}.`
  } else {
    cause = `The foot is level at rest, so the slide comes from the gait: ${stepAdvice(ctx, worst.leg)}; changing ` +
      `strideLength (now ${gait.strideLength}) or footSpacing (now ${gait.footSpacing}) is less reliable.`
  }
  const drag = clamped > 0 ? ` ${clamped} frames also have an unreachable foot target (see reachViolations).` : ''
  return `the ${worst.label} moves ${worst.value.toFixed(2)} px (at ${PIXEL_HEIGHT}px) in ${at(ctx, worst.frame)} ` +
    `while its sole is within 2 cm of the floor. A planted foot must not move. ${cause}${drag}`
}

function groundCause (ctx: Context, leg: Leg): string {
  return isTilted(ctx.character, leg) ? `The foot is not level: ${soleAdvice(ctx, leg)}. ` : ''
}

function groundHint (ctx: Context): string {
  const worst = worstLeg(ctx, (g, r) => metrics.groundPenetrationPx(r, g, ctx.mpp))
  const metresDeep = worst.value * ctx.mpp
  return `the ${worst.label} sole goes ${worst.value.toFixed(2)} px (${metresDeep.toFixed(3)} m) below the floor in ` +
    `${at(ctx, worst.frame)}. ${groundCause(ctx, worst.leg)}Otherwise reduce rig.gait.bobAmplitude ` +
    `(now ${ctx.character.rig.gait.bobAmplitude}).`
}

function nonFootParts (character: Character): Part[] {
  const { rig, mannequin } = character
  const legs = legsOf(rig)
  return mannequin.parts.filter(p => !(p.shape === 'capsule' && legs.some(l => p.a === l.ankle && p.b === l.toe)))
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
  const ends = [...new Set([worst.part.a, worst.part.b])].map(j => `'${j}'`).join(' and ')
  const joints = `${worst.part.a === worst.part.b ? 'joint' : 'joints'} ${ends}`
  const where = atRest > 0 ? `it is already ${(atRest * ctx.mpp).toFixed(3)} m below y = 0 at rest: raise its ` +
    `${joints} in the mannequin` : `it reaches the floor only while posed: raise its ${joints} in the mannequin, or ` +
    'reduce rig.gait.bobAmplitude and armSwingDegrees'
  return `part '${worst.part.name}' goes ${worst.value.toFixed(2)} px (${(worst.value * ctx.mpp).toFixed(3)} m) ` +
    `through the floor in ${at(ctx, frame)}; ${where}. Parts other than the feet must stay above y = 0.`
}

function reachHint (ctx: Context): string {
  const frames = ctx.recording.frames.map((f, i) => f.clamped > 0 ? i : -1).filter(i => i >= 0)
  const { gait } = ctx.character.rig
  const legs = legsOf(ctx.character.rig).map((leg, index) => {
    const rest = restPose(ctx.character.mannequin)
    const total = length(sub(rest[leg.hip], rest[leg.knee])) + length(sub(rest[leg.knee], rest[leg.ankle]))
    return `${ctx.labels[index]} ${total.toFixed(2)} m`
  }).join(', ')
  return `a foot target was out of the leg's reach in frames ${frames[0]} to ${frames[frames.length - 1]} (first at ` +
    `${at(ctx, frames[0])}), so the leg was straightened and clamped. Leg length hip to ankle: ${legs}. Shorten ` +
    `rig.gait.strideLength (now ${gait.strideLength}) or footSpacing (now ${gait.footSpacing}), lower bobAmplitude ` +
    `(now ${gait.bobAmplitude}), or lengthen the legs in the mannequin.`
}

function kneeProblem (ctx: Context, leg: Leg, frame: number): string {
  const f = ctx.recording.frames[frame]
  const [hip, knee, ankle] = [f.joints[leg.hip], f.joints[leg.knee], f.joints[leg.ankle]]
  const sign = legBend(leg) === 'backward' ? -1 : 1
  const direction: [number, number, number] = [sign * Math.sin(f.root.yaw), 0, sign * Math.cos(f.root.yaw)]
  if (kneeBendsBackward(hip, knee, ankle, direction)) {
    return `the knee bends the wrong way there: this leg has bend '${legBend(leg)}', so its knee must point ` +
      `${legBend(leg)}; check that '${leg.hip}', '${leg.knee}' and '${leg.ankle}' are three distinct joints, that ` +
      `the rest pose has the knee on that side of the hip-ankle line (or set the leg's bend to match it), and ` +
      'that the leg is not folded'
  }
  const flexion = kneeFlexionDegrees(hip, knee, ankle)
  return `the knee flexion there is ${flexion.toFixed(0)} degrees, outside 0 to ${metrics.MAX_KNEE_FLEXION}. ` +
    `Lower rig.gait.stepHeight (now ${ctx.character.rig.gait.stepHeight}) or lengthen the legs`
}

function kneeLimitHint (ctx: Context): string {
  const worst = worstLeg(ctx, (g, r) => metrics.kneeLimitViolations(r, g), 'leg')
  const total = metrics.kneeLimitViolations(ctx.recording, geometryOf(ctx))
  return `${total} knee-frames over all legs violate the knee limits, ${worst.value} of them in the ${worst.label}, ` +
    `first in ${at(ctx, worst.frame)}: ${kneeProblem(ctx, worst.leg, worst.frame)}.`
}

function kneeSpeedHint (ctx: Context): string {
  const worst = worstLeg(ctx, (g, r) => metrics.kneeSpeedDegPerSec(r, g), 'leg')
  const { gait } = ctx.character.rig
  return `the ${worst.label} knee flexes at ${worst.value.toFixed(0)} degrees/s in ${at(ctx, worst.frame)}, which ` +
    `reads as a pop. Lower rig.gait.stanceFraction (now ${gait.stanceFraction}, minimum 0.5; a smaller value gives a ` +
    `longer, slower swing) or lengthen strideLength (now ${gait.strideLength}). A higher stepHeight (now ` +
    `${gait.stepHeight}) raises knee speed, but lowering it can bring back foot slide; walking slower does not ` +
    'reliably help.'
}

function limbGeometries (ctx: Context): Array<{ label: string, geometry: Geometry }> {
  const { character } = ctx
  const { rig, mannequin } = character
  return [
    ...legsOf(rig).map((leg, index) => {
      return { label: `${ctx.labels[index]} leg`, geometry: { rig: withLimbs(rig, [leg.limb]), mannequin } }
    }),
    ...armsOf(rig).map(arm => {
      return { label: `${arm.side} arm`, geometry: { rig: withLimbs(rig, [arm.limb]), mannequin } }
    })
  ]
}

function boneHint (ctx: Context): string {
  const rest: Pose = restPose(ctx.character.mannequin)
  const worst = limbGeometries(ctx).map(l => {
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
  const accel = ctx.character.scenario.script.accelSeconds
  const head = `steady walking window ${windowText(bad.w)} (${seconds.toFixed(2)} s long)`
  if (!Number.isFinite(bad.value) && seconds >= 2.5 * cycle) {
    return `${head}: the window is long enough (one step cycle takes ${cycle.toFixed(2)} s), but a foot has fewer ` +
      'than two plants in it: the feet never rise above 2 cm, so each counts as planted the whole time. ' +
      `${capitalise(stepAdvice(ctx, legsOf(ctx.character.rig)[0]))}.`
  }
  const why = Number.isFinite(bad.value)
    ? `the feet advance ${(bad.value * 100).toFixed(1)}% differently from the script speed`
    : 'neither foot has two plants in it, so the speed cannot be measured'
  return `${head}: ${why}. One step cycle at this speed takes ${cycle.toFixed(2)} s (stride ` +
    `${stride(gait, bad.w.speed).toFixed(2)} m), and the window needs at least two plants per foot: make this ` +
    `'move' segment longer (at least ${(accel + 2.5 * cycle).toFixed(1)} s in total: accelSeconds ${accel} plus 2.5 ` +
    `cycles), or reduce rig.gait.strideLength (now ${gait.strideLength}).`
}

function geometryOf (ctx: Context): Geometry {
  return { rig: ctx.character.rig, mannequin: ctx.character.mannequin }
}

function alternationHint (ctx: Context): string {
  const g = geometryOf(ctx)
  const bad = ctx.windows.map(w => ({ w, value: metrics.alternationViolations(ctx.recording, g, [w]) }))
    .reduce((a, b) => b.value > a.value ? b : a)
  const phases = legPhases(ctx.character.rig)
  const order = phases.map((_, i) => i).sort((a, b) => phases[a] - phases[b] || a - b).map(i => ctx.labels[i])
  return `${bad.value} plant(s) in steady window ${windowText(bad.w)} did not belong to the leg whose phase comes ` +
    `next after the previous plant's leg (phase order: ${order.join(', ')}); with two legs, the same foot planted ` +
    'twice in a row. A swing foot that rises less than ' +
    `${PLANT_METRES * 100} cm still counts as planted: raise rig.gait.stepHeight (now ` +
    `${ctx.character.rig.gait.stepHeight}, it must clearly exceed ${PLANT_METRES} m) and keep stanceFraction (now ` +
    `${ctx.character.rig.gait.stanceFraction}) below 0.7 for two legs; for four legs check the leg phases ` +
    'against the walk order.'
}

function unsupportedHint (ctx: Context): string {
  const frames = ctx.recording.frames.map((_, i) => i).filter(i => {
    return metrics.unsupportedFrames({ fps: ctx.recording.fps, frames: [ctx.recording.frames[i]] }, geometryOf(ctx)) > 0
  })
  const [first] = frames
  const leg = legsOf(ctx.character.rig)[0]
  return `no foot has a sole point within 2 cm of the floor in ${frames.length} frames, first in ` +
    `${at(ctx, first)}: the character hovers. ${groundCause(ctx, leg)}Otherwise lower rig.gait.bobAmplitude (now ` +
    `${ctx.character.rig.gait.bobAmplitude}) or stepHeight (now ${ctx.character.rig.gait.stepHeight}).`
}

function plantedHint (ctx: Context, label: string): string {
  const leg = legsOf(ctx.character.rig)[ctx.labels.indexOf(label)]
  const lowest = Math.min(...ctx.recording.frames.flatMap(f => {
    return metrics.solePoints(f.joints, leg, ctx.character.mannequin).map(p => p[1])
  }))
  return `the ${label} foot never has a sole point within ${PLANT_METRES * 100} cm of the floor for two frames in a ` +
    `row; its lowest sole point is ${lowest.toFixed(3)} m above y = 0. ${groundCause(ctx, leg)}Otherwise ` +
    `lower rig.gait.bobAmplitude (now ${ctx.character.rig.gait.bobAmplitude}) or stepHeight.`
}

export function locomotionChecks (character: Character, recording: LocomotionRecording): Check[] {
  const mpp = character.mannequin.height / PIXEL_HEIGHT
  const windows = walkingWindows(character)
  const labels = legLabels(character.rig, restPose(character.mannequin))
  const ctx: Context = { character, recording, windows, mpp, labels }
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
  for (const label of labels) {
    checks.push({ gate: gate('plantedFrames', planted[label], label), hint: () => plantedHint(ctx, label) })
  }
  return checks
}
