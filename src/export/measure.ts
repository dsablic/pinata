import { armsOf, legsOf } from '../formats/rig.ts'
import { dot, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import type { Clip } from '../mocap/clip.ts'
import { clipPose } from '../mocap/clip.ts'
import { retargetClip, sideOf } from '../mocap/retarget.ts'
import type { RetargetOptions } from '../mocap/retarget.ts'
import { retargetedRecording } from '../mocap/recording.ts'
import {
  cycleMeans, forwardOf, gapsOf, mean, pathOf, pitchesOf, reachOf, spreadOf, steadySamples, stepMeans, stepsOf,
  travelPerWindow, weightShift, windowsOf
} from '../motion/measure.ts'
import type { Sample, Shift, Spread, Step } from '../motion/measure.ts'
import { project } from '../raster/camera.ts'
import { FPS } from '../page/cast.ts'
import { canvasOf, looping, loopingOf, stepper, takeOf } from './record.ts'
import type { Behaviour, Moment, Stepper, Subject } from './record.ts'

export type Recorded = { frames: Moment[], clips: string[] }
export type Gait = {
  cycles: number
  chest: Spread
  head: Spread
  side: Spread
  pixels: Spread
  length: Spread
  duration: Spread
  legs: Array<{ length: number, duration: number }>
  clipShare: Record<string, number>
  chestByClip: Record<string, number>
  switches: number
  mixed: { share: number, duration: number, pureDuration: number }
}
export type SeriesReport = {
  chest: number
  head: number
  steps: number
  length?: number | undefined
  duration?: number | undefined
}
export type Idle = {
  period: number
  chest: number
  chestPerSecond: number
  shoulders: number
  head: { reach: number, path: number }
  hands: Array<{ reach: number, path: number }>
  shift: Shift
}
export type Attack = { take: string, hand: string, reach: number, lift: number }

const CHEST = 'chest'
const HEAD = 'head'
const LEAD_FRAMES = 12
const SHORTEST_CLIP_STANCE = 3

function handOf (arm: { joints: string[] }): string {
  return arm.joints[arm.joints.length - 1]
}

function ankleNames (subject: { member: Pick<Subject['member'], 'rig'> }): string[] {
  return legsOf(subject.member.rig).map(leg => leg.ankle)
}

export function rawSamples (clip: Clip, options: Pick<RetargetOptions, 'rig'>): Sample[] {
  const legs = legsOf(options.rig)
  return steadySamples(clip.frames.map(frame => {
    const pose = clipPose(clip, frame)
    const joints: Record<string, Vec3> = {
      [options.rig.pelvis]: pose.root.start, [CHEST]: pose.thorax.end, [HEAD]: pose.head.start
    }
    for (const leg of legs) joints[leg.ankle] = pose[sideOf(leg) === 'left' ? 'lfoot' : 'rfoot'].start
    return { joints, yaw: frame.heading, planted: legs.map(leg => frame.contact[sideOf(leg)]) }
  }), SHORTEST_CLIP_STANCE)
}

export function retargetedSamples (clip: Clip, options: RetargetOptions): Sample[] {
  const recording = retargetedRecording(retargetClip(clip, options), { ...options, fps: clip.fps })
  return steadySamples(recording.frames.map(frame => ({
    joints: frame.joints, yaw: frame.root.yaw, planted: Object.values(frame.planted)
  })), SHORTEST_CLIP_STANCE)
}

export function seriesReport (samples: Sample[], options: Pick<RetargetOptions, 'rig'>, fps: number): SeriesReport {
  const pelvis = options.rig.pelvis
  const steps = stepsOf(samples, ankleNames({ member: options }), fps)
  const gaps = gapsOf(steps)
  const worst = (values: number[]): number | undefined => values.length === 0 ? undefined : Math.max(...values)
  const length = worst(gaps.map(gap => gap.length))
  const duration = worst(gaps.map(gap => gap.duration))
  return {
    chest: mean(pitchesOf(samples, pelvis, CHEST)),
    head: mean(pitchesOf(samples, pelvis, HEAD)),
    steps: steps.length,
    ...(length === undefined ? {} : { length }),
    ...(duration === undefined ? {} : { duration })
  }
}

export function recorded (subject: Subject, behaviour: Behaviour): Recorded {
  const s = stepper(subject)
  const clips: string[] = []
  const logged: Stepper = {
    ...s,
    step: () => {
      const moment = s.step()
      clips.push(s.played().clip)
      return moment
    }
  }
  const take = looping(logged, subject, behaviour)
  return { frames: take.frames, clips: clips.slice(-take.frames.length) }
}

export function sidePitches (subject: Subject, frames: Moment[], upper: string, snapped: boolean): number[] {
  const box = canvasOf(subject)
  const at = (moment: Moment, joint: string): { x: number, y: number } => {
    const { x, y } = project(box, sub(moment.joints[joint], moment.position))
    return snapped ? { x: Math.floor(x), y: Math.floor(y) } : { x, y }
  }
  return frames.map(moment => {
    const [low, high] = [at(moment, subject.member.rig.pelvis), at(moment, upper)]
    return Math.atan2(high.x - low.x, low.y - high.y) * 180 / Math.PI
  })
}

function mixedSteps (steps: Step[], clips: string[]): Gait['mixed'] {
  const spans = (step: Step): boolean => clips.slice(step.from, step.to + 1).some(clip => clip !== clips[step.from])
  const [mixed, pure] = [steps.filter(spans), steps.filter(step => !spans(step))]
  return {
    share: mixed.length / steps.length,
    duration: mean(mixed.map(step => step.duration)),
    pureDuration: mean(pure.map(step => step.duration))
  }
}

function share (clips: string[], values?: number[]): Record<string, number> {
  const names = [...new Set(clips)]
  return Object.fromEntries(names.map(name => {
    const own = clips.flatMap((clip, i) => clip === name ? [values === undefined ? 1 : values[i]] : [])
    return [name, values === undefined ? own.length / clips.length : mean(own)]
  }))
}

export function gaitReport (subject: Subject, behaviour: Behaviour): Gait {
  const { frames: played, clips } = recorded(subject, behaviour)
  const frames = steadySamples(played)
  const pelvis = subject.member.rig.pelvis
  const chest = pitchesOf(frames, pelvis, CHEST)
  const steps = stepsOf(frames, ankleNames(subject), FPS)
  const gaps = gapsOf(steps)
  return {
    cycles: cycleMeans(frames, chest).length,
    chest: spreadOf(cycleMeans(frames, chest)),
    head: spreadOf(cycleMeans(frames, pitchesOf(frames, pelvis, HEAD))),
    side: spreadOf(cycleMeans(frames, sidePitches(subject, frames, CHEST, false))),
    pixels: spreadOf(cycleMeans(frames, sidePitches(subject, frames, CHEST, true))),
    length: spreadOf(gaps.map(gap => gap.length)),
    duration: spreadOf(gaps.map(gap => gap.duration)),
    legs: stepMeans(steps, ankleNames(subject).length),
    clipShare: share(clips),
    chestByClip: share(clips, chest),
    switches: clips.filter((clip, i) => i > 0 && clip !== clips[i - 1]).length,
    mixed: mixedSteps(steps, clips)
  }
}

function motion (frames: Moment[], joint: string, height: number): { reach: number, path: number } {
  const points = frames.map(frame => frame.joints[joint])
  return { reach: reachOf(points) / height, path: pathOf(points) / height }
}

export function idleReport (subject: Subject): Idle {
  const { rig, mannequin } = subject.member
  const { lengths } = loopingOf(subject, 'idle') as NonNullable<ReturnType<typeof loopingOf>>
  const period = lengths[0]
  const frames = takeOf(subject, 'idle').frames.slice(LEAD_FRAMES)
  const used = windowsOf(frames, period).flat()
  const height = mannequin.height
  const chest = travelPerWindow(used.map(frame => frame.joints[CHEST][1]), period) / height
  const ankles = ankleNames(subject) as [string, string]
  return {
    period,
    chest,
    chestPerSecond: chest * FPS / period,
    shoulders: mean(armsOf(rig).map(arm => {
      return travelPerWindow(used.map(frame => frame.joints[arm.shoulder][1] - frame.joints[rig.pelvis][1]), period)
    })) / height,
    head: motion(used, HEAD, height),
    hands: armsOf(rig).map(arm => motion(used, handOf(arm), height)),
    shift: weightShift(used, rig.pelvis, ankles, height)
  }
}

function attackArm (frames: Moment[], hands: string[]): string {
  const travel = (hand: string): number => pathOf(frames.map(frame => frame.joints[hand]))
  return hands.reduce((best, hand) => travel(hand) > travel(best) ? hand : best)
}

export function attackReport (subject: Subject): Attack {
  const { rig, mannequin } = subject.member
  const { frames } = takeOf(subject, 'attack')
  const take = subject.member.capture!.performances.find(own => own.kind === 'attack')!
  const hand = attackArm(frames, armsOf(rig).map(handOf))
  const offsets = frames.map(frame => sub(frame.joints[hand], frame.joints[rig.pelvis]))
  const forward = offsets.map((offset, i) => dot(offset, forwardOf(frames[i].yaw)))
  return {
    take: take.name,
    hand,
    reach: Math.max(...forward) / mannequin.height,
    lift: Math.max(...offsets.map(offset => offset[1])) / mannequin.height
  }
}
