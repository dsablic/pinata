import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'
import { ROOT } from '../cli/paths.ts'
import { COMMANDS, commandNamed, invalidArguments } from './commands.ts'
import type { Args, Command } from './commands.ts'
import { bufferIo, messageOf, pinataInvoke } from './io.ts'

export const PROTOCOL_VERSIONS = ['2025-06-18', '2024-11-05']
const AUTHORING_URI = 'pinata://docs/authoring'
const AUTHORING_FILE = join(ROOT, 'docs', 'authoring.md')
const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const INTERNAL_ERROR = -32603
const RESOURCE_NOT_FOUND = -32002

type Id = string | number | null
type Message = { jsonrpc?: unknown, id?: unknown, method?: unknown, params?: unknown }
type Reply = { jsonrpc: '2.0', id: Id, result?: unknown, error?: { code: number, message: string } }
type Failure = { code: number, message: string }

const INSTRUCTIONS = 'Piñata makes pixel-art game characters from text files. Read the resource ' +
  `${AUTHORING_URI} first. Tools: ${COMMANDS.map(command => command.name).join(', ')}. A failed gate is an error ` +
  'result whose hints name the file to fix; engine notes do not fail a command.'

function version (): string {
  return (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0'
}

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type Listing = Map<string, string>

function stamp (path: string): string {
  const { mtimeMs, size } = statSync(path)
  return `${mtimeMs}:${size}`
}

function topLevel (dir: string | undefined): Listing {
  const found: Listing = new Map()
  try {
    if (dir !== undefined) for (const name of readdirSync(dir)) found.set(name, stamp(join(dir, name)))
  } catch {
    found.clear()
  }
  return found
}

function writtenSince (dir: string | undefined, before: Listing): string[] {
  const after = topLevel(dir)
  const written: string[] = []
  for (const [name, mark] of after) {
    if (before.get(name) === mark) continue
    const path = join(dir as string, name)
    try {
      if (!statSync(path).isDirectory()) written.push(name)
      else if (!before.has(name)) written.push(...filesBelow(path).map(file => join(name, file)))
    } catch {
      continue
    }
  }
  return written.sort()
}

function filesBelow (dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(dir, join(entry.parentPath, entry.name)))
}

function resultOf (lines: string[], status: number, files: string[]): unknown {
  const structured = { status, files }
  const prose = [...lines, ...(files.length === 0 ? [] : ['files written:', ...files.map(f => `  ${f}`)]),
    `exit status: ${status}`].join('\n')
  return {
    isError: status !== 0,
    content: [{ type: 'text', text: prose }, { type: 'text', text: JSON.stringify(structured) }],
    structuredContent: structured
  }
}

function toolResult (command: Command, args: Args): unknown {
  const wrong = invalidArguments(command, args)
  const argv = wrong === undefined ? command.argv(args) : wrong
  if (typeof argv === 'string') return resultOf([argv, command.usage(pinataInvoke)], 2, [])
  const out = command.output(args)
  const dir = out === undefined ? undefined : resolve(out)
  const { io, lines } = bufferIo()
  const before = topLevel(dir)
  let status: number
  try {
    status = command.run(argv, io, pinataInvoke)
  } catch (err) {
    lines.push(messageOf(err))
    status = 2
  }
  return resultOf(lines, status, status === 2 ? [] : writtenSince(dir, before))
}

function callTool (params: unknown): unknown | Failure {
  if (!isRecord(params) || typeof params.name !== 'string') {
    return { code: INVALID_PARAMS, message: 'tools/call needs a tool name' }
  }
  const command = commandNamed(params.name)
  if (command === undefined) return { code: INVALID_PARAMS, message: `unknown tool '${params.name}'` }
  if (params.arguments !== undefined && !isRecord(params.arguments)) {
    return { code: INVALID_PARAMS, message: 'tool arguments must be an object' }
  }
  return toolResult(command, params.arguments ?? {})
}

function listTools (): unknown {
  return {
    tools: COMMANDS.map(command => ({
      name: command.name, title: `pinata ${command.name}`, description: command.description, inputSchema: command.schema
    }))
  }
}

