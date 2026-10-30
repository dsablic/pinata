import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCharacter, formatCharacterErrors } from '../../src/formats/character.ts'
import type { Character } from '../../src/formats/character.ts'
import { checkReferences } from '../../src/formats/references.ts'
import { validateStyle } from '../../src/formats/style.ts'
import type { Style } from '../../src/formats/style.ts'
import { formatErrors } from '../../src/formats/validate.ts'
import type { Validated } from '../../src/formats/validate.ts'
import { simulateCharacter } from '../../src/motion/character.ts'
import { fitCamera } from '../../src/raster/camera.ts'
import type { Camera } from '../../src/raster/camera.ts'
import { rasterize } from '../../src/raster/gbuffer.ts'
import type { GBuffer } from '../../src/raster/gbuffer.ts'
import { stylize } from '../../src/style/stylize.ts'
import { imageHash } from '../../src/image-hash.ts'
import type { Image } from '../../src/image.ts'
import { encodePng } from '../../src/png/encode.ts'
import { outlineGaps, paletteSize, strayPixels, thinParts } from '../../src/diagnostics/metrics.ts'
import { sheet } from '../../src/diagnostics/images.ts'
import type { SheetCell } from '../../src/diagnostics/images.ts'
import { evaluate, optionalGate, summarize, writeOutput } from '../../src/diagnostics/report.ts'
import { flickerFraction } from '../../src/diagnostics/stability.ts'
import { MIN_PIXELS_FOR_THIN } from '../p1-static-style/gates.ts'
import { render, turntable } from '../p2-pixel-stability/sequences.ts'
import { gate } from './gates.ts'

const CHARACTERS = ['knight', 'dwarf']
const STYLE_FILES = { default: join('..', 'p1-static-style', 'style.json'), muted: 'muted.json', vivid: 'vivid.json' }
const STYLES = Object.keys(STYLE_FILES)
const SIZES = [32, 48]
const ELEVATIONS = [0, 30]
const DIRECTIONS = 8
const MARGIN = 4
const TURN_FRAMES = 31
const TURN_DEGREES_PER_FRAME = 1
const STILL = { size: 48, elevation: 30, direction: 1, scale: 8, gap: 8, background: 0xc8c8c8 }
const SHUFFLE = [3, 0, 5, 2, 4, 1]
const CHILD_TIMEOUT_MS = 300000

type Mapping = { materials: Record<string, string>, decals: Record<string, string> }

const MAPPINGS: Record<string, Mapping> = {
  knight: { materials: {}, decals: {} },
  dwarf: {
    materials: { fur: 'steel-dark', skin: 'leather', beard: 'cloth-red' },
    decals: { e: 'x' }
  }
}

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const outDir = join(root, 'reports', 'p6')
const hashesMode = process.argv.includes('--hashes')
const verify = process.argv.includes('--verify')

if (!hashesMode) rmSync(outDir, { recursive: true, force: true })

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

function requireValid<T> (file: string, result: Validated<T>): T {
  if (result.value === undefined || result.errors.length > 0) fail(formatErrors(file, result.errors))
  return result.value
}

function readStyle (file: string): Style {
  try {
    return requireValid(file, validateStyle(JSON.parse(readFileSync(join(here, file), 'utf8'))))
  } catch (err) {
    if (err instanceof SyntaxError) fail(`${file}: invalid JSON: ${err.message}`)
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') fail(`${file}: file not found`)
    throw err
  }
}

function readCharacter (name: string): Character {
  const result = loadCharacter(join(root, 'examples', name))
  if (result.value === undefined || result.errors.length > 0) fail(formatCharacterErrors(result.errors))
  return result.value
}

