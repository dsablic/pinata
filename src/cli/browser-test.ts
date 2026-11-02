import { LAYOUTS, readLayout } from '../page/fixture.ts'
import type { LayoutFixture } from '../page/fixture.ts'
import { DEMO_PAGE, load, pause, PERCEPTION_PAGE, withSite } from './chrome.ts'
import type { Session } from './chrome.ts'
import { recordLayout } from './layouts.ts'
import { ROOT } from './paths.ts'

type Check = { name: string, pass: boolean, detail: string }
type Edge = { left: number, right: number, top: number }
type Standing = {
  name: string
  x: number
  y: number
  heading: number
  falling: boolean
  element: string
  lowestSole: number
}
type Sent = { name: string, element: string, say?: string }
type Centre = { x: number, y: number }

const PIXELS_PER_METRE = 54
const SURFACE_TOLERANCE_PX = 1
const STANDING_TOLERANCE_PX = 8
const SETTLE_MS = 500
const WATCH_MS = 1500
const VISIT_WAIT_MS = 2000
const POLL_MS = 100
const COST_P95_MS = 8
const MOST_TABS = 16
const WHEEL_PX = 300
const PHONE = { width: 390, height: 844 }
const SMALLER = { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false }
const GROUND_IDS = ['a', 'b', 'c', 'card', 'outer-nest', 'inner-nest', 'scrolled', 'flow-ground', 'added']
const DEMO = 'on the demo page'

const characters = async (session: Session): Promise<Standing[]> => {
  return await session.evaluate<Standing[]>('window.__pinata.characters()')
}
const pokes = async (session: Session): Promise<number> => await session.evaluate<number>('window.__pinata.pokes()')