function listResources (): unknown {
  return {
    resources: [{
      uri: AUTHORING_URI,
      name: 'authoring',
      title: 'Piñata authoring guide',
      description: 'How to write a character package, read the gates and fix failures',
      mimeType: 'text/markdown'
    }]
  }
}

function readResource (params: unknown): unknown | Failure {
  if (!isRecord(params) || typeof params.uri !== 'string') {
    return { code: INVALID_PARAMS, message: 'resources/read needs a uri' }
  }
  if (params.uri !== AUTHORING_URI) return { code: RESOURCE_NOT_FOUND, message: `unknown resource '${params.uri}'` }
  const text = readFileSync(AUTHORING_FILE, 'utf8')
  return { contents: [{ uri: AUTHORING_URI, mimeType: 'text/markdown', text }] }
}

function initialize (params: unknown): unknown | Failure {
  if (!isRecord(params) || typeof params.protocolVersion !== 'string') {
    return { code: INVALID_PARAMS, message: 'initialize needs a protocolVersion' }
  }
  const asked = params.protocolVersion
  return {
    protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
    capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false } },
    serverInfo: { name: 'pinata', title: 'Piñata', version: version() },
    instructions: INSTRUCTIONS
  }
}

const METHODS: Record<string, (params: unknown) => unknown | Failure> = {
  initialize,
  ping: () => ({}),
  'tools/list': listTools,
  'tools/call': callTool,
  'resources/list': listResources,
  'resources/read': readResource
}

function isFailure (value: unknown): value is Failure {
  return isRecord(value) && typeof value.code === 'number' && typeof value.message === 'string' &&
    Object.keys(value).length === 2
}

function failure (id: Id, error: Failure): Reply {
  return { jsonrpc: '2.0', id, error }
}

export function handle (message: unknown): Reply | undefined {
  if (!isRecord(message) || message.jsonrpc !== '2.0') {
    return failure(null, { code: INVALID_REQUEST, message: 'a message is a JSON-RPC 2.0 object' })
  }
  const { id, method, params } = message as Message
  const hasId = id !== undefined
  if (hasId && typeof id !== 'string' && typeof id !== 'number') {
    return failure(null, { code: INVALID_REQUEST, message: 'id must be a string or a number' })
  }
  if (typeof method !== 'string') {
    return hasId && !('result' in message) && !('error' in message)
      ? failure(id as Id, { code: INVALID_REQUEST, message: 'a request needs a method' })
      : undefined
  }
  if (!hasId) return undefined
  const known = METHODS[method]
  if (known === undefined || !Object.hasOwn(METHODS, method)) {
    return failure(id as Id, { code: METHOD_NOT_FOUND, message: `method not found: ${method}` })
  }
  try {
    const result = known(params)
    return isFailure(result) ? failure(id as Id, result) : { jsonrpc: '2.0', id: id as Id, result }
  } catch (err) {
    return failure(id as Id, { code: INTERNAL_ERROR, message: messageOf(err) })
  }
}

export function respondTo (line: string): Reply | undefined {
  let message: unknown
  try {
    message = JSON.parse(line)
  } catch {
    return failure(null, { code: PARSE_ERROR, message: 'parse error: a message is one line of JSON' })
  }
  return handle(message)
}

export function claimStdout (): (text: string) => void {
  const protocol = process.stdout.write.bind(process.stdout)
  const toStderr = (...parts: unknown[]): void => console.error(...parts)
  Object.assign(console, { log: toStderr, info: toStderr, debug: toStderr, dir: toStderr, table: toStderr })
  process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write
  return text => void protocol(text)
}

export function serve (input: Readable, write: (text: string) => void, log: (line: string) => void): Promise<void> {
  const lines = createInterface({ input })
  lines.on('line', line => {
    if (line.trim() === '') return
    const reply = respondTo(line)
    if (reply !== undefined) write(`${JSON.stringify(reply)}\n`)
  })
  log('pinata mcp: serving on stdio')
  return new Promise(done => lines.on('close', done))
}