function adapt (style: Style, character: Character): Style {
  const mapping = MAPPINGS[character.name]
  const materials: Style['materials'] = {}
  for (const part of character.mannequin.parts) {
    const name = part.material
    const source = Object.hasOwn(style.materials, name) ? name : mapping.materials[name]
    if (source !== undefined && Object.hasOwn(style.materials, source)) materials[name] = style.materials[source]
  }
  const decalColors: Style['decalColors'] = { ...style.decalColors }
  for (const [ch, source] of Object.entries(mapping.decals)) {
    if (!Object.hasOwn(decalColors, ch) && Object.hasOwn(style.decalColors, source)) {
      decalColors[ch] = style.decalColors[source]
    }
  }
  const adapted = { ...style, materials, decalColors }
  const errors = checkReferences(character.mannequin, adapted)
  if (errors.length > 0) fail(formatErrors(`${character.name} with style ${style.name}`, errors))
  return adapted
}

const characters = CHARACTERS.map(readCharacter)
const styles = new Map(Object.entries(STYLE_FILES).map(([name, file]) => [name, readStyle(file)]))
const adapted = new Map(characters.flatMap(c => STYLES.map((s): [string, Style] => {
  return [`${c.name}/${s}`, adapt(styles.get(s) as Style, c)]
})))

type Frame = {
  id: string
  camera: Camera
  gbuffer: GBuffer
  image: Image
  decalMask: Uint8Array
  outlineMask: Uint8Array
}

function renderFrame (character: Character, style: Style, view: [number, number, number]): Frame {
  const [size, elevation, direction] = view
  const camera = fitCamera(character.mannequin, {
    azimuthDeg: direction * 45, elevationDeg: elevation, targetHeightPx: size, margin: MARGIN
  })
  const gbuffer = rasterize(character.mannequin, camera)
  const { image, decalMask, outlineMask } = stylize(gbuffer, character.mannequin, camera, style)
  return { id: `${size}px-el${elevation}-d${direction}`, camera, gbuffer, image, decalMask, outlineMask }
}

function staticFrames (character: Character, style: Style): Frame[] {
  return SIZES.flatMap(size => ELEVATIONS.flatMap(elevation => {
    return Array.from({ length: DIRECTIONS }, (_, d) => renderFrame(character, style, [size, elevation, d]))
  }))
}

function floatHash (parts: Array<[string, Float64Array]>): string {
  const hash = createHash('sha256')
  for (const [name, values] of parts) {
    hash.update(name).update(new Uint8Array(values.buffer, values.byteOffset, values.byteLength))
  }
  return hash.digest('hex')
}

function motionHashes (character: Character): string[] {
  const { mannequin, rig, scenario, materials } = character
  const run = simulateCharacter({ mannequin, rig, scenario, materials })
  return run.poses.map((pose, i) => {
    const names = Object.keys(pose).sort()
    return floatHash([
      [names.join(','), Float64Array.from(names.flatMap(name => pose[name]))],
      ['cloth', Float64Array.from(run.recording.frames[i].positions)]
    ])
  })
}

type Cell = { key: string, character: Character, style: Style, frames: Frame[], motion: string[] }

const cells: Cell[] = characters.flatMap(character => STYLES.map(name => {
  const style = adapted.get(`${character.name}/${name}`) as Style
  return {
    key: `${character.name}/${name}`, character, style, frames: staticFrames(character, style),
    motion: motionHashes(character)
  }
}))

function hashLines (): Array<[string, string]> {
  return cells.flatMap(c => [
    ...c.frames.map((f): [string, string] => [`${c.key}/${f.id}`, imageHash(f.image)]),
    [`${c.key}/motion`, createHash('sha256').update(c.motion.join(',')).digest('hex')] as [string, string]
  ])
}

if (hashesMode) {
  for (const [id, hash] of hashLines()) console.log(`${id} ${hash}`)
  process.exit(0)
}

function childHashes (): Map<string, string> {
  const output = execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--hashes'], {
    encoding: 'utf8', timeout: CHILD_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024
  })
  return new Map(output.split('\n').filter(l => l !== '').map(l => l.split(' ') as [string, string]))
}

function mismatches (): number {
  const other = childHashes()
  return hashLines().filter(([id, hash]) => other.get(id) !== hash).length
}

const nondeterministic = verify ? mismatches() : 0

