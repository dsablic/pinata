import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Mannequin } from '../src/formats/mannequin.ts'
import { legsOf, stride } from '../src/formats/rig.ts'
import type { Rig } from '../src/formats/rig.ts'
import { planGait } from '../src/motion/gait.ts'
import type { GaitFrame } from '../src/motion/gait.ts'
import { restPose } from '../src/motion/pose.ts'
import type { RootState } from '../src/motion/script.ts'
import { length, sub } from '../src/math/vec.ts'
import type { Vec3 } from '../src/math/vec.ts'
import { assertClose } from './helpers.ts'
import { mannequin, quadMannequin, quadRig, rig, walkTrack } from './locomotion-fixtures.ts'

const FPS = 24

function plan (track: (t: number) => RootState, duration: number, gaitRig: Rig = rig): GaitFrame[] {
  return planGait({ track, rig: gaitRig, rest: restPose(mannequin), mannequin, duration, fps: FPS })
}

type Landing = { frame: number, side: string, ankle: Vec3 }

function landings (frames: GaitFrame[]): Landing[] {
  const found: Landing[] = []
  for (let i = 1; i < frames.length; i++) {
    frames[i].feet.forEach((foot, k) => {
      if (foot.planted && !frames[i - 1].feet[k].planted) found.push({ frame: i, side: foot.side, ankle: foot.ankle })
    })
  }
  return found
}

test('one frame per tick including both ends, with the root from the track', () => {
  const track = walkTrack(1, 2)
  const frames = plan(track, 3)
  assert.equal(frames.length, 3 * FPS + 1)
  assert.deepEqual(frames[10].root, track(10 / FPS))
})

test('steady walking plants the feet alternately, stride / 2 apart along the path', () => {
  const frames = plan(walkTrack(1, 8), 12)
  const found = landings(frames).filter(l => l.frame < 7 * FPS)
  assert.ok(found.length >= 8, `landings: ${found.length}`)
  for (let i = 1; i < found.length; i++) {
    assert.notEqual(found[i].side, found[i - 1].side)
    assertClose(found[i].ankle[2] - found[i - 1].ankle[2], stride(rig.gait, 1) / 2, 1e-6)
  }
})

test('planted feet do not move in world space and do not jump at landing or lift-off', () => {
  const frames = plan(walkTrack(1, 4), 6)
  let planted = 0
  for (let i = 1; i < frames.length; i++) {
    frames[i].feet.forEach((foot, k) => {
      const before = frames[i - 1].feet[k]
      if (foot.planted && before.planted) {
        planted++
        assert.deepEqual(foot.ankle, before.ankle)
        assert.equal(foot.toeYaw, before.toeYaw)
      }
      assert.ok(length(sub(foot.ankle, before.ankle)) < 0.25, 'a foot jumped')
    })
  }
  assert.ok(planted > 100)
})

test('the swing foot lifts and is flagged unplanted with its lift', () => {
  const frames = plan(walkTrack(1, 4), 4)
  const peak = Math.max(...frames.map(f => f.feet[0].lift))
  assertClose(peak, 1, 0.05)
  for (const frame of frames) {
    for (const foot of frame.feet) assert.equal(foot.planted, foot.lift === 0)
  }
})

test('turning in place produces steps', () => {
  const turn = 2
  const track = (t: number): RootState => {
    const x = Math.min(1, t / turn)
    const yaw = (Math.PI / 2) * x * x * (3 - 2 * x)
    const rate = t < turn ? (Math.PI / 2) * 6 * x * (1 - x) / turn : 0
    return { position: [0, 0, 0], yaw, velocity: [0, 0, 0], angularVelocity: rate }
  }
  const frames = plan(track, 4)
  const found = landings(frames)
  assert.ok(found.length >= 2, `landings: ${found.length}`)
  const last = frames[frames.length - 1]
  assert.ok(last.feet.every(f => f.planted))
  const [left, right] = last.feet
  const lateral = sub(left.ankle, right.ankle)
  assertClose(length(lateral), rig.gait.footSpacing, 1e-9)
})

