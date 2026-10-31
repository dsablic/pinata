import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from './serve.ts'
import { ROOT } from './paths.ts'

const SITE = join(ROOT, '_site')
const TEST_PAGE = 'page-test.html'
const PORT = 8791
const DEBUG_PORT = 9341
const PAGE_URL = `http://127.0.0.1:${PORT}/${TEST_PAGE}`
const PIXELS_PER_METRE = 54
const SURFACE_TOLERANCE_PX = 1
const REPLY_TIMEOUT_MS = 10000
const SETTLE_MS = 500
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
]
const GROUND_IDS = ['a', 'b', 'c', 'card', 'outer-nest', 'inner-nest', 'scrolled', 'flow-ground', 'added']

type Check = { name: string, pass: boolean, detail: string, gate?: boolean }
type Session = {
  evaluate: <T>(expression: string) => Promise<T>
  send: (method: string, params?: object) => Promise<any>
  exceptions: string[]
}
type Edge = { left: number, right: number, top: number }
type FootSample = { planted: boolean, gap: number | null }
type Sample = { name: string, falling: boolean, feet: FootSample[] }
type Standing = {
  name: string
  x: number
  y: number
  heading: number
  surface: number
  falling: boolean
  element: string
  lowestSole: number
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
  const exited = new Promise(done => chrome.once('exit', done))
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

type Screen = { reducedMotion?: boolean, deviceScale?: number }

async function load (session: Session, screen: Screen = {}): Promise<void> {
  const motion = screen.reducedMotion === true ? 'reduce' : 'no-preference'
  await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }] })
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: 1200, height: 900, deviceScaleFactor: screen.deviceScale ?? 1, mobile: false
  })
  await session.send('Page.navigate', { url: PAGE_URL })
  for (let tries = 0; tries < 100; tries++) {
    await pause(100)
    if (await session.evaluate<boolean>('window.__pinata !== undefined')) return
  }
  throw new Error(`${PAGE_URL} did not start a page world`)
}

const expectedSurfaces = async (session: Session): Promise<Edge[]> => await session.evaluate<Edge[]>(`(() => {
  const scroller = document.getElementById('scroller').getBoundingClientRect()
  return ${JSON.stringify(GROUND_IDS)}.map(id => document.getElementById(id)).filter(element => {
    if (element === null) return false
    if (element.id !== 'scrolled') return true
    const top = element.getBoundingClientRect().top
    return top >= scroller.top && top <= scroller.bottom
  }).map(element => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left + scrollX, right: rect.right + scrollX, top: rect.top + scrollY }
  })
})()`)

const actualSurfaces = async (session: Session): Promise<Edge[]> => await session.evaluate<Edge[]>(`
  window.__pinata.ground().surfaces.map(s => ({
    left: s.from * ${PIXELS_PER_METRE}, right: s.to * ${PIXELS_PER_METRE}, top: -s.height * ${PIXELS_PER_METRE}
  }))`)

const near = (a: Edge, b: Edge): boolean => (['left', 'right', 'top'] as const).every(key => {
  return Math.abs(a[key] - b[key]) <= SURFACE_TOLERANCE_PX
})

async function surfacesMatch (session: Session, when: string): Promise<Check> {
  await pause(SETTLE_MS)
  const expected = await expectedSurfaces(session)
  const actual = await actualSurfaces(session)
  const pass = actual.length === expected.length && expected.every(e => actual.some(a => near(a, e)))
  return { name: `surfaces ${when}`, pass, detail: `${actual.length} surfaces for ${expected.length} ground elements` }
}

async function charactersStand (session: Session, when: string): Promise<Check> {
  const characters = await session.evaluate<Standing[]>('window.__pinata.characters()')
  const surfaces = await actualSurfaces(session)
  const onSurface = (c: Standing): boolean => surfaces.some(s => {
    return c.x >= s.left - 1 && c.x <= s.right + 1 && Math.abs(c.lowestSole - s.top) <= MID_AIR_PX
  })
  const floating = characters.filter(c => !c.falling && !onSurface(c))
  return {
    name: `characters stand on live surfaces ${when}`,
    pass: characters.length > 0 && floating.length === 0,
    detail: `${characters.length} characters, ${floating.length} not on a surface and not falling`
  }
}

