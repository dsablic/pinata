import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { guessMode, layoutFor } from '../hooks/logic.ts'

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

function engine (on: On, env: Env, writes: string[]): void {
  on('command.register', () => ({ value: { command: 'pinata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('env.get', (_, e) => ({ value: env[e.name] }))
  on('fs.write', (_, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('clock.every', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {} }))
}

test('iTerm2 3.5+ gets a terminal Image with alt text', async ($, on) => {
  engine(on, { TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.7.6', TMPDIR: '/tmp/' }, [])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const image = await ui.find({ type: 'Image', key: 'frame' })
  expect(image?.props.alt).toBe('Piñata, idle')
  expect(image?.props.columns).toBe(40)
  await ui.unmount()
})

test('other terminals get a half-block Raster', async ($, on) => {
  engine(on, { TERM_PROGRAM: 'Apple_Terminal', TMPDIR: '/tmp' }, [])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
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
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
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