const testPageSurfaces = async (session: Session): Promise<Edge[]> => await session.evaluate<Edge[]>(`(() => {
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

const markedGroundSurfaces = async (session: Session): Promise<Edge[]> => await session.evaluate<Edge[]>(`(() => {
  const mark = element => element.getAttribute('data-pinata') ?? getComputedStyle(element).getPropertyValue('--pinata')
  return [...document.querySelectorAll('body *')].filter(element => mark(element).trim() === 'ground').map(element => {
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

async function surfacesMatch (session: Session, when: string, oracle = testPageSurfaces): Promise<Check> {
  await pause(SETTLE_MS)
  const expected = await oracle(session)
  const actual = await actualSurfaces(session)
  const pass = actual.length === expected.length && expected.every(e => actual.some(a => near(a, e)))
  return { name: `surfaces ${when}`, pass, detail: `${actual.length} surfaces for ${expected.length} ground elements` }
}

async function charactersStand (session: Session, when: string): Promise<Check> {
  const all = await characters(session)
  const surfaces = await actualSurfaces(session)
  const onSurface = (c: Standing): boolean => surfaces.some(s => {
    return c.x >= s.left - 1 && c.x <= s.right + 1 && Math.abs(c.lowestSole - s.top) <= STANDING_TOLERANCE_PX
  })
  const floating = all.filter(c => !c.falling && !onSurface(c))
  return {
    name: `characters stand on live surfaces ${when}`,
    pass: all.length > 0 && floating.length === 0,
    detail: `${all.length} characters, ${floating.length} not on a surface and not falling`
  }
}

async function click (session: Session, x: number, y: number): Promise<void> {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await session.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
  }
  await pause(50)
}

type Aim = { standing: Standing, x: number, y: number }

async function visibleCharacter (session: Session): Promise<Aim | undefined> {
  const [first] = await characters(session)
  if (first === undefined) return undefined
  await session.evaluate(`scrollTo(0, ${Math.max(0, first.y - 500)})`)
  await pause(50)
  const standing = (await characters(session)).find(c => c.name === first.name) as Standing
  const scrollY = await session.evaluate<number>('scrollY')
  return { standing, x: standing.x, y: standing.y - scrollY - 30 }
}

async function pokeCheck (session: Session, name: string, expectTurn: boolean): Promise<Check> {
  const target = await visibleCharacter(session)
  if (target === undefined) return { name, pass: false, detail: 'no character in view' }
  await session.evaluate('window.__reached = []')
  const before = await pokes(session)
  await click(session, target.x, target.y)
  const after = await pokes(session)
  const reached = await session.evaluate<string[]>('window.__reached ?? []')
  const turned = (await characters(session)).some(c => {
    return c.name === target.standing.name && c.heading !== target.standing.heading
  })
  return {
    name,
    pass: after === before + 1 && reached.length === 0 && turned === expectTurn,
    detail: `${target.standing.name}: pokes ${before} -> ${after}, ` +
      `events reaching the page: ${reached.join(', ') || 'none'}, turned: ${String(turned)}`
  }
}

async function costChecks (session: Session, where = ''): Promise<Check[]> {
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
  const count = (await characters(session)).length
  return [{
    name: `the world costs at most 8 ms of main thread per frame at p95${where}`,
    pass: count >= 4 && p95 <= COST_P95_MS,
    detail: `${count} characters, p95 ${p95.toFixed(2)} ms over ${costs.length} frames`
  }, {
    name: `no layout reads per frame while nothing changes${where}`,
    pass: reads === 0 && rebuilt === 0,
    detail: `${reads} layout reads and ${rebuilt} rebuilds in ${WATCH_MS} ms`
  }]
}

async function layoutShiftCheck (session: Session, where = ''): Promise<Check> {
  const shift = await session.evaluate<number>(`new Promise(done => {
    let total = 0
    new PerformanceObserver(list => { for (const entry of list.getEntries()) total += entry.value })
      .observe({ type: 'layout-shift', buffered: true })
    setTimeout(() => done(total), 200)
  })`)
  return { name: `the overlay causes no layout shift${where}`, pass: shift === 0, detail: `CLS ${shift}` }
}

async function stillCheck (session: Session, where = ''): Promise<Check> {
  const before = await characters(session)
  await pause(WATCH_MS)
  const after = await characters(session)
  const moved = after.filter((c, i) => c.x !== before[i]?.x || c.y !== before[i]?.y)
  return {
    name: `with reduced motion nothing moves${where}`,
    pass: after.length > 0 && moved.length === 0,
    detail: `${moved.length} of ${after.length} characters moved in ${WATCH_MS} ms`
  }
}

const centreOf = async (session: Session, id: string): Promise<Centre> => await session.evaluate<Centre>(`(() => {
  const element = document.getElementById('${id}')
  element.scrollIntoView({ block: 'center' })
  const rect = element.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
})()`)

async function sentFor (session: Session, id: string, trigger: () => Promise<void>): Promise<Sent | undefined> {
  const before = (await session.evaluate<Sent[]>('window.__pinata.visits()')).length
  await trigger()
  for (let waited = 0; waited < VISIT_WAIT_MS; waited += POLL_MS) {
    await pause(POLL_MS)
    const sent = (await session.evaluate<Sent[]>('window.__pinata.visits()')).slice(before)
    const match = sent.find(v => v.element === id)
    if (match !== undefined) return match
  }
  return undefined
}

async function hoverCheck (session: Session, id: string, owner: string, say: string, where: string): Promise<Check> {
  const centre = await centreOf(session, id)
  await pause(SETTLE_MS)
  const sent = await sentFor(session, owner, async () => {
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: centre.x, y: centre.y })
  })
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
  return {
    name: `resting the pointer on #${id} sends a character to #${owner} with its words${where}`,
    pass: sent !== undefined && sent.say === say,
    detail: sent === undefined
      ? `no visit to #${owner} in ${VISIT_WAIT_MS} ms`
      : `${sent.name} sent, words "${sent.say ?? ''}"`
  }
}

async function tabTo (session: Session, id: string): Promise<void> {
  for (let tabs = 0; tabs < MOST_TABS; tabs++) {
    if (await session.evaluate<boolean>(`document.activeElement?.id === '${id}'`)) return
    for (const type of ['keyDown', 'keyUp']) {
      await session.send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    }
  }
}

async function focusCheck (session: Session, id: string, where: string): Promise<Check> {
  const sent = await sentFor(session, id, async () => { await tabTo(session, id) })
  return {
    name: `moving keyboard focus to #${id} sends a character to it${where}`,
    pass: sent !== undefined,
    detail: sent === undefined ? `no visit to #${id} in ${VISIT_WAIT_MS} ms` : `${sent.name} sent`
  }
}

function layoutDifferences (recorded: LayoutFixture, stored: LayoutFixture): string[] {
  const differences: string[] = []
  const geometry = recorded.platform === stored.platform
  const apart = <T>(a: T, b: T, keys: Array<keyof T>): boolean => {
    return geometry && keys.some(key => Math.abs(Number(a[key]) - Number(b[key])) > SURFACE_TOLERANCE_PX)
  }
  const ids = (f: LayoutFixture): string => f.marks.map(m => m.id).join(',')
  if (ids(recorded) !== ids(stored)) differences.push(`marked ${ids(recorded)} against ${ids(stored)}`)
  recorded.marks.forEach((m, i) => {
    const s = stored.marks[i]
    if (s === undefined) return
    const moved = apart(m.box, s.box, ['left', 'top', 'width', 'height'])
    if (moved || JSON.stringify(m.hints) !== JSON.stringify(s.hints)) differences.push(`#${m.id} differs`)
  })
  const targets = (f: LayoutFixture): string => f.targets.map(t => `${t.id}:${t.ground ?? ''}:${t.say ?? ''}`).join(',')
  if (targets(recorded) !== targets(stored)) differences.push('targets differ')
  recorded.targets.forEach((t, i) => {
    const s = stored.targets[i]
    if (s !== undefined && apart(t.rect, s.rect, ['left', 'top', 'width'])) differences.push(`#${t.id} moved`)
  })
  return differences
}

async function fixtureChecks (session: Session): Promise<Check[]> {
  const checks: Check[] = []
  for (const spec of LAYOUTS) {
    const differences = layoutDifferences(await recordLayout(session, spec), readLayout(ROOT, spec.name))
    const stored = readLayout(ROOT, spec.name)
    const scope = stored.platform === process.platform
      ? 'boxes, hints and targets'
      : `hints and targets (boxes laid out on ${stored.platform})`
    checks.push({
      name: `the ${spec.name} layout fixture matches its page (npm run layouts records it again)`,
      pass: differences.length === 0,
      detail: `${scope}: ${differences.slice(0, 3).join('; ') || 'same'}`
    })
  }
  return checks
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
  await session.send('Emulation.setDeviceMetricsOverride', SMALLER)
  checks.push(await surfacesMatch(session, 'after the window resizes'))
  await session.evaluate(`(() => {
    const added = document.createElement('div')
    added.id = 'added'
    added.className = 'box'
    added.dataset.pinata = 'ground'
    Object.assign(added.style, { left: '700px', top: '700px', width: '200px', height: '30px' })
    document.body.appendChild(added)
    document.getElementById('a').remove()
  })()`)
  checks.push(await surfacesMatch(session, 'after an element is added and another removed'))
  checks.push(await charactersStand(session, 'after elements are added and removed'))
  await session.evaluate(`document.getElementById('scroller').scrollTop = 200`)
  checks.push(await surfacesMatch(session, 'after an inner container scrolls'))
  await session.evaluate(`document.getElementById('flow-text').firstChild.data = 'Much longer text. '.repeat(40)`)
  checks.push(await surfacesMatch(session, 'after text pushes an element down'))
  return checks
}

async function clickChecks (session: Session): Promise<Check[]> {
  const checks: Check[] = []
  await session.evaluate('window.__clicks = 0; document.getElementById("button").click()')
  const fromScript = await session.evaluate<number>('window.__clicks')
  checks.push({ name: 'a click from script reaches the page', pass: fromScript === 1, detail: `${fromScript} clicks` })
  const button = await centreOf(session, 'button')
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
  checks.push(await layoutShiftCheck(session))
  checks.push(await scrollCheck(session), await selectionCheck(session))
  return checks
}

async function scrollCheck (session: Session): Promise<Check> {
  await session.evaluate('scrollTo(0, 0)')
  await pause(SETTLE_MS)
  await session.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 400, y: 400, deltaX: 0, deltaY: WHEEL_PX })
  await pause(SETTLE_MS)
  const scrolled = await session.evaluate<number>('scrollY')
  return { name: 'the wheel scrolls the page', pass: scrolled > 0, detail: `scrolled to ${scrolled} px` }
}

