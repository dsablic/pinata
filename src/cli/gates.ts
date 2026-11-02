import { MID_AIR_PX, PLANTED_TOLERANCE_PX, readWorld, run, scenario, standing } from '../diagnostics/page-scenarios.ts'
import type { Standing } from '../diagnostics/page-scenarios.ts'
import type { Sample } from '../page/cast.ts'
import { LAYOUTS, readLayout } from '../page/fixture.ts'
import type { LayoutSpec } from '../page/fixture.ts'
import { load, pause, withSite } from './chrome.ts'
import type { Session } from './chrome.ts'
import { ROOT } from './paths.ts'
import { worldBundle } from './world-bundle.ts'

const NODE_SECONDS = 60
const BROWSER_SECONDS = 20

function report (m: Standing, where: string): void {
  const line = (met: boolean, name: string, detail: string): string => {
    return `${met ? 'GATE MET' : 'GATE MISSED'} ${name} ${where} (${detail})`
  }
  console.log(line(m.off === 0, `every planted foot within ${PLANTED_TOLERANCE_PX} CSS px of its surface`,
    `${m.off} of ${m.planted} off, worst ${m.worst.toFixed(2)} px`))
  console.log(line(m.midAir === 0, 'no character in mid-air except while falling',
    `${m.midAir} of ${m.frames} frames with every foot more than ${MID_AIR_PX} px up`))
}

async function inChrome (session: Session, spec: LayoutSpec): Promise<Sample[]> {
  await load(session, { page: spec.page, width: spec.width, height: spec.height })
  await session.evaluate('window.__pinata.samples()')
  await pause(BROWSER_SECONDS * 1000)
  return await session.evaluate<Sample[]>('window.__pinata.samples()')
}

async function main (): Promise<number> {
  if (process.argv.includes('--browser')) {
    await withSite(async session => {
      for (const spec of LAYOUTS) {
        report(standing(await inChrome(session, spec)), `on ${spec.name} in Chrome over ${BROWSER_SECONDS} s`)
      }
    })
    return 0
  }
  const world = readWorld(worldBundle())
  for (const spec of LAYOUTS) {
    const s = scenario(world, readLayout(ROOT, spec.name))
    run(s, NODE_SECONDS)
    report(standing(s.cast.samples()), `on ${spec.name} over ${NODE_SECONDS} s`)
  }
  return 0
}

process.exitCode = await main()