function staticValues (cell: Cell): Record<string, number> {
  const { mannequin } = cell.character
  const perFrame = cell.frames.map(f => {
    const thin = thinParts(f.gbuffer, mannequin).filter(p => p.pixels >= MIN_PIXELS_FOR_THIN)
    return {
      outlineGaps: outlineGaps(f.image, f.outlineMask),
      strayPixels: strayPixels(f.image, f.decalMask),
      maxThinFraction: Math.max(0, ...thin.map(p => p.thinFraction))
    }
  })
  return {
    outlineGaps: Math.max(...perFrame.map(m => m.outlineGaps)),
    maxThinFraction: Math.max(...perFrame.map(m => m.maxThinFraction)),
    paletteSize: paletteSize(cell.frames.map(f => f.image)),
    maxStrayPixels: Math.max(...perFrame.map(m => m.strayPixels))
  }
}

function flicker (cell: Cell, size: number): number {
  const spin = turntable(cell.character.mannequin, TURN_FRAMES, TURN_DEGREES_PER_FRAME)
  const view = { azimuthDeg: 0, elevationDeg: 30, targetHeightPx: size }
  return flickerFraction(render(spin, view, cell.style).images)
}

const values = new Map(cells.map(c => {
  const flickers = Object.fromEntries(SIZES.map(size => [`flicker${size}`, flicker(c, size)]))
  return [c.key, { ...staticValues(c), ...flickers }]
}))

const identical = characters.filter(character => {
  const own = cells.filter(c => c.character === character)
  return own.every(c => c.motion.length === own[0].motion.length && c.motion.every((h, i) => h === own[0].motion[i]))
}).length

const results = evaluate([
  gate('motionIdentical', identical / characters.length),
  ...cells.flatMap(c => {
    const v = values.get(c.key) as Record<string, number>
    return [
      gate('outlineGaps', v.outlineGaps, c.key),
      gate('maxThinFraction', v.maxThinFraction, c.key),
      gate('paletteSize', v.paletteSize, c.key),
      gate('maxStrayPixels', v.maxStrayPixels, c.key),
      ...SIZES.map(size => gate('flickerFraction', v[`flicker${size}`], `${c.key}.turntable-${size}`))
    ]
  }),
  optionalGate(gate('nondeterministicFrames', nondeterministic), verify)
])

const motionFrames = characters.map(c => `${c.name} ${cells.find(x => x.character === c)?.motion.length} frames`)
const notes = [
  `motion frames hashed per style run: ${motionFrames.join(', ')}`,
  `turntable: ${TURN_FRAMES} frames at ${TURN_DEGREES_PER_FRAME} degree per frame, elevation 30, sizes ${SIZES}`
]
const summary = [summarize('P6 style swap', results), ...notes].join('\n')

function stillCell (cell: Cell): SheetCell {
  const frame = renderFrame(cell.character, cell.style, [STILL.size, STILL.elevation, STILL.direction])
  return { image: frame.image, anchor: [frame.camera.width / 2, frame.camera.baseline] }
}

const stills = cells.map(stillCell)
const sheetOptions = { scale: STILL.scale, gap: STILL.gap, background: STILL.background }
const key = SHUFFLE.map((index, i) => {
  const file = `image-${i + 1}.png`
  writeOutput(join(outDir, 'judge', file), encodePng(sheet([[stills[index]]], sheetOptions)))
  return { file, character: cells[index].character.name, style: STYLES[index % STYLES.length] }
})
writeOutput(join(outDir, 'judge-key.json'), JSON.stringify(key, null, 2))
writeOutput(join(outDir, 'contact-sheet.png'), encodePng(sheet(
  characters.map((_, r) => stills.slice(r * STYLES.length, (r + 1) * STYLES.length)), sheetOptions
)))
const metricsReport = { gates: results, values: Object.fromEntries(values) }
writeOutput(join(outDir, 'metrics.json'), JSON.stringify(metricsReport, null, 2))
writeOutput(join(outDir, 'summary.txt'), `${summary}\n`)

console.log(summary)
process.exitCode = results.every(r => r.pass) ? 0 : 1
