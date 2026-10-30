import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Mode } from '../types'
import { layoutFor, labelFor, blankCells, guessMode, isAltDeny, sameLayout } from './logic.ts'
import type { Layout } from './logic.ts'

const PANE = 'pinata'
const TITLE = 'Piñata'
const KEY = 'frame'
/** Where the Piñata repository is: two folders up when the mod is loaded from the repo's `mods/pinata`. */
const FALLBACK_REPO = '/Users/denis/pinata'
const IN_REPO = '/mods/pinata'

function repoOf ($: EngineInterface): string {
  const root = $.plugin.root.replace(/\/+$/, '')
  return root.endsWith(IN_REPO) ? root.slice(0, -IN_REPO.length) : FALLBACK_REPO
}
const FPS = 15
const QUIET_MS = 5000
const MANAGE_MS = 500
const MAX_FAILURES = 3
const BLANK_PNG = { rgba: 'AAAAAA==', width: 1, height: 1 }

const mode = atom({ plugin: 'pinata', key: 'mode' } as const, 'image' as Mode, { shape: 'mode-1' })
const label = atom({ plugin: 'pinata', key: 'label' } as const, 'idle', { shape: 'label-1' })

type Child = { layout: Layout, stop: () => void }

let want: Layout | undefined
let child: Child | undefined
let eventsPath: string | undefined
let seq = 0
let recent: string[] = []
let current = 'idle'
let quiet: { cancel: () => void } | undefined
let manager: { cancel: () => void } | undefined
let failures = 0
let shownWord = ''
let stopped: string | undefined
let lastFrame: { layout: Layout, png?: string, cells?: string } | undefined

function log ($: EngineInterface, what: string, err?: unknown): void {
  try {
    $.ui.log(`pinata: ${what}${err === undefined ? '' : `: ${String(err)}`}`, { to: 'debug' })
  } catch {}
}

function stopChild (): void {
  const running = child
  child = undefined
  running?.stop()
}

function giveUp ($: EngineInterface, reason: string): void {
  stopped = reason
  stopChild()
  log($, `stopped (${reason})`)
  void update($, label, () => 'stopped').catch(() => {})
}

function send ($: EngineInterface, name: string): void {
  try {
    quiet?.cancel()
    quiet = undefined
    if (name !== 'hit') current = name
    if (eventsPath === undefined) return
    seq++
    recent = [...recent, `${seq} ${name}`].slice(-8)
    $.fs.write(eventsPath, recent.join('\n') + '\n').catch(err => log($, 'event write failed', err))
  } catch (err) {
    log($, 'send failed', err)
  }
}

function settleLater ($: EngineInterface): void {
  try {
    quiet?.cancel()
    quiet = $.clock.after(QUIET_MS, () => send($, 'idle'))
  } catch (err) {
    log($, 'timer failed', err)
  }
}

async function show ($: EngineInterface, handle: Child, line: string): Promise<void> {
  const frame = JSON.parse(line) as { behaviour?: string, png?: string, cells?: string }
  const word = labelFor(frame.behaviour ?? '')
  if (word !== shownWord) {
    shownWord = word
    await update($, label, () => word)
  }
  if (child !== handle) return
  lastFrame = { layout: handle.layout, png: frame.png, cells: frame.cells }
  const blitted = handle.layout.format === 'png' && frame.png !== undefined
    ? await $.ui.blit({ requestId: PANE, key: KEY, source: { png: frame.png } })
    : frame.cells !== undefined
      ? await $.ui.blit({ requestId: PANE, key: KEY, cells: frame.cells })
      : {}
  if (blitted.deny !== undefined && handle.layout.format === 'png' && isAltDeny(blitted.deny, blitted.fix)) {
    log($, `no terminal images here (${blitted.deny}); drawing half-block cells`)
    want = undefined
    stopChild()
    await update($, mode, () => 'raster')
  }
}

function startChild ($: EngineInterface, layout: Layout, events: string): void {
  const repo = repoOf($)
  const argv = ['node', `${repo}/src/cli/live.ts`, '--events', events, '--start', current, '--format', layout.format,
    '--px', String(layout.px), '--fps', String(FPS), '--samples', '2']
  const stream = $.process.spawn({ argv, cwd: repo })
  const handle: Child = { layout, stop: () => { void stream.return({ code: null, signal: null }).catch(() => {}) } }
  child = handle
  void (async () => {
    let buffer = ''
    let frames = 0
    try {
      for await (const piece of stream) {
        if (child !== handle) break
        if (piece.stream === 'stderr') {
          log($, `live.ts: ${piece.text.slice(0, 500)}`)
          continue
        }
        buffer += piece.text
        const end = buffer.lastIndexOf('\n')
        if (end < 0) continue
        const lines = buffer.slice(0, end).split('\n')
        buffer = buffer.slice(end + 1)
        const newest = lines[lines.length - 1]
        if (newest !== undefined && newest !== '') await show($, handle, newest)
        frames++
      }
    } catch (err) {
      log($, 'frame stream failed', err)
    }
    if (child === handle) {
      child = undefined
      failures = frames > 0 ? 1 : failures + 1
      if (failures >= MAX_FAILURES) giveUp($, 'the live renderer kept exiting; see the debug log')
    }
  })()
}

