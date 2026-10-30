import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateMannequin } from '../../src/formats/mannequin.ts'
import { validateStyle } from '../../src/formats/style.ts'
import { checkReferences } from '../../src/formats/references.ts'
import { formatErrors } from '../../src/formats/validate.ts'
import type { Validated } from '../../src/formats/validate.ts'
import { fitCamera } from '../../src/raster/camera.ts'
import type { Camera } from '../../src/raster/camera.ts'
import { rasterize } from '../../src/raster/gbuffer.ts'
import type { GBuffer } from '../../src/raster/gbuffer.ts'
import { stylize } from '../../src/style/stylize.ts'
import { imageHash, parseHex } from '../../src/image.ts'
import type { Image } from '../../src/image.ts'
import { encodePng } from '../../src/png/encode.ts'
import { outlineGaps, paletteSize, strayPixels, thinParts } from '../../src/diagnostics/metrics.ts'
import { depthImage, normalImage, partImage, sheet } from '../../src/diagnostics/images.ts'
import { evaluate, summarize, writeOutput } from '../../src/diagnostics/report.ts'
import { gate } from './gates.ts'
import { pngHeight, planAb } from './ab.ts'
import type { AbPlan } from './ab.ts'
import { previewHtml } from './preview.ts'
import type { AbPair } from './preview.ts'

const SIZES = [32, 48]
const ELEVATIONS = [0, 30]
const DIRECTIONS = 8
const MARGIN = 4
const SHEET_SCALE = 8
const SHEET_BACKGROUND = 0xc8c8c8
const MIN_PIXELS_FOR_THIN = 4
const CHILD_TIMEOUT_MS = 60000
const FACING = ['front', 'front-left', 'left', 'back-left', 'back', 'back-right', 'right', 'front-right']

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const outDir = join(root, 'reports', 'p1')
const refsDir = join(root, 'refs', 'p1')
const hashesMode = process.argv.includes('--hashes')

if (!hashesMode) rmSync(outDir, { recursive: true, force: true })

type Frame = {
  id: string
  size: number
  elevation: number
  direction: number
  camera: Camera
  gbuffer: GBuffer
  image: Image
  decalMask: Uint8Array
}

function requireValid<T> (file: string, result: Validated<T>): T {
  if (result.value === undefined || result.errors.length > 0) {
    fail(formatErrors(file, result.errors))
  }
  return result.value
}

function fail (message: string): never {
  console.error(message)
  if (!hashesMode) writeOutput(join(outDir, 'summary.txt'), `automated gates: ERROR\n${message}\n`)
  process.exit(2)
}

process.on('uncaughtException', err => {
  try {
    fail(err instanceof Error ? (err.stack ?? err.message) : String(err))
  } catch {
    process.exit(2)
  }
})

function loadJson (file: string): unknown {
  try {
    return JSON.parse(readFileSync(join(here, file), 'utf8'))
  } catch (err) {
    if (err instanceof SyntaxError) fail(`${file}: invalid JSON: ${err.message}`)
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') fail(`${file}: file not found`)
    throw err
  }
}

function frameCamera (size: number, elevation: number, direction: number): Camera {
  try {
    return fitCamera(mannequin, {
      azimuthDeg: direction * 45,
      elevationDeg: elevation,
      targetHeightPx: size,
      margin: MARGIN
    })
  } catch (err) {
    if (err instanceof RangeError) fail(`camera for ${size}px elevation ${elevation}: ${err.message}`)
    throw err
  }
}

const mannequin = requireValid('knight.json', validateMannequin(loadJson('knight.json')))
const style = requireValid('style.json', validateStyle(loadJson('style.json')))
const referenceErrors = checkReferences(mannequin, style)
if (referenceErrors.length > 0) {
  fail(formatErrors('knight.json', referenceErrors))
}

function renderFrame (size: number, elevation: number, direction: number): Frame {
  const camera = frameCamera(size, elevation, direction)
  const gbuffer = rasterize(mannequin, camera)
  const { image, decalMask } = stylize(gbuffer, mannequin, camera, style)
  return { id: `${size}px-el${elevation}-d${direction}`, size, elevation, direction, camera, gbuffer, image, decalMask }
}

const frames = SIZES.flatMap(size => ELEVATIONS.flatMap(elevation => {
  return Array.from({ length: DIRECTIONS }, (_, direction) => renderFrame(size, elevation, direction))
}))

