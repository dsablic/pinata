import type { Box, Mark } from './surfaces.ts'

export type Marked = { element: Element, box: Box }

const MARK_PROPERTY = '--pinata'
const MARK_ATTRIBUTE = 'data-pinata'
const UNRELATED_CHANGE_DELAY_MS = 250
const MOVES_WITH_VIEWPORT = new Set(['fixed', 'sticky'])
const CLIPPING_OVERFLOW = new Set(['hidden', 'clip', 'auto', 'scroll'])

export function registerMarkProperty (): void {
  try {
    CSS.registerProperty({ name: MARK_PROPERTY, syntax: '*', inherits: false })
  } catch {}
}

function markOf (element: Element, style: CSSStyleDeclaration): Mark | 'none' | undefined {
  const value = element.getAttribute(MARK_ATTRIBUTE)?.trim() ?? style.getPropertyValue(MARK_PROPERTY).trim()
  return value === 'ground' || value === 'wall' || value === 'none' ? value : undefined
}

type Visible = { left: number, right: number, top: number, bottom: number }

function clipTo (area: Visible, rect: DOMRect): Visible {
  return {
    left: Math.max(area.left, rect.left),
    right: Math.min(area.right, rect.right),
    top: Math.max(area.top, rect.top),
    bottom: Math.min(area.bottom, rect.bottom)
  }
}

export function scan (root: Element = document.body): Marked[] {
  registerMarkProperty()
  const found: Marked[] = []
  const unclipped: Visible = { left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity }
  const visit = (element: Element, visible: Visible): void => {
    const style = getComputedStyle(element)
    const mark = markOf(element, style)
    if (mark === 'none' || style.display === 'none' || MOVES_WITH_VIEWPORT.has(style.position)) return
    const rect = element.getBoundingClientRect()
    const showing = mark !== undefined && style.visibility === 'visible' && rect.top >= visible.top &&
      rect.top <= visible.bottom && Math.min(rect.right, visible.right) > Math.max(rect.left, visible.left)
    if (mark !== undefined && showing) {
      const left = Math.max(rect.left, visible.left)
      const right = Math.min(rect.right, visible.right)
      found.push({
        element,
        box: {
          id: found.length,
          mark,
          left: left + window.scrollX,
          top: rect.top + window.scrollY,
          width: right - left,
          height: rect.height
        }
      })
    }
    const clips = CLIPPING_OVERFLOW.has(style.overflowX) || CLIPPING_OVERFLOW.has(style.overflowY)
    const inside = clips ? clipTo(visible, rect) : visible
    for (const child of element.children) visit(child, inside)
  }
  visit(root, unclipped)
  return found
}

function touchesMarked (node: Node, marked: ReadonlySet<Element>): boolean {
  if (!(node instanceof Element)) return node.parentElement !== null && touchesMarked(node.parentElement, marked)
  if (node.hasAttribute(MARK_ATTRIBUTE)) return true
  for (const element of marked) if (node === element || node.contains(element) || element.contains(node)) return true
  return false
}

const SAME_SIZE_PX = 0.5

function sizeChanged (entry: ResizeObserverEntry, scanned: Box | undefined): boolean {
  const size = entry.borderBoxSize?.[0]
  if (scanned === undefined || size === undefined) return false
  const wider = Math.abs(size.inlineSize - scanned.width) > SAME_SIZE_PX
  return wider || Math.abs(size.blockSize - scanned.height) > SAME_SIZE_PX
}

export function watch (
  onChange: () => void,
  marked: () => readonly Marked[],
  ignore: (node: Node) => boolean = () => false
): () => void {
  let frame: number | undefined
  let delayed: ReturnType<typeof setTimeout> | undefined
  const observed = new Set<Element>()
  const fresh = new Map<Element, Box | undefined>()
  const resize = new ResizeObserver(entries => {
    const changed = entries.filter(entry => {
      if (!fresh.has(entry.target)) return true
      const scanned = fresh.get(entry.target)
      fresh.delete(entry.target)
      return sizeChanged(entry, scanned)
    })
    if (changed.length > 0) now()
  })
  const observeMarked = (): void => {
    const boxes = new Map<Element, Box | undefined>([[document.documentElement, undefined]])
    for (const m of marked()) boxes.set(m.element, m.box)
    for (const element of observed) {
      if (boxes.has(element)) continue
      resize.unobserve(element)
      observed.delete(element)
      fresh.delete(element)
    }
    for (const [element, box] of boxes) {
      if (observed.has(element)) continue
      observed.add(element)
      fresh.set(element, box)
      resize.observe(element)
    }
  }
  const now = (): void => {
    if (frame !== undefined) return
    if (delayed !== undefined) clearTimeout(delayed)
    delayed = undefined
    frame = requestAnimationFrame(() => {
      frame = undefined
      onChange()
      observeMarked()
    })
  }
  const soon = (): void => {
    if (frame !== undefined || delayed !== undefined) return
    delayed = setTimeout(now, UNRELATED_CHANGE_DELAY_MS)
  }
  const mutation = new MutationObserver(records => {
    const current = new Set(marked().map(m => m.element))
    const own = records.filter(record => !ignore(record.target))
    if (own.length === 0) return
    const relevant = own.some(record => {
      if (record.type === 'childList') return true
      return record.attributeName === MARK_ATTRIBUTE || touchesMarked(record.target, current)
    })
    if (relevant) now()
    else soon()
  })
  mutation.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [MARK_ATTRIBUTE, 'class', 'style', 'hidden', 'open']
  })
  const innerScroll = (event: Event): void => {
    if (event.target !== document) now()
  }
  document.addEventListener('scroll', innerScroll, { capture: true, passive: true })
  window.addEventListener('resize', now)
  document.fonts?.addEventListener('loadingdone', now)
  observeMarked()
  return () => {
    resize.disconnect()
    mutation.disconnect()
    document.removeEventListener('scroll', innerScroll, { capture: true })
    window.removeEventListener('resize', now)
    document.fonts?.removeEventListener('loadingdone', now)
    if (frame !== undefined) cancelAnimationFrame(frame)
    if (delayed !== undefined) clearTimeout(delayed)
  }
}
