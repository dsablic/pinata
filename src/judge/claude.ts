import { spawn } from 'node:child_process'
import { isRecord } from '../formats/validate.ts'
import type { Ask, Reply } from './runner.ts'

const ISOLATION_ENV = { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1' }

export function claudeArgs (model: string, prompt: string, dir: string): string[] {
  return [
    '-p', prompt,
    '--model', model,
    '--output-format', 'json',
    '--tools', 'Read',
    '--allowedTools', `Read(/${dir}/**)`,
    '--permission-mode', 'dontAsk',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--add-dir', '.'
  ]
}

export function replyOf (stdout: string): Reply {
  const parsed: unknown = JSON.parse(stdout)
  if (!isRecord(parsed) || typeof parsed.result !== 'string') throw new Error('claude printed no result')
  if (parsed.is_error === true) throw new Error(`claude reported an error: ${parsed.result}`)
  const costUsd = typeof parsed.total_cost_usd === 'number' ? { costUsd: parsed.total_cost_usd } : {}
  const durationMs = typeof parsed.duration_ms === 'number' ? parsed.duration_ms : 0
  return { text: parsed.result, durationMs, ...costUsd }
}

export const askClaude: Ask = (model, prompt, cwd, timeoutMs) => {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn('claude', claudeArgs(model, prompt, cwd), {
      cwd, env: { ...process.env, ...ISOLATION_ENV }, stdio: ['ignore', 'pipe', 'pipe']
    })
    let [stdout, stderr] = ['', '']
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${model} did not answer within ${Math.round(timeoutMs / 1000)} s`))
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', err => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', code => {
      clearTimeout(timer)
      try {
        const reply = replyOf(stdout)
        resolve({ ...reply, durationMs: reply.durationMs || Date.now() - started })
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err)
        reject(new Error(`${model}: claude exited ${code}: ${why} ${stderr.slice(0, 300)}`.trim()))
      }
    })
  })
}
