import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  attackReport, gaitReport, gateRows, idleReport, rawSamples, retargetedSamples, seriesReport
} from '../export/measure.ts'
import type { Attack, Gait, Idle, Measured, SeriesReport } from '../export/measure.ts'
import { SKINNED_HUMANOIDS } from '../export/record.ts'
import type { Subject } from '../export/record.ts'
import { validateClip } from '../mocap/clip.ts'
import type { Clip } from '../mocap/clip.ts'
import { clipScale } from '../mocap/retarget.ts'
import type { Spread } from '../motion/measure.ts'
import { subjectFor } from '../tool/subject.ts'
import { ROOT } from './paths.ts'

const GAITS = ['walk', 'run'] as const
const STEADY = ['walk', 'walk-2', 'run']

type Behaviour = typeof GAITS[number]

const fixed = (value: number | undefined, digits = 1): string => {
  return value === undefined || Number.isNaN(value) ? '-' : value.toFixed(digits)
}
const percent = (value: number | undefined, digits = 1): string => fixed(value && 100 * value, digits)
const range = (s: Spread): string => `${fixed(s.mean)} (${fixed(s.min)}..${fixed(s.max)})`
const gap = (s: Spread): string => `${percent(s.mean)} (max ${percent(s.max)})`
const pair = (values: number[], digits = 2): string => values.map(value => fixed(value, digits)).join(' / ')

function table (headers: string[], rows: string[][]): string {
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n')
}

function section (title: string, headers: string[], rows: string[][]): void {
  console.log(`\n${title}\n\n${table(headers, rows)}`)
}

function clipsOf (): Clip[] {
  const dir = join(ROOT, 'motion', 'clips')
  return readdirSync(dir).filter(file => file.endsWith('.json')).sort().map(file => {
    const read = validateClip(JSON.parse(readFileSync(join(dir, file), 'utf8')))
    if (read.value === undefined) throw new Error(`${file}: ${read.errors.map(e => e.message).join('; ')}`)
    return read.value
  })
}

function speedOf (clip: Clip): number {
  const [first, last] = [clip.frames[0].root, clip.frames[clip.frames.length - 1].root]
  return Math.hypot(last[0] - first[0], last[2] - first[2]) / ((clip.frames.length - 1) / clip.fps)
}

function gapped (clip: Clip, report: SeriesReport): SeriesReport {
  return STEADY.includes(clip.name) ? report : { ...report, length: undefined, duration: undefined }
}

function takesTables (clips: Clip[], subjects: Subject[]): void {
  const { member } = subjects[0]
  const raw = clips.map(clip => ({ clip, ...gapped(clip, seriesReport(rawSamples(clip, member), member, clip.fps)) }))
  section(
    'Takes, raw CMU: pelvis to neck and to head (degrees, forward positive), speed (m/s), steady gaits only for gaps',
    ['take', 'frames', 'speed', 'neck pitch', 'head pitch', 'steps', 'length gap %', 'duration gap %'],
    raw.map(r => [r.clip.name, `${r.clip.frames.length}`, fixed(speedOf(r.clip), 2), fixed(r.chest), fixed(r.head),
      `${r.steps}`, percent(r.length), percent(r.duration)])
  )
  const names = subjects.map(s => s.name)
  const retargeted = (pick: (r: SeriesReport) => string): string[][] => clips.map(clip => {
    return [clip.name, ...subjects.map(({ member }) => {
      const samples = retargetedSamples(clip, member.capture!.options)
      return pick(gapped(clip, seriesReport(samples, member, clip.fps)))
    })]
  })
  section('Takes retargeted: chest pitch (degrees)', ['take', ...names], retargeted(r => fixed(r.chest)))
  section('Takes retargeted: head pitch (degrees)', ['take', ...names], retargeted(r => fixed(r.head)))
  section('Takes retargeted: step length gap / duration gap (%), steady gaits', ['take', ...names],
    retargeted(r => r.length === undefined ? '-' : `${percent(r.length)} / ${percent(r.duration)}`))
  section('Takes retargeted: speed (m/s) after the leg ratio and the style stride', ['take', ...names],
    clips.map(clip => [clip.name, ...subjects.map(({ member }) => {
      return fixed(speedOf(clip) * clipScale(clip, member.capture!.options), 2)
    })]))
}

function takeShare (g: Gait): string {
  return Object.keys(g.clipShare)
    .map(clip => `${clip} ${percent(g.clipShare[clip], 0)}% (chest ${fixed(g.chestByClip[clip])})`).join('; ')
}

