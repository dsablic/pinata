import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { commandNamed } from '../src/tool/commands.ts'
import { CHARACTER_INVALID, CHARACTER_OK, characterVariant, patchJson, scratchDir } from './formats-fixtures.ts'

const ROGUE = new URL('../examples/rogue', import.meta.url).pathname
const PINATA = new URL('../src/cli/pinata.ts', import.meta.url).pathname
const AUTHORING = new URL('../docs/authoring.md', import.meta.url).pathname

type Reply = { id: number | null, result?: any, error?: { code: number, message: string } }

function cli (...argv: string[]): { status: number | null, stdout: string, stderr: string } {
  return spawnSync(process.execPath, [PINATA, ...argv], { encoding: 'utf8' })
}

async function withServer<T> (use: (call: (message: object | string) => Promise<Reply>) => Promise<T>): Promise<T> {
  const child = spawn(process.execPath, [PINATA, 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'] })
  child.stderr.resume()
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
  const call = async (message: object | string): Promise<Reply> => {
    child.stdin.write(`${typeof message === 'string' ? message : JSON.stringify(message)}\n`)
    return JSON.parse((await lines.next()).value as string)
  }
  try {
    return await use(call)
  } finally {
    child.kill()
  }
}

function normalised (name: string, bytes: Buffer, slots: string[]): Buffer {
  if (name === 'metrics.json') return Buffer.from(JSON.stringify({ ...JSON.parse(bytes.toString()), timing: 0 }))
  if (name !== 'summary.txt') return bytes
  return Buffer.from(slots.reduce((text, slot) => text.replaceAll(slot, '<dir>'), bytes.toString()))
}

function filesOf (dir: string, slots: string[]): Record<string, string> {
  const found: Record<string, string> = {}
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    found[path.slice(dir.length)] = normalised(entry.name, readFileSync(path), slots).toString('base64')
  }
  return found
}

function structured (result: any): { status: number, files: string[] } {
  return JSON.parse(result.content[1].text)
}

function toolCall (name: string, args: object, id = 1): object {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }
}

type Slot = { out: string, copy: string }
type Scenario = {
  tool: string
  args: (slot: Slot) => object
  cli: (slot: Slot) => string[]
  status?: number
  written?: (slot: Slot) => string
  mostCharacters?: number
}

const KNIGHT_SKIN = new URL('../examples/knight/skin.json', import.meta.url).pathname
const FILE = new URL('../package.json', import.meta.url).pathname

const MOST_EXPORT_CHARACTERS = 4000

const SCENARIOS: Scenario[] = [
  {
    tool: 'new',
    args: ({ out }) => ({ template: 'quadruped', dir: join(out, 'starter') }),
    cli: ({ out }) => ['new', '--template', 'quadruped', join(out, 'starter')],
    status: 0
  },
  {
    tool: 'new',
    args: ({ copy }) => ({ template: 'biped', dir: copy }),
    cli: ({ copy }) => ['new', '--template', 'biped', copy],
    status: 2
  },
  {
    tool: 'check',
    args: ({ out }) => ({ dir: CHARACTER_OK, out }),
    cli: ({ out }) => ['check', CHARACTER_OK, '--out', out],
    status: 0
  },
  {
    tool: 'check',
    args: ({ copy }) => ({ dir: copy }),
    cli: ({ copy }) => ['check', copy],
    written: ({ copy }) => join(copy, 'report'),
    status: 0
  },
  {
    tool: 'check',
    args: ({ out }) => ({ dir: CHARACTER_INVALID, out }),
    cli: ({ out }) => ['check', CHARACTER_INVALID, '--out', out],
    status: 2
  },
  {
    tool: 'check',
    args: () => ({ dir: CHARACTER_OK, out: FILE }),
    cli: () => ['check', CHARACTER_OK, '--out', FILE],
    status: 2
  },
  {
    tool: 'skin',
    args: ({ out }) => ({ action: 'guide', dir: ROGUE, out }),
    cli: ({ out }) => ['skin', 'guide', ROGUE, out],
    status: 0
  },
  {
    tool: 'skin',
    args: ({ out }) => ({ action: 'preview', dir: ROGUE, out, clean: true }),
    cli: ({ out }) => ['skin', 'preview', ROGUE, join(ROGUE, 'skin.json'), out, '--clean'],
    status: 0
  },
  {
    tool: 'skin',
    args: ({ out }) => ({ action: 'preview', dir: ROGUE, out, skin: KNIGHT_SKIN }),
    cli: ({ out }) => ['skin', 'preview', ROGUE, KNIGHT_SKIN, out],
    status: 1
  },
  {
    tool: 'skin',
    args: () => ({ action: 'fit', dir: ROGUE, scale: 3, pixelsPerMetre: 80 }),
    cli: () => ['skin', 'fit', ROGUE, '--scale', '3', '--pixels-per-metre', '80'],
    status: 0
  },
  {
    tool: 'render',
    args: ({ out }) => ({ dir: ROGUE, out }),
    cli: ({ out }) => ['render', ROGUE, out],
    status: 0
  },
  {
    tool: 'export',
    args: ({ out }) => ({ dir: ROGUE, out }),
    cli: ({ out }) => ['export', ROGUE, out],
    mostCharacters: MOST_EXPORT_CHARACTERS
  },
  {
    tool: 'export',
    args: ({ out }) => ({ dir: CHARACTER_OK, out }),
    cli: ({ out }) => ['export', CHARACTER_OK, out],
    status: 2
  }
]

