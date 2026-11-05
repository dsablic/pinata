import {
  ANCHOR_PX, anchorOffset, clippedPixels, FEET_HELD_PX, GROUND_PX, groundOf, heldOf,
  MOST_OFF_GROUND_SHARE, sectorMisses, unseenLegs
} from './gates.ts'
import { measured, seamless, seamOf } from './loops.ts'
import { viewOf } from './directions.ts'
import type { Behaviour, Recording, Track } from './record.ts'
import { tagOf } from './sheet.ts'

export const GATES = ['loop', 'feet', 'facing', 'border', 'ground', 'drawn', 'anchor'] as const
export type Gate = typeof GATES[number]
export type Check = { gate: Gate, line: string, short?: string, pass: boolean, measured: boolean, hint?: string }

const HELD_BEHAVIOURS: Behaviour[] = ['idle', 'walk', 'run']
const ENGINE_GATES: Gate[] = ['feet', 'facing', 'border', 'anchor']
const LOOP_HINT = 'the cycle\'s end does not match its start: with cloth, shorten or stiffen it in motion.json; ' +
  'without, the gait in rig.json (stride, step height)'
const MOVE_HINT = 'in that view move the foot sprites\' pivotA and pivotB rows by one, both together (a higher row ' +
  'draws the foot higher in the side views, and may move it the other way in the front and back views); a view\'s ' +
  'two directions share its two foot sprites, swapped: check both'
const BELOW_HINT = `skin.json: a foot is drawn below its ground point; ${MOVE_HINT}`
const ABOVE_HINT = `skin.json: a foot floats above its ground point; ${MOVE_HINT}`
const NONE_PLANTED_HINT = 'the behaviour never plants a foot, so the ground line cannot be measured; this is ' +
  'the motion, not the skin'
const WIDTH = 120
const INDENT = '      '
const NO_STEPS = 'most steps change no pixel'
const UNSEEN_HINT = 'skin.json: a foot sprite of this view is hidden, empty or covered in every frame; draw both ' +
  'feet in every view, with a "layer" above what covers them'

function loopCheck (track: Track): Check {
  const own = seamOf(track.frames.map(frame => frame.image), track.behaviour === 'idle')
  const { seam, median } = own
  const line = `${tagOf(track)}: loop of ${track.frames.length}, seam ${seam} px, median step ${median} px`
  const short = measured(own) ? `${tagOf(track)} seam ${seam}/${median}` : tagOf(track)
  return measured(own)
    ? { gate: 'loop', line, short, pass: seamless(own), measured: true, hint: LOOP_HINT }
    : { gate: 'loop', line: `${line}: not measured, ${NO_STEPS}`, short, pass: false, measured: false }
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

function viewedTag (track: Track): string {
  return `${tagOf(track)} (view ${viewOf(track.direction)})`
}

function feetNamed (legs: number[]): string {
  return `${legs.length === 1 ? 'foot' : 'feet'} ${legs.map(leg => leg + 1).join(' and ')}`
}

function groundCheck (track: Track): Check {
  const { planted, seen, off, worst, hidden } = groundOf(track)
  const own = { gate: 'ground' as Gate, measured: true }
  const tag = tagOf(track)
  if (planted === 0) {
    const line = `${tag}: no foot is planted in any frame`
    return { ...own, line, short: `${tag} no foot planted`, pass: false, hint: NONE_PLANTED_HINT }
  }
  if (hidden.length > 0) {
    const line = `${viewedTag(track)}: ${feetNamed(hidden)} planted with no visible pixel in any planted frame`
    return { ...own, line, short: `${tag} ${feetNamed(hidden)} hidden`, pass: false, hint: UNSEEN_HINT }
  }
  const where = worst > 0 ? 'below' : 'above'
  const line = `${viewedTag(track)}: ${off} of ${seen} planted foot-frames more than ${GROUND_PX} px from their own ` +
    `ground point, worst ${Math.abs(worst)} px ${where}`
  const short = `${tag} ${off}/${seen} ${Math.abs(worst)}px ${where}`
  return { ...own, line, short, pass: off <= MOST_OFF_GROUND_SHARE * seen, hint: worst > 0 ? BELOW_HINT : ABOVE_HINT }
}

function drawnCheck (view: string, tracks: Track[]): Check {
  const legs = unseenLegs(tracks)
  const own = { gate: 'drawn' as Gate, measured: true }
  const directions = tracks.map(track => track.direction).join(' and ')
  if (legs.length === 0) return { ...own, line: `idle (view ${view}): every foot is seen in ${directions}`, pass: true }
  const line = `idle (view ${view}): ${feetNamed(legs)} not seen in any frame of ${directions}`
  return { ...own, line, short: `${view} ${feetNamed(legs)}`, pass: false, hint: UNSEEN_HINT }
}

function viewsOf (tracks: Track[]): Array<[string, Track[]]> {
  const views = new Map<string, Track[]>()
  for (const track of tracks.filter(own => own.behaviour === 'idle')) {
    views.set(viewOf(track.direction), [...views.get(viewOf(track.direction)) ?? [], track])
  }
  return [...views]
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
    ...(HELD_BEHAVIOURS.includes(track.behaviour) ? [heldCheck(track)] : []),
    ...(track.behaviour === 'turn' ? [] : [facingCheck(track)]),
    ...(track.behaviour === 'idle' ? [groundCheck(track)] : [])
  ])
  return [anchorCheck(recording), ...tracks, ...viewsOf(recording.tracks).map(([view, own]) => drawnCheck(view, own))]
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