function gaitTables (behaviour: Behaviour, gaits: Gait[], names: string[]): void {
  section(`${behaviour}: torso pitch per cycle (degrees, forward positive; mean and min..max over cycles)`,
    ['example', 'cycles', 'chest, 3D', 'head, 3D', 'chest, side view, exact', 'chest, side view, pixels'],
    gaits.map((g, i) => [names[i], `${g.cycles}`, range(g.chest), range(g.head), range(g.side), range(g.pixels)]))
  section(`${behaviour}: stride symmetry per cycle (gap between the two steps, %), then each leg's mean step`,
    ['example', 'length gap', 'duration gap', 'step length m, left / right', 'step time s, left / right'],
    gaits.map((g, i) => [names[i], gap(g.length), gap(g.duration), pair(g.legs.map(leg => leg.length)),
      pair(g.legs.map(leg => leg.duration))]))
  section(`${behaviour}: which takes the player plays, and where its steps cross a change of take`,
    ['example', 'frames per take', 'changes', 'steps across a change', 'step time across / within (s)'],
    gaits.map((g, i) => [names[i], takeShare(g), `${g.switches}`, percent(g.mixed.share, 0) + '%',
      pair([g.mixed.duration, g.mixed.pureDuration])]))
}

function handCell (hand: { reach: number, path: number }): string {
  return `${percent(hand.reach, 1)} / ${percent(hand.path, 0)}`
}

function idleTable (subjects: Subject[], reports: Idle[], control: string): void {
  section(`idle${control}: travel over one loop period, as a share of body height (%)`,
    ['example', 'period frames', 'pelvis to chest per breath', 'chest height', 'chest per second',
      'shoulders above pelvis', 'head reach / path'],
    reports.map((r, i) => [subjects[i].name, `${r.period}`, percent(r.breath, 2), percent(r.chest, 2),
      percent(r.chestPerSecond, 2), percent(r.shoulders, 2),
      `${percent(r.head.reach, 2)} / ${percent(r.head.path, 0)}`]))
  section(`idle${control}: hands (reach from the mean position / path over two periods, % of body height) and ` +
    'weight shift',
    ['example', 'left hand', 'right hand', 'weight share range', 'pelvis sway', 'planted share left / right'],
    reports.map((r, i) => [subjects[i].name, ...r.hands.map(hand => handCell(hand)), percent(r.shift.range, 1),
      percent(r.shift.pelvisSway, 2), pair(r.shift.plantedShare)]))
}

function attackTable (subjects: Subject[], reports: Attack[]): void {
  const title = 'attack: the take each example plays, its striking hand, and the hand\'s peak reach forward and ' +
    'height above the pelvis (% of body height)'
  section(title, ['example', 'take', 'attack', 'hand', 'reach', 'lift'], reports.map((r, i) => {
    return [subjects[i].name, r.take, r.attack ?? '-', r.hand, percent(r.reach, 0), percent(r.lift, 0)]
  }))
}

function gatesTable (measured: Measured[]): void {
  const rows = measured.flatMap(gateRows)
  section('gates (docs/plans/2026-11-06-motion-from-review.md)', ['gate', 'example', 'measured', 'result'],
    rows.map(row => [row.gate, row.example, row.value, row.pass ? 'pass' : 'FAIL']))
  const failed = rows.filter(row => !row.pass).length
  console.log(`\n${failed === 0 ? 'every gate passes' : `${failed} of ${rows.length} gate checks fail`}`)
}

const wanted = process.argv.slice(2)
const names = wanted.length > 0 ? wanted : SKINNED_HUMANOIDS
const subjects = names.map(name => subjectFor(join(ROOT, 'examples', name)))
takesTables(clipsOf(), subjects)
const [walks, runs] = GAITS.map(behaviour => subjects.map(subject => gaitReport(subject, behaviour)))
gaitTables('walk', walks, names)
gaitTables('run', runs, names)
const idles = subjects.map(idleReport)
const stills = subjects.map(subject => idleReport({ ...subject, idleLayer: false }))
idleTable(subjects, idles, '')
idleTable(subjects, stills, ', still control (the idle layer off)')
const attacks = subjects.map(attackReport)
attackTable(subjects, attacks)
gatesTable(subjects.map((subject, i) => ({
  name: subject.name, walk: walks[i], run: runs[i], idle: idles[i], still: stills[i], attack: attacks[i]
})))
