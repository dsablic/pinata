import { writeOutput } from '../diagnostics/report.ts'
import { LAYOUTS, layoutPath } from '../page/fixture.ts'
import type { LaidOutMark, LayoutFixture, LayoutSpec, Target } from '../page/fixture.ts'
import { INTERACTIVE } from '../page/perception.ts'
import { load, pause, withSite } from './chrome.ts'
import type { Session } from './chrome.ts'
import { ROOT } from './paths.ts'

const SETTLE_MS = 1500

export async function recordLayout (session: Session, spec: LayoutSpec): Promise<LayoutFixture> {
  await load(session, { page: spec.page, width: spec.width, height: spec.height, reducedMotion: true })
  await pause(SETTLE_MS)
  const marks = await session.evaluate<LaidOutMark[]>(
    'window.__pinata.layout().map(m => ({ id: m.element, box: m.box, hints: m.hints }))')
  const ids = marks.map(m => m.id)
  if (ids.some(id => id === '') || new Set(ids).size !== ids.length) {
    throw new Error(`${spec.name}: every marked element needs its own id: ${ids.join(', ')}`)
  }
  const surfaceIds = await session.evaluate<number[]>('window.__pinata.ground().surfaces.map(s => s.id)')
  const grounds = surfaceIds.map(id => marks[id].id)
  const unnamed = await session.evaluate<number>(
    `[...document.querySelectorAll(${JSON.stringify(INTERACTIVE)})].filter(e => e.id === '').length`)
  if (unnamed > 0) throw new Error(`${spec.name}: ${unnamed} interactive elements have no id`)
  const targets = await session.evaluate<Target[]>(`(() => {
    const grounds = new Set(${JSON.stringify(grounds)})
    return [...document.querySelectorAll(${JSON.stringify(INTERACTIVE)})].map(e => {
      const rect = e.getBoundingClientRect()
      const said = e.closest('[data-pinata-say]')?.getAttribute('data-pinata-say')?.trim()
      let ground
      for (let at = e; at !== null && ground === undefined; at = at.parentElement) {
        if (grounds.has(at.id)) ground = at.id
      }
      return {
        id: e.id,
        rect: { left: rect.left + scrollX, top: rect.top + scrollY, width: rect.width },
        ...(said ? { say: said } : {}),
        ...(ground === undefined ? {} : { ground })
      }
    })
  })()`)
  return { ...spec, platform: process.platform, marks, targets }
}

async function main (): Promise<number> {
  await withSite(async session => {
    const only = process.argv.slice(2)
    for (const spec of LAYOUTS.filter(l => only.length === 0 || only.includes(l.name))) {
      const fixture = await recordLayout(session, spec)
      writeOutput(layoutPath(ROOT, spec.name), `${JSON.stringify(fixture, null, 2)}\n`)
      console.log(`${spec.name}: ${fixture.marks.length} marked elements, ${fixture.targets.length} targets`)
    }
  })
  return 0
}

if (import.meta.main) process.exitCode = await main()
