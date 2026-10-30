import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAmc, parseAsf } from '../mocap/asf.ts'
import { clipFromAmc } from '../mocap/clip.ts'

type Take = { name: string, subject: string, trial: string, description: string }
type Takes = { database: string, fps: number, sourceFps: number, drop: string[], takes: Take[] }

const BASE = 'http://mocap.cs.cmu.edu/subjects'
const USAGE = 'usage: node src/cli/mocap.ts fetch <takes.json> <source-dir>\n' +
  '       node src/cli/mocap.ts convert <takes.json> <source-dir> <out-dir>'

function files (take: Take): { asf: string, amc: string } {
  return { asf: `${take.subject}.asf`, amc: `${take.subject}_${take.trial.padStart(2, '0')}.amc` }
}

async function fetchTakes (takes: Takes, dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true })
  const names = new Set(takes.takes.flatMap(take => Object.values(files(take)).map(f => `${take.subject}/${f}`)))
  for (const name of names) {
    const response = await fetch(`${BASE}/${name}`)
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
    writeFileSync(join(dir, name.split('/')[1]), await response.text())
    console.log(`fetched ${name}`)
  }
}

function convert (takes: Takes, dir: string, out: string): void {
  mkdirSync(out, { recursive: true })
  for (const take of takes.takes) {
    const { asf, amc } = files(take)
    const skeleton = parseAsf(readFileSync(join(dir, asf), 'utf8'))
    const source = `${takes.database}, subject ${take.subject}, trial ${take.trial} (${take.description})`
    const clip = clipFromAmc(skeleton, parseAmc(readFileSync(join(dir, amc), 'utf8')), {
      name: take.name, source, sourceFps: takes.sourceFps, fps: takes.fps, drop: takes.drop
    })
    writeFileSync(join(out, `${take.name}.json`), `${JSON.stringify(clip)}\n`)
    console.log(`${take.name}: ${clip.frames.length} frames from ${amc}`)
  }
}

const [command, takesFile, dir, out] = process.argv.slice(2)
if (takesFile === undefined || dir === undefined) {
  console.error(USAGE)
  process.exit(2)
}
const takes = JSON.parse(readFileSync(takesFile, 'utf8')) as Takes
if (command === 'fetch') await fetchTakes(takes, dir)
else if (command === 'convert' && out !== undefined) convert(takes, dir, out)
else {
  console.error(USAGE)
  process.exit(2)
}