test('after a stop both feet end planted side by side and nothing moves', () => {
  const frames = plan(walkTrack(1, 3), 8)
  const last = frames[frames.length - 1]
  assert.ok(last.feet.every(f => f.planted))
  const [left, right] = last.feet
  assertClose(left.ankle[2], right.ankle[2], 1e-9)
  assertClose(left.ankle[0] - right.ankle[0], rig.gait.footSpacing, 1e-9)
  const tail = frames.slice(-24)
  for (const frame of tail) {
    assert.deepEqual(frame.feet, last.feet)
    assert.deepEqual(frame.pelvisOffset, last.pelvisOffset)
    assert.equal(frame.phase, last.phase)
    assert.equal(frame.armSwing, 0)
  }
})

test('a root at rest from the start keeps the feet at rest positions', () => {
  const frames = plan(walkTrack(0, 0), 2)
  const rest = restPose(mannequin)
  for (const frame of frames) {
    assert.equal(frame.phase, rig.gait.stanceFraction - 0.5)
    assert.deepEqual(frame.feet[0].ankle, rest.ankleL)
    assert.deepEqual(frame.feet[1].ankle, rest.ankleR)
    assert.ok(frame.feet.every(f => f.planted))
  }
})

test('phase rate follows speed over stride', () => {
  const rate = (speed: number): number => {
    const frames = plan(walkTrack(speed, 6), 6)
    return (frames[96].phase - frames[48].phase) / 2
  }
  const slow = rate(0.6)
  const fast = rate(1.2)
  assertClose(slow, 0.5 * fast * stride(rig.gait, 1.2) / stride(rig.gait, 0.6), 1e-9)
  assert.ok(slow < fast)
})

test('the pelvis drops so every foot stays within reach of its hip', () => {
  const long: Rig = { ...rig, gait: { ...rig.gait, strideLength: 1.6 } }
  const rest = restPose(mannequin)
  const reach = length(sub(rest.hipL, rest.kneeL)) + length(sub(rest.kneeL, rest.ankleL))
  const frames = plan(walkTrack(1.2, 6), 6, long)
  let dropped = 0
  for (const frame of frames) {
    if (frame.pelvisOffset[1] < -long.gait.bobAmplitude - 1e-9) dropped++
    for (const [k, hip] of [rest.hipL, rest.hipR].entries()) {
      const hipWorld: Vec3 = [hip[0], hip[1] + frame.pelvisOffset[1], hip[2] + frame.root.position[2]]
      assert.ok(length(sub(frame.feet[k].ankle, hipWorld)) <= reach, 'foot out of reach')
    }
  }
  assert.ok(dropped > 0)
})

test('bob is zero at rest and arm swing alternates with the legs', () => {
  const frames = plan(walkTrack(1.2, 4), 6)
  assert.equal(frames[frames.length - 1].pelvisOffset[1], 0)
  assert.ok(frames.some(f => f.armSwing > 5) && frames.some(f => f.armSwing < -5))
})