async function manage ($: EngineInterface): Promise<void> {
  if (stopped !== undefined) return
  const panes = await $.ui.panes()
  const pane = panes.find(p => p.id === PANE)
  const layout = want
  if (pane === undefined || !pane.isShown || !pane.isPlaced || layout === undefined || eventsPath === undefined) {
    stopChild()
    return
  }
  if (child !== undefined && sameLayout(child.layout, layout)) return
  stopChild()
  startChild($, layout, eventsPath)
}

async function open ($: EngineInterface): Promise<string> {
  const opened = await $.ui.open({ id: PANE, title: TITLE })
  return opened.isPlaced ? 'Piñata pane opened.' : `Piñata pane waits: ${opened.reason}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    try {
      await $.command.register({
        name: 'pinata',
        description: 'Toggle the piñata pane; /pinata hit whacks it; /pinata pixels or blocks picks how it is drawn'
      })
      const tmp = (await $.env.get('TMPDIR')) ?? '/tmp/'
      eventsPath = `${tmp.endsWith('/') ? tmp : tmp + '/'}pinata-${Date.now()}.events`
      const term = await $.env.get('TERM_PROGRAM')
      const termVersion = await $.env.get('TERM_PROGRAM_VERSION')
      const kitty = await $.env.get('KITTY_WINDOW_ID')
      const termName = await $.env.get('TERM')
      await update($, mode, () => guessMode({ term, termVersion, kitty, termName }))
      manager?.cancel()
      manager = $.clock.every(MANAGE_MS, () => {
        manage($).catch(err => log($, 'manage failed', err))
      })
      void $.ui.open({ id: PANE, title: TITLE }).catch(err => log($, 'open failed', err))
    } catch (err) {
      log($, 'start failed', err)
    }
    return started
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'pinata' }, async ($, e) => {
    try {
      const arg = e.args.trim().toLowerCase()
      if (arg === 'hit' || arg === 'whack') {
        send($, 'hit')
        return { text: 'Whack!' }
      }
      if (arg === 'pixels' || arg === 'blocks') {
        want = undefined
        stopChild()
        await update($, mode, () => arg === 'pixels' ? 'image' : 'raster')
        return { text: arg === 'pixels' ? 'Drawing the piñata as a terminal image.' : 'Drawing the piñata in half-block cells.' }
      }
      if (arg === 'open') return { text: await open($) }
      if (arg === 'close') {
        await $.ui.close({ id: PANE })
        return { text: 'Piñata pane closed.' }
      }
      if (arg !== '') return { text: 'Usage: /pinata [open|close|hit|pixels|blocks]' }
      const pane = (await $.ui.panes()).find(p => p.id === PANE)
      if (pane?.isShown === true) {
        await $.ui.close({ id: PANE })
        return { text: 'Piñata pane closed.' }
      }
      if (stopped !== undefined) {
        stopped = undefined
        failures = 0
      }
      return { text: await open($) }
    } catch (err) {
      log($, 'command failed', err)
      return { text: 'The piñata could not do that; see the debug log.' }
    }
  })

  on('prompt.submit', async ($, e, next) => {
    send($, 'thinking')
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined) send($, 'toolStart')
    const ran = await next(e)
    if (e.agentId === undefined) {
      try {
        const failed = ran.deny !== undefined || ran.isError === true
        send($, failed ? 'error' : 'thinking')
        if (failed) settleLater($)
      } catch (err) {
        log($, 'tool result failed', err)
      }
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      if (e.reason === 'answer') send($, 'success')
      else if (e.reason === 'aborted') send($, 'idle')
      else send($, 'failure')
      settleLater($)
    }
    return done
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    stopChild()
    manager?.cancel()
    if (eventsPath !== undefined) send($, 'quit')
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const word = await read($, label)
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text>Piñata: {word} (the animation shows in the terminal)</Text>
    }
    const { Box, Text, Image, Raster } = $.ui.resolve(e)
    if (stopped !== undefined) return <Text dimColor>Piñata stopped: {stopped}. Run /pinata to try again.</Text>
    const layout = layoutFor(await read($, mode), e.props.bodyColumns, e.props.scroll.bodyRows)
    want = layout
    const kept = lastFrame !== undefined && sameLayout(lastFrame.layout, layout) ? lastFrame : undefined
    const alt = `Piñata, ${word}`
    const picture = layout.format === 'png'
      ? <Image key={KEY} source={kept?.png !== undefined ? { png: kept.png } : BLANK_PNG}
          columns={layout.columns} rows={layout.rows} alt={alt} />
      : <Raster key={KEY} cells={kept?.cells ?? blankCells(layout.columns, layout.rows)}
          columns={layout.columns} rows={layout.rows} />
    return (
      <Box flexDirection='column'>
        {picture}
        <Text dimColor>{word} · /pinata hit</Text>
      </Box>
    )
  }).catch(($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>Piñata</Text>
  })
}