async function click (session: Session, x: number, y: number): Promise<void> {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await session.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
  }
  await pause(50)
}

type Target = { standing: Standing, x: number, y: number }

async function visibleCharacter (session: Session): Promise<Target | undefined> {
  const [first] = await session.evaluate<Standing[]>('window.__pinata.characters()')
  if (first === undefined) return undefined
  await session.evaluate(`scrollTo(0, ${Math.max(0, first.y - 500)})`)
  await pause(50)
  const [standing] = await session.evaluate<Standing[]>('window.__pinata.characters()')
  const scrollY = await session.evaluate<number>('scrollY')
  return { standing, x: standing.x, y: standing.y - scrollY - 30 }
}

const pokes = async (session: Session): Promise<number> => await session.evaluate<number>('window.__pinata.pokes()')

async function pokeCheck (session: Session, name: string, expectTurn: boolean): Promise<Check> {
  const target = await visibleCharacter(session)
  if (target === undefined) return { name, pass: false, detail: 'no character in view' }
  await session.evaluate('window.__reached = []')
  const before = await pokes(session)
  await click(session, target.x, target.y)
  const after = await pokes(session)
  const reached = await session.evaluate<string[]>('window.__reached')
  const characters = await session.evaluate<Standing[]>('window.__pinata.characters()')
  const turned = characters.some(c => c.name === target.standing.name && c.heading !== target.standing.heading)
  return {
    name,
    pass: after === before + 1 && reached.length === 0 && turned === expectTurn,
    detail: `${target.standing.name}: pokes ${before} -> ${after}, ` +
      `events reaching the page: ${reached.join(', ') || 'none'}, turned: ${String(turned)}`
  }
}

const PLANTED_TOLERANCE_PX = 1
const MID_AIR_PX = 3
const LANDING_FRAMES = 3
const COST_P95_MS = 8
const WATCH_MS = 1500
const FALL_WAIT_MS = 4000
const LONGEST_FALL_FRAMES = 96

const samples = async (session: Session): Promise<Sample[]> => {
  return await session.evaluate<Sample[]>('window.__pinata.samples()')
}

function standingChecks (all: Sample[]): Check[] {
  const planted = all.flatMap(s => s.feet.filter(f => f.planted))
  const off = planted.filter(f => f.gap === null || Math.abs(f.gap) > PLANTED_TOLERANCE_PX)
  const midAir = all.filter(s => !s.falling && s.feet.every(f => f.gap === null || f.gap > MID_AIR_PX))
  const worst = Math.max(0, ...planted.map(f => f.gap === null ? Infinity : Math.abs(f.gap)))
  return [{
    name: 'every planted foot is within 1 CSS px of its surface',
    gate: true,
    pass: planted.length > 0 && off.length === 0,
    detail: `${off.length} of ${planted.length} planted feet off, worst ${worst.toFixed(2)} px`
  }, {
    name: 'no character stands in mid-air except while falling',
    gate: true,
    pass: all.length > 0 && midAir.length === 0,
    detail: `${midAir.length} of ${all.length} frames with every foot more than ${MID_AIR_PX} px up`
  }]
}

function fallCheck (all: Sample[]): Check {
  const names = [...new Set(all.map(s => s.name))]
  let falls = 0
  const faults: string[] = []
  for (const name of names) {
    const own = all.filter(s => s.name === name)
    let fallingFor = 0
    own.forEach((s, i) => {
      fallingFor = s.falling ? fallingFor + 1 : 0
      if (fallingFor === LONGEST_FALL_FRAMES) faults.push(`${name}: still falling after ${LONGEST_FALL_FRAMES} frames`)
      const under = s.feet.some(f => f.gap !== null && f.gap < -PLANTED_TOLERANCE_PX)
      if (under) faults.push(`${name} frame ${i}: a sole under its surface`)
      if (i === 0 || s.falling || !own[i - 1].falling) return
      falls++
      const after = own.slice(i, i + LANDING_FRAMES)
      const down = after.some(a => a.feet.some(f => f.gap !== null && Math.abs(f.gap) <= PLANTED_TOLERANCE_PX))
      if (!down) faults.push(`${name}: no foot on the surface within ${LANDING_FRAMES} frames of landing`)
    })
  }
  return {
    name: 'falls land on the surface below, never through it, feet down within 3 frames',
    pass: falls > 0 && faults.length === 0,
    detail: `${falls} falls; ${faults.slice(0, 3).join('; ') || 'no faults'}`
  }
}