test('planning is deterministic', () => {
  const a = plan(walkTrack(1.2, 3), 5)
  const b = plan(walkTrack(1.2, 3), 5)
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

test('planted feet put the lowest sole point on the ground', () => {
  const thick: Mannequin = {
    ...mannequin,
    parts: mannequin.parts.map(part => (part.shape === 'capsule' ? { ...part, radiusA: 0.12 } : part))
  }
  const track = walkTrack(1, 3)
  const frames = planGait({ track, rig, rest: restPose(mannequin), mannequin: thick, duration: 5, fps: FPS })
  let planted = 0
  for (const frame of frames) {
    for (const foot of frame.feet) {
      if (!foot.planted) continue
      planted++
      assertClose(foot.ankle[1], 0.12, 1e-9)
    }
  }
  assert.ok(planted > 100)
})

test('a swing foot moves only vertically until it is 1 cm off the ground and after it is back within 1 cm', () => {
  const frames = plan(walkTrack(1, 4), 6)
  const { stanceFraction, stepHeight } = rig.gait
  const edge = Math.asin(0.01 / stepHeight) / Math.PI
  let edges = 0
  for (const [k, offset] of [0, 0.5].entries()) {
    let start: Vec3 | undefined
    let run: number[] = []
    for (let i = 0; i < frames.length; i++) {
      const foot = frames[i].feet[k]
      if (!foot.planted) {
        run.push(i)
        continue
      }
      if (run.length > 0 && start !== undefined) {
        for (const j of run) {
          const s = (((frames[j].phase + offset) % 1) - stanceFraction) / (1 - stanceFraction)
          const expected = s < edge ? start : s > 1 - edge ? foot.ankle : undefined
          if (expected === undefined) continue
          edges++
          assertClose(frames[j].feet[k].ankle[0], expected[0], 1e-9)
          assertClose(frames[j].feet[k].ankle[2], expected[2], 1e-9)
          assertClose(frames[j].feet[k].toePitch, 0, 1e-9)
        }
      }
      run = []
      start = foot.ankle
    }
  }
  assert.ok(edges >= 6, `edge frames: ${edges}`)
})

test('the side of each foot comes from the leg, not from the rest ankle position', () => {
  const centred: Mannequin = {
    ...mannequin,
    joints: {
      ...mannequin.joints,
      ankleL: [0, 0.1, 0],
      toeL: [0, 0.05, 0.15],
      ankleR: [0, 0.1, 0],
      toeR: [0, 0.05, 0.15]
    }
  }
  const frames = planGait({
    track: walkTrack(1, 8), rig, rest: restPose(centred), mannequin: centred, duration: 10, fps: FPS
  })
  const found = landings(frames).filter(l => l.frame > FPS && l.frame < 7 * FPS)
  assert.ok(found.length >= 6)
  for (const l of found) assertClose(l.ankle[0], (l.side === 'left' ? 1 : -1) * rig.gait.footSpacing / 2, 1e-9)
})

function planQuad (track: (t: number) => RootState, duration: number, gaitRig: Rig = quadRig): GaitFrame[] {
  return planGait({
    track, rig: gaitRig, rest: restPose(quadMannequin), mannequin: quadMannequin, duration, fps: FPS
  })
}

function legLandings (frames: GaitFrame[]): Array<{ frame: number, leg: number }> {
  const found: Array<{ frame: number, leg: number }> = []
  for (let i = 1; i < frames.length; i++) {
    frames[i].feet.forEach((foot, leg) => {
      if (foot.planted && !frames[i - 1].feet[leg].planted) found.push({ frame: i, leg })
    })
  }
  return found
}

test('four legs plant in phase order, a quarter cycle apart', () => {
  const frames = planQuad(walkTrack(0.9, 8), 10)
  const found = legLandings(frames).filter(l => l.frame > 2 * FPS && l.frame < 7 * FPS)
  assert.ok(found.length >= 12, `landings: ${found.length}`)
  for (let i = 1; i < found.length; i++) assert.equal(found[i].leg, (found[i - 1].leg + 1) % 4)
  const cycleFrames = (stride(quadRig.gait, 0.9) / 0.9) * FPS
  for (let i = 1; i < found.length; i++) assertClose(found[i].frame - found[i - 1].frame, cycleFrames / 4, 1.01)
})

test('four legs start planted at the rest pose', () => {
  const frames = planQuad(walkTrack(0, 0), 2)
  const rest = restPose(quadMannequin)
  for (const frame of frames) {
    assert.equal(frame.phase, 0)
    legsOf(quadRig).forEach((leg, k) => {
      assert.deepEqual(frame.feet[k].ankle, rest[leg.ankle])
      assert.ok(frame.feet[k].planted)
    })
  }
})

test('each foot is planted under its own hip at mid-stance and on its own lateral line', () => {
  const frames = planQuad(walkTrack(0.9, 8), 10)
  const rest = restPose(quadMannequin)
  const found = legLandings(frames).filter(l => l.frame > 2 * FPS && l.frame < 6 * FPS)
  assert.ok(found.length >= 8)
  for (const { frame, leg } of found) {
    let end = frame
    while (frames[end + 1].feet[leg].planted) end++
    const hip = rest[legsOf(quadRig)[leg].hip]
    const ankle = frames[frame].feet[leg].ankle
    const middle = (frame + end) / 2
    const lower = frames[Math.floor(middle)].root.position[2]
    const upper = frames[Math.ceil(middle)].root.position[2]
    assertClose(ankle[2] - (lower + upper) / 2, hip[2], 0.04)
    assertClose(ankle[0], (hip[0] > 0 ? 1 : -1) * quadRig.gait.footSpacing / 2, 1e-9)
  }
})

test('after a stop all four feet end planted, each pair side by side', () => {
  const frames = planQuad(walkTrack(0.9, 3), 9)
  const last = frames[frames.length - 1]
  assert.ok(last.feet.every(f => f.planted))
  assertClose(last.feet[0].ankle[2], last.feet[2].ankle[2], 1e-9)
  assertClose(last.feet[1].ankle[2], last.feet[3].ankle[2], 1e-9)
  assertClose(last.feet[0].ankle[0] - last.feet[2].ankle[0], quadRig.gait.footSpacing, 1e-9)
  assertClose(last.feet[1].ankle[0] - last.feet[3].ankle[0], quadRig.gait.footSpacing, 1e-9)
  for (const frame of frames.slice(-24)) assert.deepEqual(frame.feet, last.feet)
})

test('the pelvis drops so all four feet stay within reach of their hips', () => {
  const long: Rig = { ...quadRig, gait: { ...quadRig.gait, strideLength: 0.7 } }
  const rest = restPose(quadMannequin)
  const frames = planQuad(walkTrack(0.9, 6), 6, long)
  const reach = legsOf(long).map(leg => {
    return length(sub(rest[leg.hip], rest[leg.knee])) + length(sub(rest[leg.knee], rest[leg.ankle]))
  })
  let dropped = 0
  for (const frame of frames) {
    if (frame.pelvisOffset[1] < -long.gait.bobAmplitude - 1e-9) dropped++
    legsOf(long).forEach((leg, k) => {
      const hip = rest[leg.hip]
      const hipWorld: Vec3 = [hip[0], hip[1] + frame.pelvisOffset[1], hip[2] + frame.root.position[2]]
      assert.ok(length(sub(frame.feet[k].ankle, hipWorld)) <= reach[k], 'foot out of reach')
    })
  }
  assert.ok(dropped > 0)
})

test('a longer quadruped stance still ends with all four feet planted', () => {
  const slow: Rig = { ...quadRig, gait: { ...quadRig.gait, stanceFraction: 0.76 } }
  const frames = planQuad(walkTrack(0.9, 4), 8, slow)
  assert.ok(frames[frames.length - 1].feet.every(f => f.planted))
})

test('explicit phases on two legs set the time between landings', () => {
  const [, second] = legsOf(rig)
  const skewed: Rig = { ...rig, limbs: rig.limbs.map(l => (l === second.limb ? { ...second.limb, phase: 0.4 } : l)) }
  const found = landings(plan(walkTrack(1, 8), 10, skewed)).filter(l => l.frame > 2 * FPS && l.frame < 7 * FPS)
  const cycleFrames = (stride(rig.gait, 1) / 1) * FPS
  assert.ok(found.length >= 6)
  for (let i = 1; i < found.length; i++) {
    const share = found[i - 1].side === 'left' ? 0.4 : 0.6
    assertClose(found[i].frame - found[i - 1].frame, share * cycleFrames, 1.01)
  }
})