function slotOf (): Slot {
  return { out: scratchDir('pinata-out-'), copy: characterVariant(() => {}) }
}

function printed (text: string, slots: string[]): string[] {
  return text.split('\n')
    .map(line => slots.reduce((kept, slot) => kept.replaceAll(slot, '<out>'), line).replace(/ \([0-9.]+ s\)/, ''))
    .filter(line => line !== '')
    .sort()
}

function toolLines (text: string): string[] {
  const kept = text.split('\n')
  const listing = kept.findIndex(line => line === 'files written:')
  const end = kept.findIndex(line => line.startsWith('exit status: '))
  return kept.slice(0, listing < 0 ? end : listing)
}

test('every tool prints the same lines, writes the same files and returns the same status as its command', async () => {
  await withServer(async call => {
    for (const [i, scenario] of SCENARIOS.entries()) {
      const [cliSlot, toolSlot] = [0, 1].map(() => slotOf())
      const run = cli(...scenario.cli(cliSlot))
      const reply = await call(toolCall(scenario.tool, scenario.args(toolSlot), i))
      const label = `${scenario.tool} ${JSON.stringify(scenario.args({ out: '<out>', copy: '<copy>' }))}`
      const { result } = reply
      const said = `${label}: ${run.stdout}${run.stderr}`
      if (scenario.status !== undefined) assert.equal(run.status, scenario.status, said)
      assert.equal(structured(result).status, run.status, label)
      assert.equal(result.isError, run.status !== 0, label)
      const slots = [cliSlot.out, cliSlot.copy, toolSlot.out, toolSlot.copy]
      assert.deepEqual(printed(toolLines(result.content[0].text).join('\n'), slots),
        printed(run.stdout + run.stderr, slots), label)
      const size = result.content.reduce((total: number, block: { text: string }) => total + block.text.length, 0)
      assert.ok(size <= (scenario.mostCharacters ?? Infinity), `${label}: ${size} characters`)
      const where = scenario.written ?? (slot => slot.out)
      if (run.status !== 2) assert.deepEqual(filesOf(where(toolSlot), slots), filesOf(where(cliSlot), slots), label)
    }
  })
})

test('a tool result lists only what the command wrote, and refusals list nothing', async () => {
  const dir = scratchDir('pinata-existing-')
  writeFileSync(join(dir, 'keep.txt'), 'kept')
  mkdirSync(join(dir, 'old'))
  writeFileSync(join(dir, 'old', 'big.bin'), 'x')
  await withServer(async call => {
    const guide = await call(toolCall('skin', { action: 'guide', dir: ROGUE, out: dir }))
    const files: string[] = structured(guide.result).files
    assert.ok(files.includes('guide.md') && !files.includes('keep.txt') && !files.some(f => f.startsWith('old')))
    const refused = await call(toolCall('new', { template: 'biped', dir }))
    assert.equal(structured(refused.result).status, 2)
    assert.deepEqual(structured(refused.result).files, [])
  })
})

test('a passing check puts its notes and verdict in the text result a client shows', async () => {
  await withServer(async call => {
    const { result } = await call(toolCall('check', { dir: CHARACTER_OK, out: scratchDir('pinata-note-') }))
    assert.equal(result.isError, false)
    assert.equal(result.structuredContent, undefined)
    assert.match(result.content[0].text, /idle foot gate skipped/)
    assert.match(result.content[0].text, /PASS/)
  })
})

test('check with an out directory removes nothing but its own outputs', () => {
  const out = scratchDir('pinata-keep-')
  writeFileSync(join(out, 'notes.txt'), 'mine')
  writeFileSync(join(out, 'sheet.png'), 'stale')
  assert.equal(cli('check', CHARACTER_OK, '--out', out).status, 0)
  assert.equal(readFileSync(join(out, 'notes.txt'), 'utf8'), 'mine')
  assert.notEqual(readFileSync(join(out, 'sheet.png'), 'utf8'), 'stale')
})

