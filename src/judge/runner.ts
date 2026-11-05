import { extractAnswers, problemsWithAnswers } from './answers.ts'
import type { ChoiceKey } from './choice.ts'
import type { PanelKey } from './packet.ts'

export type Reply = { text: string, durationMs: number, costUsd?: number }
export type Ask = (model: string, prompt: string, cwd: string, timeoutMs: number) => Promise<Reply>
export type Spent = { durationMs: number, costUsd?: number, attempts: number }
export type JudgeRun = Spent & { model: string, answers: Record<string, unknown> }
export type Outcome = { model: string, run?: JudgeRun, failure?: string, spent?: Spent }

class JudgeFailure extends Error {
  spent: Spent

  constructor (message: string, spent: Spent) {
    super(message)
    this.spent = spent
  }
}

export const MODELS = ['opus', 'sonnet', 'haiku'] as const
export const PROMPT = 'Read the file questions.md in the current folder. Then look at every item image it lists, ' +
  'one at a time, with the Read tool. Answer with only the JSON object that questions.md asks for, and nothing else.'
const ATTEMPTS = 2
export const BUDGET_MS = 10 * 60 * 1000

function spentSoFar (durationMs: number, costUsd: number | undefined, attempts: number): Spent {
  return { durationMs, ...(costUsd === undefined ? {} : { costUsd }), attempts }
}

export async function runJudge (ask: Ask, model: string, cwd: string, key: PanelKey | ChoiceKey): Promise<JudgeRun> {
  const started = Date.now()
  const items = Object.keys(key.items)
  let [durationMs, attempts] = [0, 0]
  let costUsd: number | undefined
  let problems: string[] = []
  for (; attempts < ATTEMPTS; attempts++) {
    const remaining = BUDGET_MS - (Date.now() - started)
    if (remaining <= 0) {
      problems = [`no time left of ${BUDGET_MS / 60000} minutes`]
      break
    }
    let reply: Reply
    try {
      reply = await ask(model, PROMPT, cwd, remaining)
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      throw new JudgeFailure(why, spentSoFar(Date.now() - started, costUsd, attempts + 1))
    }
    durationMs += reply.durationMs
    if (reply.costUsd !== undefined) costUsd = (costUsd ?? 0) + reply.costUsd
    const answers = extractAnswers(reply.text, items)
    problems = answers === undefined
      ? [`no JSON object with the panel's items in the reply: ${reply.text.slice(0, 200)}`]
      : problemsWithAnswers(answers, key)
    if (answers !== undefined && problems.length === 0) {
      return { model, answers, ...spentSoFar(durationMs, costUsd, attempts + 1) }
    }
  }
  const message = `${problems.join('; ')} (after ${attempts} attempts)`
  throw new JudgeFailure(message, spentSoFar(durationMs, costUsd, attempts))
}

export async function runJudges (
  ask: Ask, cwd: string, key: PanelKey | ChoiceKey, models: readonly string[] = MODELS
): Promise<Outcome[]> {
  return Promise.all(models.map(async (model): Promise<Outcome> => {
    try {
      return { model, run: await runJudge(ask, model, cwd, key) }
    } catch (err) {
      if (err instanceof JudgeFailure) return { model, failure: err.message, spent: err.spent }
      return { model, failure: err instanceof Error ? err.message : String(err) }
    }
  }))
}
