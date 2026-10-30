import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { writeOutput } from '../diagnostics/report.ts'

const ROOT = resolve(import.meta.dirname, '..', '..')
const OUT = resolve(process.argv[2] ?? join(ROOT, '_site'))

function commit (): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

/** The world config with every cast member's mannequin, style and rig, as one file for the browser. */
function worldBundle (examples: string): unknown {
  const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))
  const config = read(join(ROOT, 'site', 'world.json')) as { cast: string[] }
  const cast = config.cast.map(name => {
    const dir = join(examples, name)
    return {
      name,
      mannequin: read(join(dir, 'mannequin.json')),
      style: read(join(dir, 'style.json')),
      rig: read(join(dir, 'rig.json'))
    }
  })
  return { config, cast }
}

/**
 * Assembles the showcase: the pages, the compiled browser code (npm run build:web first), the world bundle, and one
 * live artifact for every example that has a behaviours.json.
 */
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
