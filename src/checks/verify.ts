export type Status = 'pass' | 'fail' | 'changed'
export type Outcome = { status: Status, headline: string, detail: string[] }

export const DETAIL_LINES = 8

export function tailOf (lines: string[]): string[] {
  return lines.filter(line => line.trim() !== '').slice(-DETAIL_LINES)
}

export function matching (lines: string[], pattern: RegExp): string[] {
  return lines.filter(line => pattern.test(line)).slice(0, DETAIL_LINES)
}

export const RETRYABLE = /EADDRINUSE|dispatchMouseEvent/

export function shouldRetry (output: string): boolean {
  return RETRYABLE.test(output)
}

export type Parsed = { only: string[], skip: string[], accept: string[], problems: string[] }

function listOf (value: string | undefined): string[] {
  return value === undefined ? [] : value.split(',').filter(name => name !== '')
}

export function parseArgs (argv: string[], steps: string[], accepting: string[]): Parsed {
  const parsed: Parsed = { only: [], skip: [], accept: [], problems: [] }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag !== '--only' && flag !== '--skip' && flag !== '--accept') {
      parsed.problems.push(`unknown argument '${flag}'`)
      continue
    }
    i++
    const names = listOf(value)
    if (names.length === 0) parsed.problems.push(`${flag} needs a step name`)
    if (flag === '--only') parsed.only.push(...names)
    else if (flag === '--skip') parsed.skip.push(...names)
    else parsed.accept.push(...(names.includes('all') ? accepting : names))
  }
  const unknown = [...parsed.only, ...parsed.skip].filter(name => !steps.includes(name))
  const notAcceptable = parsed.accept.filter(name => !accepting.includes(name))
  for (const name of unknown) parsed.problems.push(`unknown step '${name}'; steps: ${steps.join(', ')}`)
  for (const name of notAcceptable) {
    parsed.problems.push(`'${name}' has no baseline; steps with one: ${accepting.join(', ')}`)
  }
  return parsed
}

export function selected (steps: string[], parsed: Parsed): string[] {
  if (parsed.accept.length > 0) return steps.filter(name => parsed.accept.includes(name))
  const chosen = parsed.only.length > 0 ? steps.filter(name => parsed.only.includes(name)) : steps
  return chosen.filter(name => !parsed.skip.includes(name))
}

export function summaryOf (outcomes: [string, Outcome][], seconds: number): string[] {
  const named = (status: Status): string[] => outcomes.filter(([, o]) => o.status === status).map(([name]) => name)
  const passed = named('pass')
  const failed = named('fail')
  const changed = named('changed')
  const counts = `${passed.length} passed, ${failed.length} failed, ${changed.length} changed`
  const lines = [`verify: ${counts} in ${seconds.toFixed(0)} s`]
  if (failed.length > 0) lines.push(`verify: failed: ${failed.join(', ')}`)
  if (changed.length > 0) {
    lines.push(`verify: changed: ${changed.join(', ')} (meant? npm run verify -- --accept <step>)`)
  }
  return lines
}
