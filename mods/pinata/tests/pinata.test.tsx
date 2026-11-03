import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { checkoutsFor, guessMode, layoutFor } from '../hooks/logic.ts'

const PANE = {
  plugin: 'pinata',
  component: 'Pane',
  requestId: 'pinata',
  props: {
    title: 'Piñata',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {}
  }
} as const

type Env = Record<string, string | undefined>
type Files = Record<string, string>
type Spawned = (readonly string[])[]

const TERMINAL: Env = { TERM_PROGRAM: 'Apple_Terminal', TMPDIR: '/tmp' }
const CHECKOUT: Files = { 'package.json': '{ "name": "pinata" }', 'src/cli/live.ts': '' }
const NOT_PINATA: Files = { ...CHECKOUT, 'package.json': '{ "name": "deploy" }' }
const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const

function fileAt (files: Files, path: string): string | undefined {
  const name = Object.keys(files).find(name => path.endsWith(`/${name}`))
  return name === undefined ? undefined : files[name]
}

function engine (on: On, env: Env, writes: string[], files: Files = CHECKOUT, spawned: Spawned = []) {
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'pinata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const shown = { id: 'pinata', title: 'Piñata', isShown: true, isFocused: false, isPlaced: true }
  on('ui.panes', () => ({ value: [shown] }))
  on('ui.blit', () => ({ value: {} }))
  on('env.get', (_, e) => ({ value: env[e.name] }))
  on('fs.read', (_, e) => {
    const text = fileAt(files, e.path)
    if (text === undefined) throw new Error(`no file at ${e.path}`)
    return { value: text }
  })
  on('fs.exists', (_, e) => ({ value: fileAt(files, e.path) !== undefined }))
  on('fs.write', (_, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  on('process.spawn', async function * (_, e) {
    spawned.push(e.argv)
    await clock.sleep(60000)
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {} }))
  return clock
}

test('iTerm2 3.5+ gets a terminal Image with alt text', async ($, on) => {
  engine(on, { TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.7.6', TMPDIR: '/tmp/' }, [])
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const image = await ui.find({ type: 'Image', key: 'frame' })
  expect(image?.props.alt).toBe('Piñata, idle')
  expect(image?.props.columns).toBe(40)
  await ui.unmount()
})

test('other terminals get a half-block Raster', async ($, on) => {
  engine(on, TERMINAL, [])
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const raster = await ui.find({ type: 'Raster', key: 'frame' })
  expect(raster?.props.columns).toBe(50)
  expect(raster?.props.rows).toBe(28)
  expect((await ui.find({ type: 'Text', text: /pinata hit/ }))?.text).toBe('idle · /pinata hit')
  await ui.unmount()
})

test('other surfaces get a line of text', async ($, on) => {
  engine(on, {}, [])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toMatch(/Piñata: idle/)
  await ui.unmount()
})

test('prompts and tool calls become events for the live renderer', async ($, on) => {
  const writes: string[] = []
  engine(on, { TMPDIR: '/tmp/' }, writes)
  await $.session.start(START)
  await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  const last = writes[writes.length - 1] ?? ''
  expect(last.trim().split('\n').map(line => line.split(' ')[1])).toEqual(['thinking', 'toolStart', 'thinking'])
})

test('layouts fit the pane and the terminal guess follows the docs', () => {
  expect(layoutFor('image', 30, 40)).toEqual({ format: 'png', px: 64, columns: 30, rows: 16 })
  expect(layoutFor('raster', 200, 20)).toEqual({ format: 'cells', px: 16, columns: 32, rows: 18 })
  expect(guessMode({ term: 'iTerm.app', termVersion: '3.4.19' })).toBe('raster')
  expect(guessMode({ term: 'ghostty' })).toBe('image')
  expect(guessMode({ kitty: '1' })).toBe('image')
  expect(guessMode({ term: 'WezTerm' })).toBe('raster')
})

test('the live renderer runs once from the Piñata checkout', async ($, on) => {
  const spawned: Spawned = []
  const clock = engine(on, TERMINAL, [], CHECKOUT, spawned)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (let i = 0; i < 4; i++) await clock.advance(500)
  expect(spawned.map(argv => argv[1]?.endsWith('/src/cli/live.ts'))).toEqual([true])
  await ui.unmount()
})

test('a folder that is not Piñata stops the pane, and /pinata open retries it', async ($, on) => {
  const files = { ...NOT_PINATA }
  const spawned: Spawned = []
  const clock = engine(on, TERMINAL, [], files, spawned)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(1000)
  expect(spawned).toEqual([])
  expect((await ui.find({ type: 'Text', text: /stopped/ }))?.text).toMatch(/no Piñata checkout was found/)
  Object.assign(files, CHECKOUT)
  const opened = await $.command.run({
    command: 'pinata', args: 'open', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 }
  })
  expect(opened.text).toBe('Piñata pane opened.')
  await clock.advance(1000)
  expect(spawned.length).toBe(1)
  await ui.unmount()
})

test('the renderer is looked for in the mod\'s repo, then the marketplace checkout', () => {
  expect(checkoutsFor('/src/pinata/mods/pinata/')).toEqual(['/src/pinata'])
  expect(checkoutsFor('/home/me/.claude/plugins/cache/pinata/pinata/0.1.0'))
    .toEqual(['/home/me/.claude/plugins/marketplaces/pinata'])
  expect(checkoutsFor('/home/me/cache/tools/x/pinata')).toEqual([])
})
