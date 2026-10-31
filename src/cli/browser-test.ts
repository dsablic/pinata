import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { serve } from './serve.ts'

const ROOT = resolve(import.meta.dirname, '..', '..')
const SITE = join(ROOT, '_site')
const PORT = 8791
const DEBUG_PORT = 9341
const PAGE = `http://127.0.0.1:${PORT}/page-test.html`
const SURFACE_TOLERANCE_PX = 1
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
]

type Check = { name: string, pass: boolean, detail: string }
type Session = {
  evaluate: <T>(expression: string) => Promise<T>
  send: (method: string, params?: object) => Promise<any>
}

const pause = async (ms: number): Promise<void> => await new Promise(done => setTimeout(done, ms))

async function openChrome (): Promise<{ session: Session, close: () => Promise<void> }> {
  const chromePath = CHROME_CANDIDATES.find(path => path !== undefined && existsSync(path))
  if (chromePath === undefined) throw new Error('no Chrome found; set CHROME_PATH')
  const profile = mkdtempSync(join(tmpdir(), 'pinata-chrome-'))
  const chrome = spawn(chromePath, [
    '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, '--window-size=1200,900', '--no-first-run',
    '--no-default-browser-check', `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: 'ignore' })
  let target: { webSocketDebuggerUrl: string } | undefined
  for (let tries = 0; tries < 100 && target === undefined; tries++) {
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
  const send = async (method: string, params: object = {}): Promise<any> => await new Promise(done => {
    const id = ++lastId
    pending.set(id, done)
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
    if (exceptions.length > 0) console.error(`page exceptions:\n${exceptions.join('\n')}`)
    socket.close()
    const exited = new Promise(done => chrome.once('exit', done))
    chrome.kill()
    await exited
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
  return { session: { evaluate, send }, close }
}

async function load (session: Session, reducedMotion = false): Promise<void> {
  await session.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }]
  })
  await session.send('Page.navigate', { url: PAGE })
  for (let tries = 0; tries < 100; tries++) {
    await pause(100)
    if (await session.evaluate<boolean>('window.__pinata !== undefined')) return
  }
  throw new Error(`${PAGE} did not start a page world`)
}

const EXPECTED_SURFACES = `(() => {
  const marked = [...document.querySelectorAll('#a, #b, #c, #card, #added')]
  return marked.map(element => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left + scrollX, right: rect.right + scrollX, top: rect.top + scrollY }
  })
})()`
const ACTUAL_SURFACES = `window.__pinata.ground().surfaces.map(s => ({
  left: s.from * 54, right: s.to * 54, top: -s.height * 54
}))`

async function surfacesMatch (session: Session, when: string): Promise<Check> {
  type Edge = { left: number, right: number, top: number }
  const expected = await session.evaluate<Edge[]>(EXPECTED_SURFACES)
  const actual = await session.evaluate<Edge[]>(ACTUAL_SURFACES)
  const unmatched = expected.filter(e => !actual.some(a => {
    return Math.abs(a.left - e.left) <= SURFACE_TOLERANCE_PX && Math.abs(a.right - e.right) <= SURFACE_TOLERANCE_PX &&
      Math.abs(a.top - e.top) <= SURFACE_TOLERANCE_PX
  }))
  const pass = unmatched.length === 0 && actual.length === expected.length
  return { name: `surfaces ${when}`, pass, detail: `${actual.length} surfaces for ${expected.length} marked elements` }
}

async function click (session: Session, x: number, y: number): Promise<void> {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await session.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
  }
  await pause(50)
}

type Standing = { name: string, x: number, y: number, yaw: number }

async function pokeFirstVisible (session: Session): Promise<Standing | undefined> {
  const scroll = await session.evaluate<number>('scrollY')
  const characters = await session.evaluate<Standing[]>('window.__pinata.characters()')
  const visible = characters.find(c => c.y - scroll > 60 && c.y - scroll < 880)
  if (visible === undefined) return undefined
  await click(session, visible.x, visible.y - scroll - 30)
  return visible
}

async function run (): Promise<Check[]> {
  const checks: Check[] = []
  const { session, close } = await openChrome()
  try {
    await load(session)
    checks.push(await surfacesMatch(session, 'after load'))
    await session.evaluate('scrollTo(0, 700)')
    await pause(100)
    checks.push(await surfacesMatch(session, 'after scrolling'))
    await session.evaluate('scrollTo(0, 0)')
    await session.evaluate(`document.getElementById('a').style.width = '300px'`)
    await pause(200)
    checks.push(await surfacesMatch(session, 'after an element changes size'))
    await session.evaluate(`(() => {
      const added = document.createElement('div')
      added.id = 'added'
      added.className = 'box'
      added.dataset.pinata = 'ground'
      Object.assign(added.style, { left: '700px', top: '700px', width: '200px', height: '30px' })
      document.body.appendChild(added)
    })()`)
    await pause(200)
    checks.push(await surfacesMatch(session, 'after an element is added'))
    await session.evaluate(`document.getElementById('b').remove()`)
    await pause(200)
    checks.push(await surfacesMatch(session, 'after an element is removed'))

    const button = await session.evaluate<{ x: number, y: number }>(`(() => {
      const rect = document.getElementById('button').getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })()`)
    await click(session, button.x, button.y)
    const reached = await session.evaluate<number>('window.__clicks')
    checks.push({ name: 'a click on a page element reaches it', pass: reached === 1, detail: `${reached} clicks` })

    const before = await session.evaluate<number>('window.__pinata.pokes()')
    const poked = await pokeFirstVisible(session)
    const after = await session.evaluate<number>('window.__pinata.pokes()')
    const clicks = await session.evaluate<number>('window.__clicks')
    checks.push({
      name: 'a click on a character pokes it and goes no further',
      pass: poked !== undefined && after === before + 1 && clicks === 1,
      detail: `${poked?.name ?? 'no visible character'}: pokes ${before} -> ${after}, page clicks ${clicks}`
    })

    const shift = await session.evaluate<number>(`new Promise(done => {
      let total = 0
      new PerformanceObserver(list => { for (const entry of list.getEntries()) total += entry.value })
        .observe({ type: 'layout-shift', buffered: true })
      setTimeout(() => done(total), 200)
    })`)
    checks.push({ name: 'the overlay causes no layout shift', pass: shift === 0, detail: `CLS ${shift}` })

    await load(session, true)
    const still = await session.evaluate<Standing[]>('window.__pinata.characters()')
    await pokeFirstVisible(session)
    const stillAfter = await session.evaluate<Standing[]>('window.__pinata.characters()')
    const moved = still.filter((c, i) => c.yaw !== stillAfter[i].yaw || c.x !== stillAfter[i].x).length
    checks.push({ name: 'with reduced motion nothing moves', pass: moved === 0, detail: `${moved} characters moved` })
  } finally {
    await close()
  }
  return checks
}

async function main (): Promise<number> {
  if (!existsSync(join(SITE, 'page-test.html'))) {
    console.error('_site is missing the page test: run npm run site first')
    return 2
  }
  const server = serve(SITE, PORT)
  try {
    const checks = await run()
    for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name} (${check.detail})`)
    return checks.every(c => c.pass) ? 0 : 1
  } finally {
    server.close()
  }
}

process.exitCode = await main()
