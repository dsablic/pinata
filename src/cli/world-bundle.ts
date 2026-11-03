import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './paths.ts'

export type DrawnWalk = { character: string, view: string, walk: unknown }

export function worldBundle (examples = join(ROOT, 'examples'), drawn?: DrawnWalk): unknown {
  const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))
  const config = read(join(ROOT, 'site', 'world.json')) as { cast: string[] }
  const cast = config.cast.map(name => {
    const dir = join(examples, name)
    return {
      name,
      mannequin: read(join(dir, 'mannequin.json')),
      style: read(join(dir, 'style.json')),
      rig: read(join(dir, 'rig.json')),
      materials: read(join(dir, 'materials.json')),
      motion: read(join(dir, 'motion.json')),
      ...(existsSync(join(dir, 'skin.json')) ? { skin: skinOf(name, read(join(dir, 'skin.json')), drawn) } : {})
    }
  })
  const clipDir = join(ROOT, 'motion', 'clips')
  const clips = readdirSync(clipDir).filter(f => f.endsWith('.json')).sort().map(f => read(join(clipDir, f)))
  const members = Object.fromEntries(config.cast
    .filter(name => existsSync(join(examples, name, 'retarget.json')))
    .map(name => [name, read(join(examples, name, 'retarget.json'))]))
  return { config, cast, capture: { clips, base: read(join(ROOT, 'motion', 'humanoid.json')), members } }
}

function skinOf (name: string, skin: unknown, drawn: DrawnWalk | undefined): unknown {
  if (drawn === undefined || drawn.character !== name) return skin
  const own = skin as { views: Record<string, object> }
  return { ...own, views: { ...own.views, [drawn.view]: { ...own.views[drawn.view], walk: drawn.walk } } }
}
