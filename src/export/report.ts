import {
  ANCHOR_PX, anchorOffset, clippedPixels, FEET_HELD_PX, GROUND_DIRECTIONS, GROUND_PX, groundOffset, heldOf,
  sectorMisses
} from './gates.ts'
import { measured, seamless, seamOf } from './loops.ts'
import type { Recording, Track } from './record.ts'
import { tagOf } from './sheet.ts'

export type Gate = 'loop' | 'feet' | 'facing' | 'border' | 'ground' | 'mirroredGround' | 'anchor'
export type Check = { gate: Gate, line: string, pass: boolean, measured: boolean, hint?: string }

const ENGINE_GATES: Gate[] = ['feet', 'facing', 'border', 'mirroredGround', 'anchor']
const LOOP_HINT = 'the end of the cycle does not match its start: with a cape or chains, shorten or stiffen the ' +
  'cloth in motion.json; without cloth, the gait in rig.json (stride, step height) sets the cycle'
const BELOW_HINT = 'skin.json: the feet are drawn below the ground line; raise the foot sprites\' pivot rows so the ' +
  'sole ends at the foot joint'
const ABOVE_HINT = 'skin.json: the feet float above the ground line; lower the foot sprites\' pivot rows so the ' +
  'sole reaches the foot joint'
const HIDDEN_HINT = 'skin.json: no foot sprite is visible in this view; draw the feet in every view'

function loopCheck (track: Track): Check {
  const { seam, median } = seamOf(track.frames.map(frame => frame.image))
  const line = `${tagOf(track)}: loop of ${track.frames.length}, seam ${seam} px, median step ${median} px`
  const own = { seam, median }
  return measured(own)
    ? { gate: 'loop', line, pass: seamless(own), measured: true, hint: LOOP_HINT }
    : { gate: 'loop', line: `${line}: not measured until batch C`, pass: false, measured: false }
}

function heldCheck (track: Track): Check {
  const { pairs, flickers, hidden, worst } = heldOf(track)
  const line = `${tagOf(track)}: ${pairs} planted pairs, worst foot-pixel slide ${worst.toFixed(2)} px, ` +
    `${flickers} one-frame flickers, ${hidden} pairs with the foot hidden`
  return { gate: 'feet', line, pass: worst <= FEET_HELD_PX, measured: true }
}

function facingCheck (track: Track): Check {
  const missed = sectorMisses(track)
  const line = `${tagOf(track)}: ${missed} of ${track.frames.length} frames in another view`
  return { gate: 'facing', line, pass: missed === 0, measured: true }
}

function insideCheck (track: Track): Check {
  const clipped = clippedPixels(track)
  const line = `${tagOf(track)}: ${clipped} pixels on the cell border`
  return { gate: 'border', line, pass: clipped === 0, measured: true }
}

function groundCheck (track: Track): Check {
  const offset = groundOffset(track)
  const gate: Gate = track.direction === 'left' ? 'mirroredGround' : 'ground'
  if (offset === undefined) {
    return { gate, line: `${tagOf(track)}: no sole pixel is visible`, pass: false, measured: true, hint: HIDDEN_HINT }
  }
  const where = offset > 0 ? 'below' : 'above'
  const line = `${tagOf(track)}: lowest foot pixel row ${Math.abs(offset)} px ${where} the ground line`
  const hint = offset > 0 ? BELOW_HINT : ABOVE_HINT
  return { gate, line, pass: Math.abs(offset) <= GROUND_PX, measured: true, hint }
}

function anchorCheck (recording: Recording): Check {
  const offset = anchorOffset(recording.cell)
  const { root, pivot } = recording.cell
  const line = `${recording.name}: root at ${root.map(v => v.toFixed(2)).join(',')}, pivot ${pivot.join(',')}`
  return { gate: 'anchor', line, pass: offset <= ANCHOR_PX, measured: true }
}

export function checksOf (recording: Recording): Check[] {
  const tracks = recording.tracks.flatMap(track => [
    insideCheck(track),
    ...(track.loop ? [loopCheck(track)] : []),
    ...(track.behaviour === 'walk' || track.behaviour === 'run' ? [heldCheck(track)] : []),
    ...(track.behaviour === 'turn' ? [] : [facingCheck(track)]),
    ...(track.behaviour === 'idle' && GROUND_DIRECTIONS.includes(track.direction) ? [groundCheck(track)] : [])
  ])
  return [anchorCheck(recording), ...tracks]
}

export function isEngineGate (check: Check): boolean {
  return ENGINE_GATES.includes(check.gate)
}

export function failedGates (checks: Check[]): Check[] {
  return checks.filter(check => check.measured && !check.pass && !isEngineGate(check))
}

function lineOf (check: Check): string {
  if (!check.measured) return `n/a  ${check.line}`
  if (check.pass) return `ok   ${check.line}`
  return isEngineGate(check) ? `note ${check.line}: engine note, no character file can fix it` : `FAIL ${check.line}`
}

export function reportOf (name: string, checks: Check[]): string {
  const lines = checks.flatMap(check => {
    const line = lineOf(check)
    return check.hint !== undefined && check.measured && !check.pass ? [line, `      hint: ${check.hint}`] : [line]
  })
  const unmeasured = checks.filter(check => !check.measured).length
  const notes = checks.filter(check => check.measured && !check.pass && isEngineGate(check)).length
  const failed = failedGates(checks).length
  const verdict = failed === 0 ? 'no gate failed' : `${failed} GATES FAILED`
  return [...lines, `${name}: ${verdict}, ${notes} engine notes, ${unmeasured} not measured`].join('\n')
}
