import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from './serve.ts'
import { ROOT } from './paths.ts'

export type Session = {
  evaluate: <T>(expression: string) => Promise<T>
  send: (method: string, params?: object) => Promise<any>
  exceptions: string[]
}
export type Screen = { reducedMotion?: boolean, deviceScale?: number, page?: string, width?: number, height?: number }

export const SITE = join(ROOT, '_site')
export const TEST_PAGE = 'page-test.html'
export const PERCEPTION_PAGE = 'perception-test.html'
export const DEMO_PAGE = 'index.html?measure'
const TEST_PAGES = [TEST_PAGE, PERCEPTION_PAGE, 'jump-test.html']
const PORT = 8791
const DEBUG_PORT = 9341
const REPLY_TIMEOUT_MS = 10000
const STARTED_TRIES = 100
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
]

export const pause = async (ms: number): Promise<void> => await new Promise(done => setTimeout(done, ms))

export async function openChrome (): Promise<{ session: Session, close: () => Promise<void> }> {
  const chromePath = CHROME_CANDIDATES.find(path => path !== undefined && existsSync(path))
  if (chromePath === undefined) throw new Error('no Chrome found; set CHROME_PATH')
  const profile = mkdtempSync(join(tmpdir(), 'pinata-chrome-'))
  const chrome = spawn(chromePath, [
    '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, '--window-size=1200,900', '--no-first-run',
    '--no-default-browser-check', `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: 'ignore' })
  const exited = new Promise(done => chrome.once('exit', done))
  let target: { webSocketDebuggerUrl: string } | undefined
  for (let tries = 0; tries < STARTED_TRIES && target === undefined; tries++) {
    await pause(100)
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)
      const list = await response.json() as Array<{ type: string, webSocketDebuggerUrl: string }>
      target = list.find(t => t.type === 'page')
    } catch {}
  }
  if (target === undefined) throw new Error(`Chrome did not open its debugging port at ${chromePath}`)
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(done => socket.addEventListener('open', done))
  let lastId = 0
  const pending = new Map<number, (value: any) => void>()
  const exceptions: string[] = []
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data))
    if (message.id !== undefined) pending.get(message.id)?.(message.result ?? message.error)
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text)
  })
  const send = async (method: string, params: object = {}): Promise<any> => await new Promise((done, fail) => {
    const id = ++lastId
    const timeout = (): void => { fail(new Error(`no reply to ${method} in ${REPLY_TIMEOUT_MS} ms`)) }
    const timer = setTimeout(timeout, REPLY_TIMEOUT_MS)
    pending.set(id, value => {
      clearTimeout(timer)
      done(value)
    })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async <T>(expression: string): Promise<T> => {
    const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (reply.exceptionDetails !== undefined) throw new Error(`${expression}: ${reply.exceptionDetails.text}`)
    return reply.result?.value as T
  }
  await send('Runtime.enable')
  await send('Page.enable')
  const close = async (): Promise<void> => {
    socket.close()
    chrome.kill()
    await Promise.race([exited, pause(3000)])
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
  return { session: { evaluate, send, exceptions }, close }
}

export async function load (session: Session, screen: Screen = {}): Promise<void> {
  const motion = screen.reducedMotion === true ? 'reduce' : 'no-preference'
  await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }] })
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: screen.width ?? 1200, height: screen.height ?? 900, deviceScaleFactor: screen.deviceScale ?? 1, mobile: false
  })
  const url = `http://127.0.0.1:${PORT}/${screen.page ?? TEST_PAGE}`
  await session.send('Page.navigate', { url })
  for (let tries = 0; tries < STARTED_TRIES; tries++) {
    await pause(100)
    if (await session.evaluate<boolean>('window.__pinata !== undefined')) return
  }
  throw new Error(`${url} did not start a page world`)
}

export async function withSite<T> (work: (session: Session) => Promise<T>): Promise<T> {
  if (!existsSync(join(SITE, 'js', 'page', 'page.js'))) {
    throw new Error('_site is missing the page world: run npm run site')
  }
  const copies = TEST_PAGES.map(page => join(SITE, page))
  TEST_PAGES.forEach((page, i) => { copyFileSync(join(ROOT, 'test', 'pages', page), copies[i]) })
  const server = serve(SITE, PORT)
  const { session, close } = await openChrome()
  try {
    return await work(session)
  } finally {
    await close()
    server.close()
    for (const copy of copies) rmSync(copy, { force: true })
  }
}
