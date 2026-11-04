import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const [repo, out, keyFile] = process.argv.slice(2)
const frames = join(repo, 'reports/p1/frames')
const refs = join(repo, 'refs/p1')
const FACING = ['front', 'front, turned to screen-left', 'side, facing screen-left', 'back, turned to screen-left',
  'back', 'back, turned to screen-right', 'side, facing screen-right', 'front, turned to screen-right']
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const order = (items, salt) => items
  .map(x => [createHash('sha256').update(salt + JSON.stringify(x)).digest('hex'), x])
  .sort((a, b) => a[0].localeCompare(b[0])).map(([, x]) => x)
const magick = args => execFileSync('magick', args)
const big = (src, dst) => magick([src, '-background', '#c8c8c8', '-gravity', 'center', '-extent', '%[fx:w+8]x%[fx:h+8]',
  '-filter', 'point', '-resize', '800%', dst])
const pair = (left, right, dst) => magick(['(', left, ')', '(', right, ')', '-background', '#c8c8c8', '-gravity', 'south',
  '+append', '-filter', 'point', '-resize', '800%', dst].flatMap(a => a))

const key = { facing: {}, parts: {}, ab: {} }
const facingItems = order([0, 30].flatMap(el => FACING.map((_, d) => ({ el, d }))), 'facing')
facingItems.forEach(({ el, d }, i) => {
  const name = `f${String(i + 1).padStart(2, '0')}.png`
  big(join(frames, `32px-el${el}-d${d}.png`), join(out, name))
  key.facing[name] = { frame: `32px-el${el}-d${d}`, truth: FACING[d] }
})

const padTo = (src, h) => ['(', src, '-background', 'none', '-gravity', 'south', '-extent', `%[fx:w+6]x${h}`, ')']
const ours = { 'bastianse-pixelknight-48.png': '32px-el30-d0', 'marqueeplier-knight-64.png': '48px-el30-d1',
  'polygondan-pixel-knight-32.png': '32px-el30-d7' }
const real = Object.entries(ours).map(([ref, frame]) => ({ kind: 'real', ref, frame }))
const controls = [
  { kind: 'control', a: 'polygondan-pixel-knight-32.png', b: 'bastianse-pixelknight-48.png' },
  { kind: 'control', a: 'marqueeplier-knight-64.png', b: 'polygondan-pixel-knight-32.png' }
]
const abItems = order([...real, ...controls].flatMap(p => [{ ...p, swap: false }, { ...p, swap: true }]), 'ab')
abItems.forEach((p, i) => {
  const name = `p${String(i + 1).padStart(2, '0')}.png`
  const x = p.kind === 'real' ? join(frames, `${p.frame}.png`) : join(refs, p.a)
  const y = p.kind === 'real' ? join(refs, p.ref) : join(refs, p.b)
  const [left, right] = p.swap ? [y, x] : [x, y]
  magick([left, right, '-trim', '+repage', '-background', 'none', '-gravity', 'south', '-extent', '%[fx:w+12]x72', '+append', '+repage',
    '-background', '#c8c8c8', '-flatten', '-filter', 'point', '-resize', '800%', join(out, name)])
  key.ab[name] = p.kind === 'real'
    ? { kind: 'real', ref: p.ref, frame: p.frame, ours: p.swap ? 'right' : 'left' }
    : { kind: 'control', left: p.swap ? p.b : p.a, right: p.swap ? p.a : p.b }
})
writeFileSync(keyFile, JSON.stringify(key, null, 2))
console.log(Object.keys(key.facing).length, 'facing items;', Object.keys(key.ab).length, 'pair items')
