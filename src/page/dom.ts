import type { Box, Mark } from './surfaces.ts'

export type Marked = { element: Element, box: Box }

export function scan (root: Element = document.body): Marked[] {
  const found: Marked[] = []
  const visit = (element: Element, inherited: string | undefined): void => {
    const own = element.getAttribute('data-pinata')?.trim()
    const style = getComputedStyle(element).getPropertyValue('--pinata').trim() || undefined
    const value = own ?? (style !== inherited ? style : undefined)
    if (value === 'none') return
    const mark: Mark | undefined = value === 'ground' || value === 'wall' ? value : undefined
    if (mark !== undefined) {
      const rect = element.getBoundingClientRect()
      found.push({
        element,
        box: {
          id: found.length,
          mark,
          left: rect.left + window.scrollX,
          top: rect.top + window.scrollY,
          width: rect.width,
          height: rect.height
        }
      })
    }
    for (const child of element.children) visit(child, style)
  }
  visit(root, undefined)
  return found
}

export function watch (onChange: () => void, root: Element = document.body): () => void {
  let pending = false
  const schedule = (): void => {
    if (pending) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      onChange()
    })
  }
  const resize = new ResizeObserver(schedule)
  resize.observe(root)
  const mutation = new MutationObserver(schedule)
  mutation.observe(root, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['data-pinata', 'class', 'style', 'hidden']
  })
  window.addEventListener('resize', schedule)
  void document.fonts?.ready.then(schedule)
  return () => {
    resize.disconnect()
    mutation.disconnect()
    window.removeEventListener('resize', schedule)
  }
}
