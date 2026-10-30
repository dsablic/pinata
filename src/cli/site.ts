import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs'
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

/**
 * Assembles the showcase: the page, the compiled browser runtime (npm run build:web first) and one live artifact for
 * every example that has a behaviours.json.
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
  writeOutput(join(OUT, 'build.json'), JSON.stringify({ commit: commit(), characters }))
  writeOutput(join(OUT, '.nojekyll'), '')
  console.log(`site: ${OUT} (${characters.length} characters)`)
  return 0
}

process.exitCode = main()
