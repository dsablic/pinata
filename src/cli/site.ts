import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { writeOutput } from '../diagnostics/report.ts'
import { ROOT } from './paths.ts'

const OUT = resolve(process.argv[2] ?? join(ROOT, '_site'))

function commit (): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

function worldBundle (examples: string): unknown {
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

function main (): number {
  const web = join(ROOT, 'dist', 'web')
  if (!existsSync(join(web, 'runtime', 'showcase.js'))) {
    console.error('dist/web is missing: run npm run build:web first')
    return 2
  }
  rmSync(OUT, { recursive: true, force: true })
  cpSync(join(ROOT, 'site'), OUT, { recursive: true })
  cpSync(web, join(OUT, 'js'), { recursive: true })
  const examples = join(ROOT, 'examples')
  const characters = readdirSync(examples).filter(name => existsSync(join(examples, name, 'behaviours.json')))
  for (const name of characters) {
    execFileSync(process.execPath, [
      join(ROOT, 'src', 'cli', 'artifact.ts'), join(examples, name), join(OUT, 'characters', `${name}.json`)
    ], { stdio: 'inherit' })
  }
  writeOutput(join(OUT, 'world.bundle.json'), JSON.stringify(worldBundle(examples)))
  writeOutput(join(OUT, 'build.json'), JSON.stringify({ commit: commit(), characters }))
  writeOutput(join(OUT, '.nojekyll'), '')
  console.log(`site: ${OUT} (${characters.length} characters)`)
  return 0
}

process.exitCode = main()
