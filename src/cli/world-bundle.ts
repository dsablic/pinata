import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './paths.ts'

export type BundleOptions = { jumpTakes?: boolean, performances?: boolean, only?: string[] }

export function worldBundle (
  examples = join(ROOT, 'examples'), { jumpTakes = true, performances = true, only }: BundleOptions = {}
): unknown {
  const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))
  const world = read(join(ROOT, 'site', 'world.json')) as { cast: string[] }
  const config = only === undefined ? world : { ...world, cast: only }
  const cast = config.cast.map(name => {
    const dir = join(examples, name)
    const { attack } = read(join(dir, 'character.json')) as { attack?: unknown }
    return {
      name,
      ...(attack === undefined ? {} : { attack }),
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
    .filter(clip => {
      const { kind } = clip as { kind?: string }
      return kind === undefined || (kind === 'jump' ? jumpTakes : performances)
    })
  const members = Object.fromEntries(config.cast
    .filter(name => existsSync(join(examples, name, 'retarget.json')))
    .map(name => [name, read(join(examples, name, 'retarget.json'))]))
  return { config, cast, capture: { clips, base: read(join(ROOT, 'motion', 'humanoid.json')), members } }
}