test('unknown arguments and wrong types are tool errors naming the argument', async () => {
  await withServer(async call => {
    const ask = async (name: string, args: object): Promise<string> => {
      const reply = await call(toolCall(name, args))
      assert.equal(reply.result.isError, true)
      assert.equal(structured(reply.result).status, 2)
      return reply.result.content[0].text
    }
    const preview = { action: 'preview', dir: ROGUE, out: '/tmp/x', clean: 'true' }
    assert.match(await ask('skin', preview), /'clean' must be a boolean/)
    assert.match(await ask('check', { dir: 5 }), /'dir' must be a string/)
    assert.match(await ask('check', { dir: CHARACTER_OK, outt: '/tmp/x' }), /unknown argument 'outt'/)
    assert.match(await ask('skin', { action: 'spin', dir: ROGUE }), /'action' must be one of/)
  })
})

test('the server negotiates the protocol version and answers ping', async () => {
  await withServer(async call => {
    const init = (protocolVersion: string): object =>
      ({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion, capabilities: {} } })
    assert.equal((await call(init('2024-11-05'))).result.protocolVersion, '2024-11-05')
    assert.equal((await call(init('2025-03-26'))).result.protocolVersion, '2025-06-18')
    assert.equal((await call(init('2099-01-01'))).result.protocolVersion, '2025-06-18')
    assert.deepEqual((await call({ jsonrpc: '2.0', id: 2, method: 'ping' })).result, {})
  })
})

test('malformed requests and unknown methods, tools and resources get JSON-RPC errors', async () => {
  await withServer(async call => {
    assert.equal((await call('{not json')).error?.code, -32700)
    assert.equal((await call({ id: 1, method: 'ping' })).error?.code, -32600)
    assert.equal((await call({ jsonrpc: '2.0', id: 2, method: 'tools/nope' })).error?.code, -32601)
    const unknown = { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nope' } }
    assert.equal((await call(unknown)).error?.code, -32602)
    const resource = { jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'pinata://docs/nope' } }
    assert.equal((await call(resource)).error?.code, -32002)
  })
})

test('a notification gets no reply, and a missing argument is a tool error naming it', async () => {
  await withServer(async call => {
    const notification = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    const ping = JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'ping' })
    assert.equal((await call(`${notification}\n${ping}`)).id, 8)
    const bad = await call({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'export', arguments: {} } })
    assert.equal(bad.id, 9)
    assert.equal(bad.result.isError, true)
    assert.match(bad.result.content[0].text, /missing arguments: dir, out/)
  })
})

test('the tools list has one tool per command and the authoring guide is a resource', async () => {
  await withServer(async call => {
    const tools = (await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools
    assert.deepEqual(tools.map((t: { name: string }) => t.name), ['new', 'check', 'skin', 'render', 'export', 'review'])
    for (const tool of tools) assert.equal(tool.inputSchema.type, 'object')
    const listed = (await call({ jsonrpc: '2.0', id: 2, method: 'resources/list' })).result.resources
    const read = await call({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: listed[0].uri } })
    assert.equal(read.result.contents[0].text, readFileSync(AUTHORING, 'utf8'))
  })
})

test('no arguments prints the usage, an unknown command exits 2', () => {
  const help = cli()
  assert.equal(help.status, 0)
  assert.match(help.stdout, /^usage: pinata <command>/)
  const unknown = cli('bogus')
  assert.equal(unknown.status, 2)
  assert.match(unknown.stderr, /unknown command 'bogus'/)
})

test('export of a one-view skin points to the five-view form', () => {
  const dir = characterVariant(copy => {
    patchJson(copy, 'skin.json', json => {
      const { name, palette, views } = json
      for (const key of Object.keys(json)) delete json[key]
      Object.assign(json, { name, view: 'side-right', palette, parts: views.side.parts })
    })
  }, ROGUE)
  const run = cli('export', dir, scratchDir('pinata-out-'))
  assert.equal(run.status, 2)
  assert.match(run.stderr, /one-view form: export draws eight directions and needs the five-view form, "views": \{/)
})

test('full is a boolean argument that asks export for the full report', () => {
  const { argv } = commandNamed('export') as NonNullable<ReturnType<typeof commandNamed>>
  assert.deepEqual(argv({ dir: 'a', out: 'b', full: true }), ['a', 'b', '--full'])
  assert.deepEqual(argv({ dir: 'a', out: 'b' }), ['a', 'b'])
  assert.equal(cli('export', ROGUE).status, 2)
  assert.match(cli('export', ROGUE).stderr, /\[--full\]/)
})