async function selectionCheck (session: Session): Promise<Check> {
  const text = await session.evaluate<{ x: number, y: number, right: number }>(`(() => {
    const element = document.getElementById('flow-text')
    element.scrollIntoView({ block: 'center' })
    const rect = element.getBoundingClientRect()
    return { x: rect.left + 2, y: rect.top + 10, right: rect.left + rect.width / 2 }
  })()`)
  await pause(SETTLE_MS)
  const mouse = async (type: string, x: number, extra: object): Promise<void> => {
    await session.send('Input.dispatchMouseEvent', { type, x, y: text.y, button: 'left', ...extra })
  }
  await mouse('mousePressed', text.x, { clickCount: 1 })
  await mouse('mouseMoved', text.right, { buttons: 1 })
  await mouse('mouseReleased', text.right, { clickCount: 1 })
  const selected = await session.evaluate<string>('String(getSelection())')
  const detail = `selected "${selected.slice(0, 30)}"`
  return { name: 'dragging over text selects it', pass: selected.length > 0, detail }
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

async function perceptionChecks (session: Session): Promise<Check[]> {
  await load(session, { page: PERCEPTION_PAGE })
  await pause(SETTLE_MS)
  return [
    await hoverCheck(session, 'button-label', 'button', 'Click me!', ''),
    await focusCheck(session, 'field', '')
  ]
}

async function demoClick (session: Session): Promise<Check> {
  const heading = await session.evaluate<Centre>(`(() => {
    window.__headingClicks = 0
    const heading = document.querySelector('#card-poke h2')
    heading.addEventListener('click', () => { window.__headingClicks++ })
    heading.scrollIntoView({ block: 'center' })
    const rect = heading.getBoundingClientRect()
    return { x: rect.left + 8, y: rect.top + rect.height / 2 }
  })()`)
  await pause(SETTLE_MS)
  const before = await pokes(session)
  await click(session, heading.x, heading.y)
  const poked = await pokes(session) !== before
  const reached = await session.evaluate<number>('window.__headingClicks')
  return {
    name: `a click on a heading reaches it unless it poked a character ${DEMO}`,
    pass: poked ? reached === 0 : reached === 1,
    detail: `poked: ${String(poked)}, clicks reaching the heading: ${reached}`
  }
}

async function demoChecks (session: Session): Promise<Check[]> {
  const where = ` ${DEMO}`
  await load(session, { page: DEMO_PAGE })
  const checks = await costChecks(session, where)
  checks.push(await surfacesMatch(session, DEMO, markedGroundSurfaces))
  checks.push(await charactersStand(session, DEMO))
  checks.push(await demoClick(session))
  checks.push(await layoutShiftCheck(session, where))
  checks.push(await pokeCheck(session, `a click on a character pokes and turns it${where}`, true))
  checks.push(await hoverCheck(session, 'pinata-link', 'pinata-link', 'Swing by!', where))
  checks.push(await focusCheck(session, 'source-link', where))
  await session.send('Emulation.setDeviceMetricsOverride', SMALLER)
  checks.push(await surfacesMatch(session, `after the window resizes ${DEMO}`, markedGroundSurfaces))
  await load(session, { page: DEMO_PAGE, reducedMotion: true })
  checks.push(await stillCheck(session, where))
  const narrow = `${DEMO} at ${PHONE.width} px wide`
  await load(session, { page: DEMO_PAGE, ...PHONE })
  checks.push(await surfacesMatch(session, narrow, markedGroundSurfaces))
  checks.push(await hoverCheck(session, 'pinata-link', 'pinata-link', 'Swing by!', ` ${narrow}`))
  return checks
}

const SUITES: Record<string, (session: Session) => Promise<Check[]>> = {
  page: async session => [...await pageChecks(session), ...await clickChecks(session)],
  screen: screenChecks,
  perception: perceptionChecks,
  demo: demoChecks,
  fixtures: fixtureChecks
}

async function main (): Promise<number> {
  const chosen = process.argv[2]
  if (chosen !== undefined && !(chosen in SUITES)) {
    console.error(`no suite ${chosen}: ${Object.keys(SUITES).join(', ')}`)
    return 2
  }
  const checks = await withSite(async session => {
    const all: Check[] = []
    for (const [name, suite] of Object.entries(SUITES)) {
      if (chosen === undefined || chosen === name) all.push(...await suite(session))
    }
    const exceptions = session.exceptions.join('; ')
    return [...all, { name: 'the pages throw nothing', pass: exceptions === '', detail: exceptions || 'none' }]
  })
  for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name} (${check.detail})`)
  return checks.every(c => c.pass) ? 0 : 1
}

process.exitCode = await main()
