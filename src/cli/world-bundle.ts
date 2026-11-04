import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './paths.ts'

export function worldBundle (examples = join(ROOT, 'examples')): unknown {
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
      ...(existsSync(join(dir, 'skin.json')) ? { skin: read(join(dir, 'skin.json')) } : {})
    }
  })
  const clipDir = join(ROOT, 'motion', 'clips')
  const clips = readdirSync(clipDir).filter(f => f.endsWith('.json')).sort().map(f => read(join(clipDir, f)))
  const members = Object.fromEntries(config.cast
    .filter(name => existsSync(join(examples, name, 'retarget.json')))
    .map(name => [name, read(join(examples, name, 'retarget.json'))]))
  return { config, cast, capture: { clips, base: read(join(ROOT, 'motion', 'humanoid.json')), members } }
}
