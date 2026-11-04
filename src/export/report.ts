import {
  ANCHOR_PX, anchorOffset, clippedPixels, FEET_HELD_PX, GROUND_PX, groundOffset, heldOf, sectorMisses
} from './gates.ts'
import { measured, seamless, seamOf } from './loops.ts'
import type { Recording, Track } from './record.ts'
import { tagOf } from './sheet.ts'

export type Gate = 'loop' | 'feet' | 'facing' | 'border' | 'ground' | 'anchor'
export type Check = { gate: Gate, line: string, pass: boolean, measured: boolean }

function loopCheck (track: Track): Check {
  const { seam, median } = seamOf(track.frames.map(frame => frame.image))
  const line = `${tagOf(track)}: loop of ${track.frames.length}, seam ${seam} px, median step ${median} px`
  const own = { seam, median }
  return measured(own)
    ? { gate: 'loop', line, pass: seamless(own), measured: true }
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
  const line = `${tagOf(track)}: lowest foot pixel row ${offset} px from the ground line`
  return { gate: 'ground', line, pass: offset <= GROUND_PX, measured: true }
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
    ...(track.behaviour === 'idle' && ['front', 'right'].includes(track.direction) ? [groundCheck(track)] : [])
  ])
  return [anchorCheck(recording), ...tracks]
}

export function reportOf (recording: Recording): string {
  const checks = checksOf(recording)
  const lines = checks.map(check => `${!check.measured ? 'n/a ' : check.pass ? 'ok  ' : 'FAIL'} ${check.line}`)
  const unmeasured = checks.filter(check => !check.measured).length
  const failed = checks.filter(check => check.measured && !check.pass).length
  const verdict = failed === 0 ? 'all measured gates pass' : `${failed} GATES FAILED`
  return [...lines, `${recording.name}: ${verdict}, ${unmeasured} not measured`].join('\n')
}