function shownHint (check: Check): boolean {
  return check.hint !== undefined && check.measured && !check.pass
}

function fullLines (checks: Check[]): string[] {
  return checks.flatMap(check => shownHint(check) ? [lineOf(check), `      hint: ${check.hint}`] : [lineOf(check)])
}

function countsOf (checks: Check[]): string {
  const counted = GATES.map(gate => [gate, checks.filter(check => check.gate === gate).length] as const)
  return counted.filter(([, count]) => count > 0).map(([gate, count]) => `${gate} ${count}`).join(', ')
}

function wrapped (head: string, items: string[]): string[] {
  const lines: string[] = []
  let line = head
  let onLine = 0
  items.forEach((item, k) => {
    const piece = k < items.length - 1 ? `${item};` : item
    if (onLine > 0 && line.length + piece.length > WIDTH) {
      lines.push(line.trimEnd())
      line = INDENT
      onLine = 0
    }
    line += `${piece} `
    onLine++
  })
  return [...lines, line.trimEnd()]
}

function groupedLines (checks: Check[], label: string, why: (gate: Gate) => string): string[] {
  return GATES.flatMap(gate => {
    const own = checks.filter(check => check.gate === gate)
    return own.length === 0 ? [] : wrapped(`${gate} ${label}${why(gate)} `, own.map(check => check.short ?? check.line))
  })
}

function failedLines (checks: Check[]): string[] {
  const failed = failedGates(checks)
  const printed = new Set<string | undefined>()
  return GATES.flatMap(gate => {
    const own = failed.filter(check => check.gate === gate)
    const hints = [...new Set(own.map(check => check.hint))].filter(hint => !printed.has(hint))
    hints.forEach(hint => printed.add(hint))
    const shown = hints.flatMap(hint => hint === undefined ? [] : [`${INDENT}hint: ${hint}`])
    return own.length === 0 ? [] : [...groupedLines(own, 'FAIL', () => ''), ...shown]
  })
}

function unmeasuredLines (checks: Check[]): string[] {
  return groupedLines(checks.filter(check => !check.measured), 'n/a', gate => gate === 'loop' ? ` (${NO_STEPS})` : '')
}

function compactLines (checks: Check[]): string[] {
  const passed = checks.filter(check => check.measured && check.pass)
  const notes = checks.filter(check => check.measured && !check.pass && isEngineGate(check))
  return [
    ...failedLines(checks),
    ...unmeasuredLines(checks),
    ...(passed.length === 0 ? [] : [`ok   ${countsOf(passed)} checks`]),
    ...(notes.length === 0 ? [] : [`note ${countsOf(notes)} checks: engine notes, no character file can fix them`])
  ]
}

export function reportOf (name: string, checks: Check[], full = false): string {
  const unmeasured = checks.filter(check => !check.measured).length
  const notes = checks.filter(check => check.measured && !check.pass && isEngineGate(check)).length
  const failed = failedGates(checks).length
  const verdict = failed === 0 ? 'no gate failed' : `${failed} GATES FAILED`
  const closing = `${name}: ${verdict}, ${notes} engine notes, ${unmeasured} not measured`
  const body = full ? fullLines(checks) : [...compactLines(checks), 'every track: --full (full: true over MCP)']
  return [...body, closing].join('\n')
}