const dropSomeone = async (session: Session): Promise<string> => await session.evaluate<string>(`(() => {
  const ground = window.__pinata.ground()
  const metres = ${PIXELS_PER_METRE}
  const over = window.__pinata.characters().find(c => !c.falling && c.element !== '' && ground.surfaces.some(s => {
    return s.from * metres <= c.x && s.to * metres >= c.x && -s.height * metres > c.y + 50
  }))
  if (over === undefined) return ''
  document.getElementById(over.element).remove()
  return over.name + ' from #' + over.element
})()`)

async function costChecks (session: Session): Promise<Check[]> {
  await pause(WATCH_MS)
  const rebuilds = await session.evaluate<number>('window.__pinata.rebuilds()')
  await session.evaluate(`(() => {
    window.__layoutReads = 0
    const count = (owner, name) => {
      const original = owner[name]
      owner[name] = function (...args) { window.__layoutReads++; return original.apply(this, args) }
    }
    count(Element.prototype, 'getBoundingClientRect')
    count(Element.prototype, 'getClientRects')
    count(window, 'getComputedStyle')
  })()`)
  await pause(WATCH_MS)
  const reads = await session.evaluate<number>('window.__layoutReads')
  const rebuilt = await session.evaluate<number>('window.__pinata.rebuilds()') - rebuilds
  const costs = (await session.evaluate<number[]>('window.__pinata.costs()')).sort((a, b) => a - b)
  const p95 = costs[Math.floor(0.95 * (costs.length - 1))] ?? Infinity
  const count = await session.evaluate<number>('window.__pinata.characters().length')
  return [{
    name: 'the world costs at most 8 ms of main thread per frame at p95',
    pass: count >= 4 && p95 <= COST_P95_MS,
    detail: `${count} characters, p95 ${p95.toFixed(2)} ms over ${costs.length} frames`
  }, {
    name: 'no layout reads per frame while nothing changes',
    pass: reads === 0 && rebuilt === 0,
    detail: `${reads} layout reads and ${rebuilt} rebuilds in ${WATCH_MS} ms`
  }]
}

async function stillCheck (session: Session): Promise<Check> {
  const before = await session.evaluate<Standing[]>('window.__pinata.characters()')
  await pause(WATCH_MS)
  const after = await session.evaluate<Standing[]>('window.__pinata.characters()')
  const moved = after.filter((c, i) => c.x !== before[i]?.x || c.y !== before[i]?.y)
  return {
    name: 'with reduced motion nothing moves',
    pass: after.length > 0 && moved.length === 0,
    detail: `${moved.length} of ${after.length} characters moved in ${WATCH_MS} ms`
  }
}

async function pageChecks (session: Session): Promise<Check[]> {
  const checks: Check[] = []
  await load(session)
  checks.push(...await costChecks(session))
  checks.push(await surfacesMatch(session, 'after load'))
  checks.push(await charactersStand(session, 'after load'))
  await session.evaluate('scrollTo(0, 700)')
  await session.evaluate(`document.getElementById('c').style.width = '500px'`)
  checks.push(await surfacesMatch(session, 'after an element changes while the page is scrolled'))
  await session.evaluate('scrollTo(0, 0)')
  const smaller = { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false }
  await session.send('Emulation.setDeviceMetricsOverride', smaller)
  checks.push(await surfacesMatch(session, 'after the window resizes'))
  await session.evaluate(`(() => {
    const added = document.createElement('div')
    added.id = 'added'
    added.className = 'box'
    added.dataset.pinata = 'ground'
    Object.assign(added.style, { left: '700px', top: '700px', width: '200px', height: '30px' })
    document.body.appendChild(added)
  })()`)
  const before = await samples(session)
  const dropped = await dropSomeone(session)
  checks.push(await surfacesMatch(session, `after an element is added and another removed (${dropped || 'none'})`))
  checks.push(await charactersStand(session, 'after elements are added and removed'))
  await session.evaluate(`document.getElementById('scroller').scrollTop = 200`)
  checks.push(await surfacesMatch(session, 'after an inner container scrolls'))
  await session.evaluate(`document.getElementById('flow-text').firstChild.data = 'Much longer text. '.repeat(40)`)
  checks.push(await surfacesMatch(session, 'after text pushes an element down'))
  await pause(FALL_WAIT_MS)
  const after = [...before, ...await samples(session)]
  checks.push(...standingChecks(after), fallCheck(after))
  return checks
}