if (hashesMode) {
  for (const f of frames) console.log(`${f.id} ${imageHash(f.image)}`)
  process.exit(0)
}

const rows = SIZES.flatMap(size => ELEVATIONS.map(elevation => {
  return frames.filter(f => f.size === size && f.elevation === elevation)
}))

const outline = parseHex(style.outline)
const frameMetrics = frames.map(f => {
  const thin = thinParts(f.gbuffer, mannequin).filter(p => p.pixels >= MIN_PIXELS_FOR_THIN)
  return {
    id: f.id,
    outlineGaps: outlineGaps(f.image, outline),
    strayPixels: strayPixels(f.image, f.decalMask),
    maxThinFraction: Math.max(0, ...thin.map(p => p.thinFraction)),
    thinParts: thin
  }
})

function childHashes (): Map<string, string> {
  const args = [fileURLToPath(import.meta.url), '--hashes']
  const output = execFileSync(process.execPath, args, { encoding: 'utf8', timeout: CHILD_TIMEOUT_MS })
  const hashes = new Map<string, string>()
  for (const line of output.split('\n').filter(l => l !== '')) {
    const [id, hash] = line.split(' ')
    hashes.set(id, hash)
  }
  return hashes
}

const other = childHashes()
const nondeterministic = frames.filter(f => other.get(f.id) !== imageHash(f.image)).length

const results = evaluate([
  gate('outlineGaps', Math.max(...frameMetrics.map(m => m.outlineGaps))),
  gate('maxThinFraction', Math.max(...frameMetrics.map(m => m.maxThinFraction))),
  gate('paletteSize', paletteSize(frames.map(f => f.image))),
  gate('maxStrayPixels', Math.max(...frameMetrics.map(m => m.strayPixels))),
  gate('nondeterministicFrames', nondeterministic)
])
const summary = summarize('P1 static style', results)

function abPairs (): { pairs: AbPair[], key: AbPlan[] } {
  const names = existsSync(refsDir) ? readdirSync(refsDir).filter(f => f.endsWith('.png')).sort() : []
  const bytes = new Map(names.map(name => [name, readFileSync(join(refsDir, name))]))
  const key = planAb(names.map(name => ({ name, height: pngHeight(bytes.get(name) as Uint8Array) })))
  const pairs = key.map(p => {
    const frame = frames.find(f => f.id === p.frame) as Frame
    const files = [encodePng(frame.image), bytes.get(p.ref) as Uint8Array]
    const [left, right] = p.ours === 'left' ? files : [files[1], files[0]]
    writeOutput(join(outDir, 'ab', `pair${p.pair}-a.png`), left)
    writeOutput(join(outDir, 'ab', `pair${p.pair}-b.png`), right)
    return { left: `ab/pair${p.pair}-a.png`, right: `ab/pair${p.pair}-b.png` }
  })
  return { pairs, key }
}

for (const f of frames) writeOutput(join(outDir, 'frames', `${f.id}.png`), encodePng(f.image))
const sheetOptions = { scale: SHEET_SCALE, gap: SHEET_SCALE, background: SHEET_BACKGROUND }
function writeSheet (name: string, cell: (f: Frame) => Image): void {
  const cells = rows.map(r => r.map(f => {
    const anchor: [number, number] = [f.camera.width / 2, f.camera.baseline]
    return { image: cell(f), anchor }
  }))
  writeOutput(join(outDir, name), encodePng(sheet(cells, sheetOptions)))
}
writeSheet('sheet.png', f => f.image)
writeSheet('debug-parts.png', f => partImage(f.gbuffer))
writeSheet('debug-normals.png', f => normalImage(f.gbuffer))
writeSheet('debug-depth.png', f => depthImage(f.gbuffer))
const { pairs, key } = abPairs()
writeOutput(join(outDir, 'ab-key.json'), JSON.stringify({ facing: FACING, pairs: key }, null, 2))
writeOutput(join(outDir, 'metrics.json'), JSON.stringify({ gates: results, frames: frameMetrics }, null, 2))
writeOutput(join(outDir, 'summary.txt'), `${summary}\n`)
writeOutput(join(outDir, 'preview.html'), previewHtml(summary, pairs))

console.log(summary)
console.log(`report: ${join(outDir, 'preview.html')}`)
process.exitCode = results.every(r => r.pass) ? 0 : 1
