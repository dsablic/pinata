import { surfaceBelow } from './surfaces.ts'
import type { Ground, Surface } from './surfaces.ts'
import type { Place } from './walker.ts'

export type Interest = { element: Element, place: Place }
export type PerceptionOptions = {
  ground: () => Ground
  pixelsPerMetre: number
  onInterest: (interest: Interest) => void
  ignore: (element: Element) => boolean
  surfaceOf: (element: Element) => Surface | undefined
}

const HOVER_MS = 300
const ABOVE_TOP = 0.01
const INTERACTIVE = 'a[href], button, input, select, textarea, summary, label, [tabindex], [data-pinata-say]'

function standingFor (element: Element, options: PerceptionOptions): Surface | undefined {
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    const surface = options.surfaceOf(at)
    if (surface !== undefined) return surface
  }
  return undefined
}

export function placeUnder (element: Element, options: PerceptionOptions): Place | undefined {
  const rect = element.getBoundingClientRect()
  const x = (rect.left + rect.width / 2 + window.scrollX) / options.pixelsPerMetre
  const top = -(rect.top + window.scrollY) / options.pixelsPerMetre
  const own = standingFor(element, options)
  const surface = own !== undefined && x >= own.from && x <= own.to
    ? own
    : surfaceBelow(options.ground(), x, top + ABOVE_TOP, 0)
  return surface === undefined ? undefined : { x, height: surface.height }
}

export function interestOf (element: Element, ignore: (element: Element) => boolean): Element | undefined {
  const wanted = element.closest(INTERACTIVE)
  return wanted === null || ignore(wanted) ? undefined : wanted
}

export function perceive (options: PerceptionOptions): () => void {
  let hovering: ReturnType<typeof setTimeout> | undefined
  let focused: Element | undefined
  const notice = (target: Element): void => {
    const element = interestOf(target, options.ignore)
    if (element === undefined) return
    const place = placeUnder(element, options)
    if (place !== undefined) options.onInterest({ element, place })
  }
  const onOver = (event: PointerEvent): void => {
    if (hovering !== undefined) clearTimeout(hovering)
    const element = event.target
    if (!(element instanceof Element)) return
    hovering = setTimeout(() => {
      hovering = undefined
      notice(element)
    }, HOVER_MS)
  }
  const onOut = (): void => {
    if (hovering !== undefined) clearTimeout(hovering)
    hovering = undefined
  }
  const onFocus = (event: FocusEvent): void => {
    if (!(event.target instanceof Element) || event.target === focused) return
    focused = event.target
    notice(event.target)
  }
  document.addEventListener('pointerover', onOver, { capture: true, passive: true })
  document.addEventListener('pointerout', onOut, { capture: true, passive: true })
  document.addEventListener('focusin', onFocus, true)
  return () => {
    onOut()
    document.removeEventListener('pointerover', onOver, { capture: true })
    document.removeEventListener('pointerout', onOut, { capture: true })
    document.removeEventListener('focusin', onFocus, true)
  }
}