async function clickChecks (session: Session): Promise<Check[]> {
  const checks: Check[] = []
  await session.evaluate('window.__clicks = 0; document.getElementById("button").click()')
  const fromScript = await session.evaluate<number>('window.__clicks')
  checks.push({ name: 'a click from script reaches the page', pass: fromScript === 1, detail: `${fromScript} clicks` })
  const button = await session.evaluate<{ x: number, y: number }>(`(() => {
    const rect = document.getElementById('button').getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  await click(session, button.x, button.y)
  const reached = await session.evaluate<number>('window.__clicks')
  checks.push({ name: 'a click on a page element reaches it', pass: reached === 2, detail: `${reached} clicks` })
  checks.push(await pokeCheck(session, 'a click on a character pokes and turns it, and nothing reaches the page', true))
  await session.evaluate(`document.getElementById('dialog').showModal()`)
  const target = await visibleCharacter(session)
  const before = await pokes(session)
  if (target !== undefined) await click(session, target.x, target.y)
  const after = await pokes(session)
  checks.push({
    name: 'with a modal dialog open, characters are not poked',
    pass: target !== undefined && after === before,
    detail: `pokes ${before} -> ${after}`
  })
  await session.evaluate(`document.getElementById('dialog').close()`)
  const shift = await session.evaluate<number>(`new Promise(done => {
    let total = 0
    new PerformanceObserver(list => { for (const entry of list.getEntries()) total += entry.value })
      .observe({ type: 'layout-shift', buffered: true })
    setTimeout(() => done(total), 200)
  })`)
  checks.push({ name: 'the overlay causes no layout shift', pass: shift === 0, detail: `CLS ${shift}` })
  return checks
}

async function screenChecks (session: Session): Promise<Check[]> {
  await load(session, { reducedMotion: true })
  const still = await pokeCheck(session, 'with reduced motion a poke registers but nothing turns', false)
  const unmoved = await stillCheck(session)
  await load(session, { deviceScale: 2 })
  return [
    still,
    unmoved,
    await surfacesMatch(session, 'on a high-density screen'),
    await pokeCheck(session, 'pokes on a high-density screen', true)
  ]
}

async function run (): Promise<Check[]> {
  const { session, close } = await openChrome()
  try {
    const checks = [...await pageChecks(session), ...await clickChecks(session), ...await screenChecks(session)]
    const exceptions = session.exceptions.join('; ')
    return [...checks, { name: 'the page throws nothing', pass: exceptions === '', detail: exceptions || 'none' }]
  } finally {
    await close()
  }
}

function verdict (check: Check): string {
  if (check.gate === true) return check.pass ? 'GATE MET' : 'GATE MISSED'
  return check.pass ? 'PASS' : 'FAIL'
}

async function main (): Promise<number> {
  if (!existsSync(join(SITE, 'js', 'page', 'page.js'))) {
    console.error('_site is missing the page world: run npm run site first')
    return 2
  }
  const pageCopy = join(SITE, TEST_PAGE)
  copyFileSync(join(ROOT, 'test', 'pages', TEST_PAGE), pageCopy)
  const server = serve(SITE, PORT)
  try {
    const checks = await run()
    for (const check of checks) console.log(`${verdict(check)} ${check.name} (${check.detail})`)
    return checks.every(c => c.pass || c.gate === true) ? 0 : 1
  } finally {
    server.close()
    rmSync(pageCopy, { force: true })
  }
}

process.exitCode = await main()
