import { PinataCharacter } from './browser.ts'

type Step = { after: number, line: string, event?: string }

const EVENTS = ['loading', 'thinking', 'toolStart', 'success', 'error', 'idle']
const SESSION: Step[] = [
  { after: 0, line: 'user: tidy up the parser and add tests', event: 'thinking' },
  { after: 1800, line: 'agent: reading src/parser.ts', event: 'toolStart' },
  { after: 1500, line: 'agent: planning the change', event: 'thinking' },
  { after: 2200, line: 'agent: editing src/parser.ts', event: 'toolStart' },
  { after: 1600, line: 'agent: running npm test', event: 'toolStart' },
  { after: 2000, line: 'tool: 2 tests failed', event: 'error' },
  { after: 2600, line: 'agent: fixing the off-by-one', event: 'thinking' },
  { after: 1800, line: 'agent: running npm test', event: 'toolStart' },
  { after: 2000, line: 'tool: all 48 tests pass', event: 'success' },
  { after: 2600, line: 'agent: done', event: 'idle' }
]

function byId<T extends HTMLElement> (id: string): T {
  const element = document.getElementById(id)
  if (element === null) throw new Error(`#${id} is missing`)
  return element as T
}

let character = byId<PinataCharacter>('character')
const log = byId<HTMLDivElement>('log')

function say (line: string, event?: string): void {
  const row = document.createElement('div')
  row.textContent = line
  if (event !== undefined) {
    const tag = document.createElement('span')
    tag.className = 'event'
    tag.textContent = `  → ${event}`
    row.append(tag)
  }
  log.append(row)
  log.scrollTop = log.scrollHeight
}

function send (event: string): void {
  window.dispatchEvent(new CustomEvent('pinata', { detail: event }))
}

type Slider = { id: string, digits: number, apply: (value: number) => void }

const SLIDERS: Slider[] = [
  { id: 'wind', digits: 1, apply: v => { tune(s => { s.wind = [v, 0, 0] }) } },
  { id: 'gravity', digits: 2, apply: v => { tune(s => { s.gravity = v }) } },
  { id: 'rope', digits: 2, apply: v => { tune(s => { s.rope = v }) } },
  { id: 'swing', digits: 2, apply: v => { tune(s => { s.swingDamping = v }) } },
  { id: 'twistK', digits: 1, apply: v => { tune(s => { s.twistStiffness = v }) } },
  { id: 'twistC', digits: 1, apply: v => { tune(s => { s.twistDamping = v }) } },
  { id: 'limbK', digits: 2, apply: v => { tune(s => { s.limbStiffness = v }) } },
  { id: 'limbC', digits: 2, apply: v => { tune(s => { s.limbDamping = v }) } },
  { id: 'samples', digits: 0, apply: v => { remount({ samples: String(v) }) } }
]

type Settings = NonNullable<PinataCharacter['mounted']>['live']['settings']

function tune (change: (settings: Settings) => void): void {
  const settings = character.mounted?.live.settings
  if (settings !== undefined) change(settings)
}

/** Settings live in the running character; samples and reduced motion need a new one, so carry the sliders over. */
function remount (attributes: Record<string, string>): void {
  const next = document.createElement('pinata-character') as PinataCharacter
  for (const { name, value } of character.attributes) next.setAttribute(name, value)
  for (const [name, value] of Object.entries(attributes)) next.setAttribute(name, value)
  const restore = (): void => { for (const slider of SLIDERS.slice(0, -1)) apply(slider) }
  next.addEventListener('pinata-ready', restore, { once: true })
  character.replaceWith(next)
  character = next
}

function apply (slider: Slider): void {
  const input = byId<HTMLInputElement>(slider.id)
  const value = Number(input.value)
  byId<HTMLOutputElement>(`${slider.id}Out`).value = value.toFixed(slider.digits)
  slider.apply(value)
}

function behaviourButtons (): void {
  const box = byId<HTMLDivElement>('behaviours')
  const names = Object.keys(character.mounted?.character.behaviours.behaviours ?? {})
  box.replaceChildren(...names.map(name => {
    const button = document.createElement('button')
    button.textContent = name
    button.addEventListener('click', () => { character.play(name) })
    return button
  }))
}

function wire (): void {
  for (const slider of SLIDERS) {
    const input = byId<HTMLInputElement>(slider.id)
    input.addEventListener(slider.id === 'samples' ? 'change' : 'input', () => { apply(slider) })
    byId<HTMLOutputElement>(`${slider.id}Out`).value = Number(input.value).toFixed(slider.digits)
  }
  byId<HTMLButtonElement>('hit').addEventListener('click', () => { character.hit() })
  byId<HTMLSelectElement>('scene').addEventListener('change', event => {
    document.body.dataset.scene = (event.target as HTMLSelectElement).value
  })
  byId<HTMLInputElement>('reduced').addEventListener('change', event => {
    remount({ motion: (event.target as HTMLInputElement).checked ? 'reduced' : 'full' })
  })
  byId<HTMLDivElement>('events').replaceChildren(...EVENTS.map(name => {
    const button = document.createElement('button')
    button.textContent = name
    button.addEventListener('click', () => {
      say(`page: ${name}`, name)
      send(name)
    })
    return button
  }))
  const agent = byId<HTMLButtonElement>('agent')
  let timer = 0
  agent.addEventListener('click', () => {
    clearTimeout(timer)
    log.replaceChildren()
    agent.classList.add('on')
    let i = 0
    const next = (): void => {
      const step = SESSION[i++]
      if (step === undefined) {
        agent.classList.remove('on')
        return
      }
      say(step.line, step.event)
      if (step.event !== undefined) send(step.event)
      timer = window.setTimeout(next, SESSION[i]?.after ?? 0)
    }
    next()
  })
  window.setInterval(() => {
    const mounted = character.mounted
    if (mounted === undefined) return
    const stats = mounted.stats()
    byId<HTMLDivElement>('readout').textContent = `frame ${stats.meanMs.toFixed(1)} ms mean, ` +
      `${stats.p95Ms.toFixed(1)} ms p95 (budget 40 ms)`
    byId<HTMLDivElement>('now').textContent = mounted.live.frame().behaviour
  }, 500)
}

character.addEventListener('pinata-ready', () => {
  behaviourButtons()
  wire()
}, { once: true })
