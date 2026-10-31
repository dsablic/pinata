import { PinataCharacter } from './browser.ts'

function byId<T extends HTMLElement> (id: string): T {
  const element = document.getElementById(id)
  if (element === null) throw new Error(`#${id} is missing`)
  return element as T
}

let character = byId<PinataCharacter>('character')

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
  window.setInterval(() => {
    const mounted = character.mounted
    if (mounted === undefined) return
    const stats = mounted.stats()
    const swing = mounted.live.frame().swing
    byId<HTMLDivElement>('readout').textContent = `frame ${stats.meanMs.toFixed(1)} ms mean, ` +
      `${stats.p95Ms.toFixed(1)} ms p95 (budget 40 ms) · swing ${swing.toFixed(0)}°`
  }, 500)
}

character.addEventListener('pinata-ready', wire, { once: true })
