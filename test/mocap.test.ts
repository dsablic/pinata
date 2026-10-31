import { test } from 'node:test'
import assert from 'node:assert/strict'
import { legsOf } from '../src/formats/rig.ts'
import { eulerXyz, fromQuaternion, toQuaternion } from '../src/math/matrix.ts'
import { parseAmc, parseAsf, posed } from '../src/mocap/asf.ts'
import { validateStyle } from '../src/mocap/style.ts'
import { retargetClip, validateRetargeting } from '../src/mocap/retarget.ts'
import { retargetedRecording } from '../src/mocap/recording.ts'
import { boneLengthError, solePoints } from '../src/motion/metrics.ts'
import { assertClose } from './helpers.ts'
import { clipFiles, HUMANOIDS, loadClip, ownRetargeting, readJson, retargetOptions } from './mocap-fixtures.ts'

const STANDING_METRES = 0.02
const LENGTH_TOLERANCE = 1e-9

const ASF = `
:units
  length 0.45
  angle deg
:root
   order TX TY TZ RX RY RZ
:bonedata
  begin
     name thigh
     direction 0 -1 0
     length 9
     axis 0 0 0 XYZ
    dof rx
    limits (-160.0 20.0)
  end
  begin
     name shin
     direction 0 -1 0
     length 9
     axis 0 0 0 XYZ
    dof rx
  end
:hierarchy
  begin
    root thigh
    thigh shin
  end
`
const AMC = `:FULLY-SPECIFIED
:DEGREES
1
root 0 18 0 0 0 0
thigh 0
shin 0
2
root 0 18 0 0 90 0
thigh -90
shin 90
`

test('quaternions round-trip rotations', () => {
  const m = eulerXyz(0.3, -1.1, 2.4)
  const back = fromQuaternion(toQuaternion(m))
  m.forEach((row, i) => row.forEach((v, j) => assertClose(back[i][j], v, 1e-12)))
})

test('ASF and AMC: bones chain from the root, turned by their channels, in metres', () => {
  const skeleton = parseAsf(ASF)
  assert.deepEqual(skeleton.bones.map(b => [b.name, b.parent]), [['root', ''], ['thigh', 'root'], ['shin', 'thigh']])
  const frames = parseAmc(AMC)
  assert.equal(frames.length, 2)
  const unit = 0.0254 / 0.45
  const standing = posed(skeleton, frames[0])
  assertClose(standing.shin.end[1], 0, 1e-12)
  const raised = posed(skeleton, frames[1])
  const knee = raised.thigh.end
  assertClose(knee[0], 9 * unit, 1e-9)
  assertClose(knee[1], 18 * unit, 1e-9)
  assertClose(raised.shin.end[1], 9 * unit, 1e-9)
})

test('every committed clip is valid and names the CMU take it came from', () => {
  const takes = readJson('motion/takes.json') as { takes: Array<{ name: string }> }
  assert.deepEqual(clipFiles, takes.takes.map(t => `${t.name}.json`).sort())
  for (const file of clipFiles) {
    const read = loadClip(file.replace(/\.json$/, ''))
    assert.match(read.source, /^CMU Graphics Lab Motion Capture Database, .*subject \d+, trial \d+/)
  }
})

for (const name of HUMANOIDS) {
  const options = { ...retargetOptions(name), fps: 24 }
  const { rig, rest, mannequin, map } = options

  test(`${name}: the retargeting and its style are valid, and it keeps bone lengths`, () => {
    const { style } = ownRetargeting(name)
    if (style !== undefined) assert.deepEqual(validateStyle(style).errors, [])
    const walk = loadClip('walk')
    assert.deepEqual(validateRetargeting(map, rig, rest, walk).errors, [])
    const recording = retargetedRecording(retargetClip(walk, options), options)
    assert.ok(boneLengthError(recording, { rig, mannequin }, rest) <= LENGTH_TOLERANCE)
  })

  test(`${name}: standing at the end of a stop keeps both feet within 2 cm of the ground`, () => {
    const frames = retargetClip(loadClip('walk-stop'), options)
    const last = retargetedRecording(frames, options).frames[frames.length - 1]
    for (const leg of legsOf(rig)) {
      const sole = Math.min(...solePoints(last.joints, leg, mannequin).map(p => p[1]))
      assert.ok(Math.abs(sole) <= STANDING_METRES, `${leg.side} sole at ${sole.toFixed(3)} m`)
    }
  })
}
