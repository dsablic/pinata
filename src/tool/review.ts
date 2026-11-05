import { join, resolve } from 'node:path'
import { choicePanel, writePanel } from '../cli/choice-panel.ts'
import { directionBase, directionItems } from '../export/direction-panel.ts'
import { DIRECTION_CUES } from '../export/direction-cues.ts'
import { viewOf } from '../export/directions.ts'
import type { Direction } from '../export/directions.ts'
import { record as recordSubject } from '../export/record.ts'
import type { Behaviour } from '../export/record.ts'
import { scoreChoices } from '../judge/choice.ts'
import type { ChoiceAnswers, ChoiceKey, ChoiceScore, LabelScore } from '../judge/choice.ts'
import { askClaude } from '../judge/claude.ts'
import { lintPanel } from '../judge/lint.ts'
import { describeCost, describeOutcome, MODELS, runJudges } from '../judge/runner.ts'
import type { Ask } from '../judge/runner.ts'
import { withJudgeDir } from '../judge/sandbox.ts'
import { messageOf } from './io.ts'
import type { Invoke, Io } from './io.ts'
import { subjectFor } from './subject.ts'

export const IDLE_SHARE = 0.9
export const WALK_SHARE = 0.8
export const NO_SCORE = 3
const DIRECTION_RIGHT = { right: 2, of: MODELS.length }

export const reviewUsage = (invoke: Invoke): string =>
  `usage: ${invoke('review')} <character dir> [--walk] [--out <dir>]\n` +
  `       asks ${MODELS.length} blind AI judges (the claude CLI: ${MODELS.join(', ')}) which way each of the eight ` +
  `idle frames\n       faces; --walk adds the walk frame with the widest stride. It costs money (every judge's ` +
  `cost is printed, also\n       when one fails) and takes minutes. Writes the panel to <dir>/report/review (or ` +
  `--out).\n       exit status: 0 every gate met, 1 a gate missed, 2 refused, ${NO_SCORE} a judge failed so no ` +
  `score is given`

type Args = { dir: string, walk: boolean, out: string }

function parseArgs (argv: string[], usage: string): Args | string {
  const positional: string[] = []
  let [walk, out] = [false, undefined as string | undefined]
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--walk') walk = true
    else if (argv[i] === '--out') {
      out = argv[++i]
      if (out === undefined) return `--out needs a directory\n${usage}`
    } else if (argv[i].startsWith('--')) return `unknown option '${argv[i]}'\n${usage}`
    else positional.push(argv[i])
  }
  if (positional.length !== 1) return usage
  return { dir: resolve(positional[0]), walk, out: resolve(out ?? join(positional[0], 'report', 'review')) }
}

const percent = (share: number): string => `${(share * 100).toFixed(0)}%`

function onlyBehaviour (key: ChoiceKey, behaviour: Behaviour): ChoiceKey {
  const kept = Object.entries(key.items).filter(([, item]) => item.id.startsWith(`${behaviour}-`))
  return { ...key, items: Object.fromEntries(kept) }
}

function misread (label: LabelScore): string {
  const named = Object.entries(label.named).map(([name, n]) => `${name} ${n}`).join(', ')
  const view = viewOf(label.label as Direction)
  return `  ${label.label}: ${label.right} of ${label.asked} right, named ${named}. Draw the ${view} view with ` +
    DIRECTION_CUES[view]
}

function passes (score: ChoiceScore, least: number): boolean {
  const each = score.labels.every(l => l.right * DIRECTION_RIGHT.of >= l.asked * DIRECTION_RIGHT.right)
  return score.share >= least && each
}

function section (behaviour: Behaviour, score: ChoiceScore, least: number): string[] {
  const wrong = score.labels.filter(label => label.right < label.asked).sort((a, b) => a.right - b.right)
  const gate = `gate: ${percent(least)}, each direction at least ${DIRECTION_RIGHT.right} of ${DIRECTION_RIGHT.of}`
  return [
    `${behaviour}: ${score.right} of ${score.asked} right, ${percent(score.share)} (${gate}): ` +
      `${passes(score, least) ? 'PASS' : 'FAIL'}`,
    ...wrong.map(misread)
  ]
}

type Recorder = typeof recordSubject

export async function runReview (
  argv: string[], io: Io, invoke: Invoke, ask: Ask = askClaude, record: Recorder = recordSubject
): Promise<number> {
  const args = parseArgs(argv, reviewUsage(invoke))
  if (typeof args === 'string') {
    io.err(args)
    return 2
  }
  try {
    const behaviours: Behaviour[] = args.walk ? ['idle', 'walk'] : ['idle']
    const panel = choicePanel(directionBase('Character direction review', 'review'),
      directionItems(record(subjectFor(args.dir), behaviours), ''))
    const problems = lintPanel(panel.spec, panel.packet.images)
    if (problems.length > 0) {
      io.err(problems.join('\n'))
      return 2
    }
    io.out(writePanel(args.out, panel))
    const names = [...Object.keys(panel.packet.images), 'questions.md']
    const outcomes = await withJudgeDir(join(args.out, 'packet'), names, dir => {
      return runJudges(ask, dir, panel.packet.key)
    })
    outcomes.forEach(outcome => io.out(describeOutcome(outcome)))
    io.out(describeCost(outcomes))
    if (outcomes.some(outcome => outcome.run === undefined)) {
      io.err('review failed: a judge did not answer, so no score is given')
      return NO_SCORE
    }
    const answers = outcomes.map(outcome => outcome.run!.answers as ChoiceAnswers)
    const scored = behaviours.map(behaviour => {
      const score = scoreChoices(onlyBehaviour(panel.packet.key, behaviour), answers)
      return { behaviour, score, least: behaviour === 'idle' ? IDLE_SHARE : WALK_SHARE }
    })
    const lines = scored.flatMap(({ behaviour, score, least }) => section(behaviour, score, least))
    lines.forEach(line => io.out(line))
    return scored.every(({ score, least }) => passes(score, least)) ? 0 : 1
  } catch (err) {
    io.err(`could not review '${args.dir}': ${messageOf(err)}`)
    return 2
  }
}
