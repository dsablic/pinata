import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadCharacter } from '../src/formats/character.ts'
import { legsOf } from '../src/formats/rig.ts'
import { eulerXyz, fromQuaternion, toQuaternion } from '../src/math/matrix.ts'
import { parseAmc, parseAsf, posed } from '../src/mocap/asf.ts'
import { validateClip } from '../src/mocap/clip.ts'
import type { Clip } from '../src/mocap/clip.ts'
import { mergeRetargeting, retargetClip, retargetedRecording, validateRetargeting } from '../src/mocap/retarget.ts'
import { boneLengthError, solePoints } from '../src/motion/metrics.ts'
import { restPose } from '../src/motion/pose.ts'
import { assertClose } from './helpers.ts'

const CLIPS = 'motion/clips'
const HUMANOIDS = ['knight', 'rogue', 'dwarf', 'wizard']
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

function clip (name: string): Clip {
  const read = validateClip(JSON.parse(readFileSync(join(CLIPS, `${name}.json`), 'utf8')))
  assert.deepEqual(read.errors, [])
  return read.value as Clip
}

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
  // the root faces +x; the thigh lifts forward to horizontal, the shin hangs straight down again
  const knee = raised.thigh.end
  assertClose(knee[0], 9 * unit, 1e-9)
  assertClose(knee[1], 18 * unit, 1e-9)
  assertClose(raised.shin.end[1], 9 * unit, 1e-9)
})

test('every committed clip is valid and names the CMU take it came from', () => {
  const takes = JSON.parse(readFileSync('motion/takes.json', 'utf8')) as { takes: Array<{ name: string }> }
  const files = readdirSync(CLIPS).filter(f => f.endsWith('.json')).sort()
  assert.deepEqual(files, takes.takes.map(t => `${t.name}.json`).sort())
  for (const file of files) {
    const read = clip(file.replace(/\.json$/, ''))
    assert.match(read.source, /^CMU Graphics Lab Motion Capture Database, .*subject \d+, trial \d+/)
  }
})

for (const name of HUMANOIDS) {
  const character = loadCharacter(join('examples', name)).value
  assert.ok(character !== undefined)
  const { rig, mannequin } = character
  const rest = restPose(mannequin)
  const own = JSON.parse(readFileSync(join('examples', name, 'retarget.json'), 'utf8'))
  const map = mergeRetargeting(JSON.parse(readFileSync('motion/humanoid.json', 'utf8')), own)
  const options = { rig, rest, mannequin, map, fps: 24 }

  test(`${name}: the retargeting is valid and keeps bone lengths`, () => {
    const walk = clip('walk')
    assert.deepEqual(validateRetargeting(map, rig, rest, walk).errors, [])
    const recording = retargetedRecording(retargetClip(walk, options), options)
    assert.ok(boneLengthError(recording, { rig, mannequin }, rest) <= LENGTH_TOLERANCE)
  })

  // The knight's right leg is 1.3 cm longer than its left and modelled stepping forward, so one vertical placement
  // cannot put both feet down; foot locking (batch B) does.
  const todo = name === 'knight' ? 'both feet down needs foot locking (motion-data plan, batch B)' : undefined
  test(`${name}: standing at the end of a stop keeps both feet within 2 cm of the ground`, { todo }, () => {
    const frames = retargetClip(clip('walk-stop'), options)
    const last = retargetedRecording(frames, options).frames[frames.length - 1]
    for (const leg of legsOf(rig)) {
      const sole = Math.min(...solePoints(last.joints, leg, mannequin).map(p => p[1]))
      assert.ok(Math.abs(sole) <= STANDING_METRES, `${leg.side} sole at ${sole.toFixed(3)} m`)
    }
  })
}
