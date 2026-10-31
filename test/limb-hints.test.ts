import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadCharacter } from '../src/formats/character.ts'
import type { Character } from '../src/formats/character.ts'
import type { Rig } from '../src/formats/rig.ts'
import { locomotionChecks } from '../src/cli/locomotion.ts'
import { runChecks } from '../src/cli/summary.ts'
import type { LocomotionRecording } from '../src/motion/metrics.ts'
import { FPS } from './locomotion-fixtures.ts'
import { hexMannequin, hexRecording, hexRig, sideBySideRig } from './hexapod-fixtures.ts'

const base = loadCharacter(new URL('./fixtures/character-ok', import.meta.url).pathname).value!

function hexapod (rig: Rig): { character: Character, recording: LocomotionRecording } {
  const character: Character = { ...base, mannequin: hexMannequin, rig, scenario: { ...base.scenario, fps: FPS } }
  return { character, recording: hexRecording(rig) }
}

function result (character: Character, recording: LocomotionRecording, name: string) {
  return runChecks(locomotionChecks(character, recording)).find(r => r.name === name)
}

test('a hexapod gets the balance gate, and lifting a whole side fails it with a hint naming the planted legs', () => {
  const { character, recording } = hexapod(hexRig)
  assert.equal(result(character, recording, 'unbalancedFrames')?.pass, true)
  const tipped = hexapod(sideBySideRig)
  const failed = result(tipped.character, tipped.recording, 'unbalancedFrames')
  assert.equal(failed?.pass, false)
  assert.match(failed?.hint ?? '', /body centre is more than 2 cm outside .* standing on: (left|right) 1 \(limb 'leg/)
  assert.match(failed?.hint ?? '', /Raise rig\.gait\.stanceFraction \(now 0\.6\)/)
})

test('appendage hints name the appendage and the first bad frame', () => {
  const { character, recording } = hexapod(hexRig)
  recording.frames[9].joints.tail3 = [NaN, 0, 0]
  const nonFinite = result(character, recording, 'appendageNonFinite')
  assert.match(nonFinite?.hint ?? '', /appendage 'tail' has 1 joint positions .* first in frame 9 /)
  assert.match(nonFinite?.hint ?? '', /solver bug: please report it/)
  const bone = result(character, recording, 'appendageBoneLengthError')
  assert.match(bone?.hint ?? '', /^the metric is not finite.*bones of appendage 'tail' change length/)
})
