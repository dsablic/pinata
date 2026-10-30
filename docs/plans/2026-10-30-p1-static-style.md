# P1 Static Style Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the PoC harness and run P1 from [`docs/plans/2026-10-30-viability-design.md`](2026-10-30-viability-design.md): render a hand-written
3D mannequin in a standing pose as pixel art (8 directions, side and 3/4 views, 32px and 48px), measure it against
the P1 gates, and produce a review report.

**Architecture:** The mannequin is joints plus primitive volumes (round cones and rounded boxes) described in JSON.
A CPU rasterizer sphere-traces each primitive per sub-sample under an orthographic camera and produces a low-res
G-buffer (part ID, depth, camera-space normal, coverage). A stylizer turns the G-buffer into pixel art: banded shading
from material ramps, inner lines at depth breaks, stray-pixel cleanup, decals at anchors, and a 1px outline. A P1
runner renders every view, computes metrics, evaluates gates, and writes a report folder (PNGs, metrics JSON, summary,
preview HTML with an A/B section).

**Tech Stack:** Node 24 (runs `.ts` directly via type stripping, no build), TypeScript for type checking only
(`tsc --noEmit`), `node:test`, `node:zlib` for PNG. No runtime dependencies.

**Conventions:** Standard JS style (no semicolons, single quotes, space before function parens). `node:` prefix for
built-ins. Local imports use `.ts` extensions (type-stripping project). Type-only imports use `import type`. Only
erasable TypeScript syntax: no enums, namespaces or parameter properties. Lines under 120 columns. Commit messages:
subject line only, under 70 characters, ending with the attribution trailer.

**Layout:**

```
src/math/vec.ts             Vec3 helpers
src/image.ts                RGBA image, pixel access, neighbours, hashing
src/png/encode.ts           PNG encoder
src/formats/validate.ts     shared validation helpers
src/formats/mannequin.ts    mannequin schema + validation
src/formats/style.ts        style schema + validation
src/formats/references.ts   cross-file checks (materials, decal colours)
src/raster/sdf.ts           signed distance functions
src/raster/camera.ts        orthographic camera
src/raster/gbuffer.ts       rasterizer
src/style/stylize.ts        G-buffer to pixel art
src/diagnostics/metrics.ts  P1 metrics
src/diagnostics/images.ts   contact sheets, debug passes
src/diagnostics/report.ts   gates, summary, file writing
pocs/p1-static-style/       knight.json, style.json, gates.ts, preview.ts, run.ts
refs/                       reference sprites + licences
test/                       unit tests
```

The design doc lists one package per component. This plan uses one package with a directory per component instead;
split into workspaces only when a second consumer needs it.

---

### Task 0: Repository setup

**Files:**
- Create: [`package.json`](../../package.json), [`tsconfig.json`](../../tsconfig.json), [`.gitignore`](../../.gitignore)

**Step 1: Initialise git**

```bash
cd /Users/denis/Documents/labtiva/pinata
git init -b main
```

**Step 2: Create [`package.json`](../../package.json)**

```json
{
  "name": "pinata",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "test": "node --test \"test/**/*.test.ts\"",
    "typecheck": "tsc",
    "p1": "node pocs/p1-static-style/run.ts"
  }
}
```

**Step 3: Create [`tsconfig.json`](../../tsconfig.json)**

```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "types": ["node"]
  },
  "include": ["src", "test", "pocs"]
}
```

**Step 4: Create [`.gitignore`](../../.gitignore)**

```
node_modules/
reports/
```

**Step 5: Install dev dependencies**

Use @readcube-ai-skills:npm-safe-install for this step.

```bash
npm install --save-dev typescript @types/node@24
```

Expected: [`package.json`](../../package.json) gains `devDependencies` with `typescript` and `@types/node`.

**Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore docs/
git commit -m "Add project scaffold and viability design" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Vector math

**Files:**
- Create: [`src/math/vec.ts`](../../src/math/vec.ts)
- Create: [`test/helpers.ts`](../../test/helpers.ts)
- Test: [`test/vec.test.ts`](../../test/vec.test.ts)

**Step 1: Write the test helper**

[`test/helpers.ts`](../../test/helpers.ts):

```ts
import assert from 'node:assert/strict'

export function assertClose (actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`)
}
```

**Step 2: Write the failing test**

[`test/vec.test.ts`](../../test/vec.test.ts):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { add, cross, dot, length, normalize, scale, sub } from '../src/math/vec.ts'
import { assertClose } from './helpers.ts'

test('add, sub and scale work per component', () => {
  assert.deepEqual(add([1, 2, 3], [4, 5, 6]), [5, 7, 9])
  assert.deepEqual(sub([4, 5, 6], [1, 2, 3]), [3, 3, 3])
  assert.deepEqual(scale([1, 2, 3], 2), [2, 4, 6])
})

test('cross of x and y is z', () => {
  assert.deepEqual(cross([1, 0, 0], [0, 1, 0]), [0, 0, 1])
})

test('dot and length', () => {
  assert.equal(dot([1, 2, 3], [4, 5, 6]), 32)
  assert.equal(length([3, 4, 0]), 5)
})

test('normalize returns a unit vector and leaves zero alone', () => {
  assertClose(length(normalize([3, 4, 12])), 1)
  assert.deepEqual(normalize([0, 0, 0]), [0, 0, 0])
})
```

**Step 3: Run test to verify it fails**

Run: `node --test test/vec.test.ts`
Expected: FAIL with `Cannot find module` for [`src/math/vec.ts`](../../src/math/vec.ts).

**Step 4: Write the implementation**

[`src/math/vec.ts`](../../src/math/vec.ts):

```ts
export type Vec3 = [number, number, number]

export function add (a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

export function sub (a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

export function scale (a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s]
}

export function dot (a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function cross (a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ]
}

export function length (a: Vec3): number {
  return Math.sqrt(dot(a, a))
}

export function normalize (a: Vec3): Vec3 {
  const l = length(a)
  return l === 0 ? [0, 0, 0] : scale(a, 1 / l)
}
```

**Step 5: Run test to verify it passes**

Run: `node --test test/vec.test.ts`
Expected: PASS, 4 tests.

**Step 6: Commit**

```bash
git add src/math test/helpers.ts test/vec.test.ts
git commit -m "Add vector math" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Image and PNG encoding

**Files:**
- Create: [`src/image.ts`](../../src/image.ts), [`src/png/encode.ts`](../../src/png/encode.ts)
- Test: [`test/image.test.ts`](../../test/image.test.ts), [`test/png.test.ts`](../../test/png.test.ts)

**Step 1: Write the failing tests**

[`test/image.test.ts`](../../test/image.test.ts):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createImage, getPixel, imageHash, neighbours4, parseHex, setPixel, TRANSPARENT } from '../src/image.ts'

test('pixels round-trip as packed RGB and start transparent', () => {
  const img = createImage(2, 2)
  assert.equal(getPixel(img, 0, 0), TRANSPARENT)
  setPixel(img, 1, 0, 0x123456)
  assert.equal(getPixel(img, 1, 0), 0x123456)
  setPixel(img, 1, 0, TRANSPARENT)
  assert.equal(getPixel(img, 1, 0), TRANSPARENT)
})

test('reads outside the image are transparent', () => {
  assert.equal(getPixel(createImage(1, 1), -1, 0), TRANSPARENT)
})

test('neighbours4 returns right, left, down, up', () => {
  const img = createImage(3, 3)
  setPixel(img, 2, 1, 1)
  setPixel(img, 0, 1, 2)
  setPixel(img, 1, 2, 3)
  setPixel(img, 1, 0, 4)
  assert.deepEqual(neighbours4(img, 1, 1), [1, 2, 3, 4])
})

test('parseHex reads #rrggbb', () => {
  assert.equal(parseHex('#ff8000'), 0xff8000)
})

test('imageHash changes when a pixel changes', () => {
  const img = createImage(2, 2)
  const before = imageHash(img)
  setPixel(img, 0, 0, 0xffffff)
  assert.notEqual(imageHash(img), before)
})
```

[`test/png.test.ts`](../../test/png.test.ts):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'
import { createImage, setPixel } from '../src/image.ts'
import { crc32, encodePng } from '../src/png/encode.ts'

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
})

test('encodes a 1x1 red pixel', () => {
  const img = createImage(1, 1)
  setPixel(img, 0, 0, 0xff0000)
  const png = encodePng(img)
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  assert.equal(png.toString('ascii', 12, 16), 'IHDR')
  assert.equal(png.readUInt32BE(16), 1)
  assert.equal(png.readUInt32BE(20), 1)
  const idatLength = png.readUInt32BE(33)
  assert.equal(png.toString('ascii', 37, 41), 'IDAT')
  const raw = inflateSync(png.subarray(41, 41 + idatLength))
  assert.deepEqual([...raw], [0, 255, 0, 0, 255])
  assert.equal(png.toString('ascii', png.length - 8, png.length - 4), 'IEND')
})
```

**Step 2: Run tests to verify they fail**

Run: `node --test test/image.test.ts test/png.test.ts`
Expected: FAIL with `Cannot find module`.

**Step 3: Write the implementation**

[`src/image.ts`](../../src/image.ts):

```ts
import { createHash } from 'node:crypto'

export type Image = { width: number, height: number, data: Uint8ClampedArray }

export const TRANSPARENT = -1

const OFFSETS_4: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const OFFSETS_8: Array<[number, number]> = [...OFFSETS_4, [1, 1], [1, -1], [-1, 1], [-1, -1]]

export function createImage (width: number, height: number): Image {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

export function parseHex (hex: string): number {
  return Number.parseInt(hex.slice(1), 16)
}

export function getPixel (img: Image, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return TRANSPARENT
  const i = (y * img.width + x) * 4
  if (img.data[i + 3] === 0) return TRANSPARENT
  return (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]
}

export function setPixel (img: Image, x: number, y: number, rgb: number): void {
  const i = (y * img.width + x) * 4
  if (rgb === TRANSPARENT) {
    img.data.fill(0, i, i + 4)
    return
  }
  img.data[i] = (rgb >> 16) & 0xff
  img.data[i + 1] = (rgb >> 8) & 0xff
  img.data[i + 2] = rgb & 0xff
  img.data[i + 3] = 255
}

export function neighbours4 (img: Image, x: number, y: number): number[] {
  return OFFSETS_4.map(([dx, dy]) => getPixel(img, x + dx, y + dy))
}

export function neighbours8 (img: Image, x: number, y: number): number[] {
  return OFFSETS_8.map(([dx, dy]) => getPixel(img, x + dx, y + dy))
}

export function imageHash (img: Image): string {
  return createHash('sha256').update(`${img.width}x${img.height}`).update(img.data).digest('hex')
}
```

[`src/png/encode.ts`](../../src/png/encode.ts):

```ts
import { deflateSync } from 'node:zlib'
import type { Image } from '../image.ts'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const CRC_TABLE = buildCrcTable()

function buildCrcTable (): Uint32Array {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
}

export function crc32 (bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) {
    c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk (type: string, body: Uint8Array): Buffer {
  const typeAndBody = Buffer.concat([Buffer.from(type, 'ascii'), body])
  const out = Buffer.alloc(8 + body.length + 4)
  out.writeUInt32BE(body.length, 0)
  typeAndBody.copy(out, 4)
  out.writeUInt32BE(crc32(typeAndBody), 8 + body.length)
  return out
}

export function encodePng (img: Image): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(img.width, 0)
  header.writeUInt32BE(img.height, 4)
  header[8] = 8
  header[9] = 6
  const stride = img.width * 4
  const raw = Buffer.alloc((stride + 1) * img.height)
  for (let y = 0; y < img.height; y++) {
    raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0))
  ])
}
```

Header bytes 8 and 9 are bit depth 8 and colour type 6 (RGBA). Each row starts with filter byte 0, which
`Buffer.alloc` already zeroes.

**Step 4: Run tests to verify they pass**

Run: `node --test test/image.test.ts test/png.test.ts`
Expected: PASS, 7 tests.

**Step 5: Commit**

```bash
git add src/image.ts src/png test/image.test.ts test/png.test.ts
git commit -m "Add RGBA image helpers and PNG encoder" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Mannequin format

The format is the contract an AI writes, so every error names the path, says what is wrong, and says what to do.

**Files:**
- Create: [`src/formats/validate.ts`](../../src/formats/validate.ts), [`src/formats/mannequin.ts`](../../src/formats/mannequin.ts)
- Test: [`test/mannequin.test.ts`](../../test/mannequin.test.ts)

**Step 1: Write the failing test**

[`test/mannequin.test.ts`](../../test/mannequin.test.ts):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateMannequin } from '../src/formats/mannequin.ts'

function valid () {
  return {
    name: 'blob',
    height: 2,
    joints: { base: [0, 0, 0], top: [0, 1, 0] },
    parts: [
      { name: 'body', shape: 'capsule', a: 'base', b: 'top', radiusA: 0.3, radiusB: 0.2, material: 'skin' },
      {
        name: 'cape',
        shape: 'box',
        a: 'top',
        b: 'base',
        width: 0.5,
        thickness: 0.05,
        rounding: 0.02,
        widthAxis: [1, 0, 0],
        material: 'cloth'
      }
    ],
    decals: [{ name: 'eye', anchor: 'top', normal: [0, 0, 1], pattern: ['x.x'] }]
  }
}

function paths (input: unknown): string[] {
  return validateMannequin(input).errors.map(e => e.path)
}

test('accepts a valid mannequin', () => {
  const result = validateMannequin(valid())
  assert.deepEqual(result.errors, [])
  assert.equal(result.value?.parts.length, 2)
})

test('decals default to an empty list', () => {
  const input: Record<string, unknown> = valid()
  delete input.decals
  assert.deepEqual(validateMannequin(input).value?.decals, [])
})

test('reports unknown joints with the known joint names', () => {
  const input = valid()
  input.parts[0].b = 'neck'
  const [error] = validateMannequin(input).errors
  assert.equal(error.path, 'parts[0].b')
  assert.match(error.message, /unknown joint 'neck'; known joints: base, top/)
})

test('rejects a joint called toString instead of matching the prototype', () => {
  const input = valid()
  input.parts[0].a = 'toString'
  assert.deepEqual(paths(input), ['parts[0].a'])
})

test('rejects duplicate part names', () => {
  const input = valid()
  input.parts[1].name = 'body'
  assert.deepEqual(paths(input), ['parts[1].name'])
})

test('rejects rounding larger than half the thinnest box side', () => {
  const input = valid()
  input.parts[1].rounding = 0.1
  assert.deepEqual(paths(input), ['parts[1].rounding'])
})

test('rejects a width axis parallel to the box', () => {
  const input = valid()
  input.parts[1].widthAxis = [0, 1, 0]
  assert.deepEqual(paths(input), ['parts[1].widthAxis'])
})

test('rejects a capsule whose end spheres swallow each other', () => {
  const input = valid()
  input.parts[0].radiusA = 2
  assert.deepEqual(paths(input), ['parts[0]'])
})

test('rejects ragged decal patterns', () => {
  const input = valid()
  input.decals[0].pattern = ['x.x', 'x']
  assert.deepEqual(paths(input), ['decals[0].pattern'])
})

test('rejects unknown shapes', () => {
  const input = valid()
  input.parts[0].shape = 'cone'
  assert.deepEqual(paths(input), ['parts[0].shape'])
})
```

**Step 2: Run test to verify it fails**

Run: `node --test test/mannequin.test.ts`
Expected: FAIL with `Cannot find module`.

**Step 3: Write the implementation**

[`src/formats/validate.ts`](../../src/formats/validate.ts):

```ts
import type { Vec3 } from '../math/vec.ts'

export type ValidationError = { path: string, message: string }

export type Validated<T> = { value?: T, errors: ValidationError[] }

export function isRecord (v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isNonEmptyString (v: unknown): v is string {
  return typeof v === 'string' && v !== ''
}

export function isFiniteNumber (v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function isPositive (v: unknown): v is number {
  return isFiniteNumber(v) && v > 0
}

export function isVec3 (v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber)
}

export function formatErrors (file: string, errors: ValidationError[]): string {
  return errors.map(e => `${file}: ${e.path === '' ? '(root)' : e.path}: ${e.message}`).join('\n')
}
```

[`src/formats/mannequin.ts`](../../src/formats/mannequin.ts):

```ts
import { cross, length, normalize, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { isFiniteNumber, isNonEmptyString, isPositive, isRecord, isVec3 } from './validate.ts'
import type { Validated, ValidationError } from './validate.ts'

export type CapsulePart = {
  name: string
  shape: 'capsule'
  a: string
  b: string
  radiusA: number
  radiusB: number
  material: string
  allowThin?: boolean
}

export type BoxPart = {
  name: string
  shape: 'box'
  a: string
  b: string
  width: number
  thickness: number
  rounding: number
  widthAxis: Vec3
  material: string
  allowThin?: boolean
}

export type Part = CapsulePart | BoxPart

export type Decal = { name: string, anchor: string, normal: Vec3, pattern: string[] }

export type Mannequin = {
  name: string
  height: number
  joints: Record<string, Vec3>
  parts: Part[]
  decals: Decal[]
}

type Context = { joints: Record<string, unknown>, names: Set<string>, errors: ValidationError[] }

export function validateMannequin (input: unknown): Validated<Mannequin> {
  if (!isRecord(input)) return { errors: [{ path: '', message: 'expected a JSON object' }] }
  const errors: ValidationError[] = []
  if (!isNonEmptyString(input.name)) errors.push({ path: 'name', message: 'expected a non-empty string' })
  if (!isPositive(input.height)) {
    errors.push({
      path: 'height',
      message: 'expected a positive number: the standing height in model units, used to scale to pixels'
    })
  }
  const joints = isRecord(input.joints) ? input.joints : {}
  if (!isRecord(input.joints)) {
    errors.push({ path: 'joints', message: 'expected an object mapping joint name to [x, y, z]' })
  }
  for (const [name, value] of Object.entries(joints)) {
    if (!isVec3(value)) errors.push({ path: `joints.${name}`, message: 'expected [x, y, z] of finite numbers' })
  }
  if (!Array.isArray(input.parts) || input.parts.length === 0) {
    errors.push({ path: 'parts', message: 'expected a non-empty array of parts' })
  }
  const ctx: Context = { joints, names: new Set(), errors }
  const parts: unknown[] = Array.isArray(input.parts) ? input.parts : []
  parts.forEach((part, i) => { validatePart(part, `parts[${i}]`, ctx) })
  if (input.decals !== undefined && !Array.isArray(input.decals)) {
    errors.push({ path: 'decals', message: 'expected an array of decals' })
  }
  const decals: unknown[] = Array.isArray(input.decals) ? input.decals : []
  decals.forEach((decal, i) => { validateDecal(decal, `decals[${i}]`, ctx) })
  if (errors.length > 0) return { errors }
  return { value: { ...input, decals } as unknown as Mannequin, errors }
}

function jointRef (value: unknown, path: string, ctx: Context): Vec3 | undefined {
  const joint = typeof value === 'string' && Object.hasOwn(ctx.joints, value) ? ctx.joints[value] : undefined
  if (isVec3(joint)) return joint
  if (joint === undefined) {
    const known = Object.keys(ctx.joints).join(', ')
    ctx.errors.push({ path, message: `unknown joint '${String(value)}'; known joints: ${known}` })
  }
  return undefined
}

function validatePart (part: unknown, path: string, ctx: Context): void {
  if (!isRecord(part)) {
    ctx.errors.push({ path, message: 'expected an object' })
    return
  }
  if (!isNonEmptyString(part.name)) {
    ctx.errors.push({ path: `${path}.name`, message: 'expected a non-empty string' })
  } else if (ctx.names.has(part.name)) {
    ctx.errors.push({ path: `${path}.name`, message: `duplicate part name '${part.name}'` })
  } else {
    ctx.names.add(part.name)
  }
  if (!isNonEmptyString(part.material)) {
    ctx.errors.push({ path: `${path}.material`, message: 'expected a material name' })
  }
  if (part.allowThin !== undefined && typeof part.allowThin !== 'boolean') {
    ctx.errors.push({ path: `${path}.allowThin`, message: 'expected true or false' })
  }
  const a = jointRef(part.a, `${path}.a`, ctx)
  const b = jointRef(part.b, `${path}.b`, ctx)
  if (part.shape === 'capsule') {
    validateCapsule(part, path, ctx, [a, b])
  } else if (part.shape === 'box') {
    validateBox(part, path, ctx, [a, b])
  } else {
    ctx.errors.push({
      path: `${path}.shape`,
      message: `unknown shape '${String(part.shape)}'; expected 'capsule' or 'box'`
    })
  }
}

type Ends = [Vec3 | undefined, Vec3 | undefined]

function validateCapsule (part: Record<string, unknown>, path: string, ctx: Context, [a, b]: Ends): void {
  const { radiusA, radiusB } = part
  if (!isPositive(radiusA)) ctx.errors.push({ path: `${path}.radiusA`, message: 'expected a positive number' })
  if (!isPositive(radiusB)) ctx.errors.push({ path: `${path}.radiusB`, message: 'expected a positive number' })
  if (a === undefined || b === undefined || !isPositive(radiusA) || !isPositive(radiusB)) return
  const span = length(sub(b, a))
  const difference = Math.abs(radiusA - radiusB)
  if (span > 0 && difference >= span) {
    ctx.errors.push({
      path,
      message: `radius difference ${difference} must be smaller than the joint distance ${span}; ` +
        'otherwise one end sphere swallows the other'
    })
  }
}

function validateBox (part: Record<string, unknown>, path: string, ctx: Context, [a, b]: Ends): void {
  const { width, thickness, rounding, widthAxis } = part
  if (!isPositive(width)) ctx.errors.push({ path: `${path}.width`, message: 'expected a positive number' })
  if (!isPositive(thickness)) ctx.errors.push({ path: `${path}.thickness`, message: 'expected a positive number' })
  if (!isFiniteNumber(rounding) || rounding < 0) {
    ctx.errors.push({ path: `${path}.rounding`, message: 'expected a number >= 0' })
  } else if (isPositive(width) && isPositive(thickness) && rounding > Math.min(width, thickness) / 2) {
    ctx.errors.push({
      path: `${path}.rounding`,
      message: `must be at most ${Math.min(width, thickness) / 2} (half the smaller of width and thickness)`
    })
  }
  if (!isVec3(widthAxis) || length(widthAxis) === 0) {
    ctx.errors.push({ path: `${path}.widthAxis`, message: 'expected a non-zero [x, y, z] pointing across the part' })
    return
  }
  if (a === undefined || b === undefined) return
  const segment = sub(b, a)
  if (length(segment) === 0) {
    ctx.errors.push({ path: `${path}.b`, message: 'a box needs distinct joints a and b' })
    return
  }
  if (length(cross(normalize(segment), normalize(widthAxis))) < 0.1) {
    ctx.errors.push({
      path: `${path}.widthAxis`,
      message: 'nearly parallel to the a->b direction; pick an axis across the part'
    })
  }
}

function validateDecal (decal: unknown, path: string, ctx: Context): void {
  if (!isRecord(decal)) {
    ctx.errors.push({ path, message: 'expected an object' })
    return
  }
  if (!isNonEmptyString(decal.name)) ctx.errors.push({ path: `${path}.name`, message: 'expected a non-empty string' })
  jointRef(decal.anchor, `${path}.anchor`, ctx)
  if (!isVec3(decal.normal) || length(decal.normal) === 0) {
    ctx.errors.push({ path: `${path}.normal`, message: 'expected a non-zero [x, y, z] facing out of the surface' })
  }
  const { pattern } = decal
  if (!Array.isArray(pattern) || pattern.length === 0 || !pattern.every(isNonEmptyString)) {
    ctx.errors.push({ path: `${path}.pattern`, message: 'expected a non-empty array of strings, one per pixel row' })
  } else if (new Set(pattern.map(row => row.length)).size !== 1) {
    ctx.errors.push({ path: `${path}.pattern`, message: 'all rows must have the same length' })
  }
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/mannequin.test.ts`
Expected: PASS, 10 tests.

**Step 5: Type-check**

Run: `npm run typecheck`
Expected: no output, exit code 0. The test file mutates literal-typed fields (for example `input.parts[0].shape = 'cone'`).
If `tsc` rejects an assignment because of the inferred literal union, annotate `valid()` as returning
`Record<string, any>` rather than adding casts at each call site.

**Step 6: Commit**

```bash
git add src/formats test/mannequin.test.ts
git commit -m "Add mannequin format with actionable validation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Style format and cross-file checks

**Files:**
- Create: [`src/formats/style.ts`](../../src/formats/style.ts), [`src/formats/references.ts`](../../src/formats/references.ts)
- Test: [`test/style.test.ts`](../../test/style.test.ts)

**Step 1: Write the failing test**

[`test/style.test.ts`](../../test/style.test.ts):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateStyle } from '../src/formats/style.ts'
import type { Style } from '../src/formats/style.ts'
import { checkReferences } from '../src/formats/references.ts'
import type { Mannequin } from '../src/formats/mannequin.ts'

function valid () {
  return {
    name: 'test',
    light: [0, 1, 1],
    bands: [0, 0.6],
    outline: '#101010',
    innerLineDepth: 0.1,
    decalMinFacing: 0.3,
    materials: { skin: ['#300000', '#600000', '#900000'] },
    decalColors: { x: '#000000' }
  }
}

test('accepts a valid style', () => {
  assert.deepEqual(validateStyle(valid()).errors, [])
})

test('rejects a ramp whose length does not match the bands', () => {
  const input = valid()
  input.materials.skin = ['#300000', '#600000']
  const [error] = validateStyle(input).errors
  assert.equal(error.path, 'materials.skin')
  assert.match(error.message, /2 colours but bands define 3 shades/)
})

test('rejects bands that are not ascending', () => {
  const input = valid()
  input.bands = [0.6, 0]
  assert.deepEqual(validateStyle(input).errors.map(e => e.path), ['bands'])
})

test('rejects malformed colours', () => {
  const input = valid()
  input.outline = 'black'
  assert.deepEqual(validateStyle(input).errors.map(e => e.path), ['outline'])
})

test('cross-check reports materials and decal characters the style lacks', () => {
  const style = validateStyle(valid()).value as Style
  const mannequin: Mannequin = {
    name: 'm',
    height: 1,
    joints: { o: [0, 0, 0] },
    parts: [{ name: 'p', shape: 'capsule', a: 'o', b: 'o', radiusA: 1, radiusB: 1, material: 'metal' }],
    decals: [{ name: 'd', anchor: 'o', normal: [0, 0, 1], pattern: ['x.y'] }]
  }
  const errors = checkReferences(mannequin, style)
  assert.deepEqual(errors.map(e => e.path), ['parts[0].material', 'decals[0].pattern'])
  assert.match(errors[1].message, /character 'y'/)
})
```

**Step 2: Run test to verify it fails**

Run: `node --test test/style.test.ts`
Expected: FAIL with `Cannot find module`.

**Step 3: Write the implementation**

[`src/formats/style.ts`](../../src/formats/style.ts):

```ts
import { length } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { isFiniteNumber, isNonEmptyString, isPositive, isRecord, isVec3 } from './validate.ts'
import type { Validated, ValidationError } from './validate.ts'

export type Style = {
  name: string
  light: Vec3
  bands: number[]
  outline: string
  innerLineDepth: number
  decalMinFacing: number
  materials: Record<string, string[]>
  decalColors: Record<string, string>
}

const HEX = /^#[0-9a-fA-F]{6}$/

function isHex (v: unknown): v is string {
  return typeof v === 'string' && HEX.test(v)
}

export function validateStyle (input: unknown): Validated<Style> {
  if (!isRecord(input)) return { errors: [{ path: '', message: 'expected a JSON object' }] }
  const errors: ValidationError[] = []
  if (!isNonEmptyString(input.name)) errors.push({ path: 'name', message: 'expected a non-empty string' })
  if (!isVec3(input.light) || length(input.light) === 0) {
    errors.push({ path: 'light', message: 'expected a non-zero [x, y, z] in camera space pointing toward the light' })
  }
  const bands = Array.isArray(input.bands) && input.bands.every(isFiniteNumber) ? input.bands : undefined
  if (bands === undefined || bands.some((t, i) => t < -1 || t > 1 || (i > 0 && t <= bands[i - 1]))) {
    errors.push({ path: 'bands', message: 'expected strictly ascending numbers between -1 and 1' })
  }
  if (!isHex(input.outline)) errors.push({ path: 'outline', message: 'expected a colour like #1b1421' })
  if (!isPositive(input.innerLineDepth)) {
    errors.push({ path: 'innerLineDepth', message: 'expected a positive depth jump in model units' })
  }
  if (!isFiniteNumber(input.decalMinFacing) || input.decalMinFacing < 0 || input.decalMinFacing > 1) {
    errors.push({ path: 'decalMinFacing', message: 'expected a number between 0 and 1' })
  }
  validateMaterials(input.materials, bands, errors)
  validateDecalColors(input.decalColors, errors)
  if (errors.length > 0) return { errors }
  return { value: input as unknown as Style, errors }
}

function validateMaterials (materials: unknown, bands: number[] | undefined, errors: ValidationError[]): void {
  if (!isRecord(materials) || Object.keys(materials).length === 0) {
    errors.push({ path: 'materials', message: 'expected an object mapping material name to a colour ramp' })
    return
  }
  for (const [name, ramp] of Object.entries(materials)) {
    const path = `materials.${name}`
    if (!Array.isArray(ramp) || !ramp.every(isHex)) {
      errors.push({ path, message: 'expected an array of colours like #1b1421, darkest first' })
    } else if (bands !== undefined && ramp.length !== bands.length + 1) {
      errors.push({
        path,
        message: `ramp has ${ramp.length} colours but bands define ${bands.length + 1} shades; add or remove colours`
      })
    }
  }
}

function validateDecalColors (decalColors: unknown, errors: ValidationError[]): void {
  if (!isRecord(decalColors)) {
    errors.push({ path: 'decalColors', message: 'expected an object mapping a pattern character to a colour' })
    return
  }
  for (const [ch, colour] of Object.entries(decalColors)) {
    if (ch.length !== 1 || ch === '.') {
      errors.push({ path: `decalColors.${ch}`, message: "keys must be single characters other than '.'" })
    } else if (!isHex(colour)) {
      errors.push({ path: `decalColors.${ch}`, message: 'expected a colour like #1b1421' })
    }
  }
}
```

[`src/formats/references.ts`](../../src/formats/references.ts):

```ts
import type { Mannequin } from './mannequin.ts'
import type { Style } from './style.ts'
import type { ValidationError } from './validate.ts'

export function checkReferences (m: Mannequin, s: Style): ValidationError[] {
  const errors: ValidationError[] = []
  m.parts.forEach((part, i) => {
    if (!Object.hasOwn(s.materials, part.material)) {
      errors.push({
        path: `parts[${i}].material`,
        message: `material '${part.material}' has no ramp in style '${s.name}'; add materials['${part.material}']`
      })
    }
  })
  m.decals.forEach((decal, i) => {
    for (const ch of new Set(decal.pattern.join(''))) {
      if (ch !== '.' && !Object.hasOwn(s.decalColors, ch)) {
        errors.push({
          path: `decals[${i}].pattern`,
          message: `character '${ch}' has no colour in style '${s.name}' decalColors; use '.' for transparent`
        })
      }
    }
  })
  return errors
}
```

**Step 4: Run tests and type-check**

Run: `node --test test/style.test.ts && npm run typecheck`
Expected: PASS, 5 tests; typecheck clean. Apply the same `Record<string, any>` fix as Task 3 if needed.

**Step 5: Commit**

```bash
git add src/formats test/style.test.ts
git commit -m "Add style format and cross-file reference checks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Signed distance functions

Round cones (capsules with different end radii) and rounded boxes are enough for a blocky mannequin. The round cone
formula is Inigo Quilez's exact SDF (https://iquilezles.org/articles/distfunctions/).

**Files:**
- Create: [`src/raster/sdf.ts`](../../src/raster/sdf.ts)
- Test: [`test/sdf.test.ts`](../../test/sdf.test.ts)

**Step 1: Write the failing test**

[`test/sdf.test.ts`](../../test/sdf.test.ts):

```ts
import { test } from 'node:test'
import { boxFrame, sdBox, sdRoundCone } from '../src/raster/sdf.ts'
import { assertClose } from './helpers.ts'

test('round cone with equal radii is a capsule', () => {
  assertClose(sdRoundCone([0, 0.5, 1], [0, 0, 0], [0, 1, 0], 0.5, 0.5), 0.5)
  assertClose(sdRoundCone([0, 2, 0], [0, 0, 0], [0, 1, 0], 0.5, 0.5), 0.5)
})

test('round cone measures to the larger end sphere below it', () => {
  assertClose(sdRoundCone([0, -2, 0], [0, 0, 0], [0, 3, 0], 1, 0.5), 1)
})

test('round cone with coincident joints is a sphere', () => {
  assertClose(sdRoundCone([2, 0, 0], [0, 0, 0], [0, 0, 0], 1, 1), 1)
})

test('box distance outside and inside', () => {
  const frame = boxFrame([0, 0, 0], [0, 2, 0], { widthAxis: [1, 0, 0], width: 2, thickness: 1, rounding: 0 })
  assertClose(sdBox([0, 1, 1.5], frame), 1)
  assertClose(sdBox([0, 1, 0], frame), -0.5)
})

test('rounded box keeps its outer extent', () => {
  const frame = boxFrame([0, 0, 0], [0, 2, 0], { widthAxis: [1, 0, 0], width: 2, thickness: 1, rounding: 0.2 })
  assertClose(sdBox([0, 1, 0.5], frame), 0)
})
```

**Step 2: Run test to verify it fails**

Run: `node --test test/sdf.test.ts`
Expected: FAIL with `Cannot find module`.

**Step 3: Write the implementation**

[`src/raster/sdf.ts`](../../src/raster/sdf.ts):

```ts
import { add, cross, dot, length, normalize, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'

export type BoxFrame = { center: Vec3, x: Vec3, y: Vec3, z: Vec3, half: Vec3, rounding: number }

export type BoxOptions = { widthAxis: Vec3, width: number, thickness: number, rounding: number }

export function sdRoundCone (p: Vec3, a: Vec3, b: Vec3, ra: number, rb: number): number {
  const ba = sub(b, a)
  const l2 = dot(ba, ba)
  const pa = sub(p, a)
  if (l2 < 1e-12) return length(pa) - Math.max(ra, rb)
  const rr = ra - rb
  const a2 = l2 - rr * rr
  const il2 = 1 / l2
  const y = dot(pa, ba)
  const z = y - l2
  const w = sub(scale(pa, l2), scale(ba, y))
  const x2 = dot(w, w)
  const y2 = y * y * l2
  const z2 = z * z * l2
  const k = Math.sign(rr) * rr * rr * x2
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - ra
}

export function boxFrame (a: Vec3, b: Vec3, options: BoxOptions): BoxFrame {
  const segment = sub(b, a)
  const y = normalize(segment)
  const x = normalize(sub(options.widthAxis, scale(y, dot(options.widthAxis, y))))
  return {
    center: scale(add(a, b), 0.5),
    x,
    y,
    z: cross(x, y),
    half: [options.width / 2, length(segment) / 2, options.thickness / 2],
    rounding: options.rounding
  }
}

export function sdBox (p: Vec3, f: BoxFrame): number {
  const d = sub(p, f.center)
  const r = f.rounding
  const qx = Math.abs(dot(d, f.x)) - (f.half[0] - r)
  const qy = Math.abs(dot(d, f.y)) - (f.half[1] - r)
  const qz = Math.abs(dot(d, f.z)) - (f.half[2] - r)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0))
  const inside = Math.min(Math.max(qx, qy, qz), 0)
  return outside + inside - r
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/sdf.test.ts`
Expected: PASS, 5 tests.

**Step 5: Commit**

```bash
git add src/raster/sdf.ts test/sdf.test.ts
git commit -m "Add round cone and rounded box distance functions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Orthographic camera

Conventions: Y is up, the character faces +Z, and +X is the character's left. Azimuth 0 looks at the character's
front. Elevation 0 is a pure side view; 30 is a 3/4 view. Pixel rows grow downward, and the ground (y = 0 at the
root) sits on `baseline`.

**Files:**
- Create: [`src/raster/camera.ts`](../../src/raster/camera.ts)
- Test: [`test/camera.test.ts`](../../test/camera.test.ts)

**Step 1: Write the failing test**

[`test/camera.test.ts`](../../test/camera.test.ts):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeCamera, project, rayOrigin } from '../src/raster/camera.ts'
import { add, scale } from '../src/math/vec.ts'
import type { Vec3 } from '../src/math/vec.ts'
import { assertClose } from './helpers.ts'

const base = { targetHeightPx: 32, modelHeight: 2, margin: 4 }

function assertVec (actual: Vec3, expected: Vec3): void {
  actual.forEach((v, i) => { assertClose(v, expected[i], 1e-9) })
}

test('front camera maps +X to the right and +Y up', () => {
  const cam = makeCamera({ ...base, azimuthDeg: 0, elevationDeg: 0 })
  assert.equal(cam.width, 40)
  assert.equal(cam.baseline, 36)
  assertVec(cam.right, [1, 0, 0])
  assertVec(cam.up, [0, 1, 0])
  const p = project(cam, [0.5, 1, 0])
  assertClose(p.x, 28)
  assertClose(p.y, 20)
})

test('azimuth 90 looks from the character left side', () => {
  const cam = makeCamera({ ...base, azimuthDeg: 90, elevationDeg: 0 })
  assertVec(cam.forward, [-1, 0, 0])
  assertVec(cam.right, [0, 0, -1])
})

test('elevation tilts the view down', () => {
  const cam = makeCamera({ ...base, azimuthDeg: 0, elevationDeg: 30 })
  assertVec(cam.forward, [0, -0.5, -Math.sqrt(3) / 2])
})

test('a ray from a projected point hits that point at its depth', () => {
  const cam = makeCamera({ ...base, azimuthDeg: 45, elevationDeg: 30 })
  const point: Vec3 = [0.2, 0.7, -0.1]
  const p = project(cam, point)
  assertVec(add(rayOrigin(cam, p.x, p.y), scale(cam.forward, p.depth)), point)
})
```

**Step 2: Run test to verify it fails**

Run: `node --test test/camera.test.ts`
Expected: FAIL with `Cannot find module`.

**Step 3: Write the implementation**

[`src/raster/camera.ts`](../../src/raster/camera.ts):

```ts
import { add, cross, dot, normalize, scale } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'

export type Camera = {
  forward: Vec3
  right: Vec3
  up: Vec3
  pixelsPerUnit: number
  width: number
  height: number
  baseline: number
  rayDistance: number
}

export type CameraOptions = {
  azimuthDeg: number
  elevationDeg: number
  targetHeightPx: number
  modelHeight: number
  margin: number
}

export function makeCamera (o: CameraOptions): Camera {
  if (o.elevationDeg <= -90 || o.elevationDeg >= 90) throw new RangeError('elevation must be within (-90, 90)')
  const az = o.azimuthDeg * Math.PI / 180
  const el = o.elevationDeg * Math.PI / 180
  const toCamera: Vec3 = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]
  const forward = scale(toCamera, -1)
  const right = normalize(cross(forward, [0, 1, 0]))
  const size = o.targetHeightPx + 2 * o.margin
  return {
    forward,
    right,
    up: cross(right, forward),
    pixelsPerUnit: o.targetHeightPx / o.modelHeight,
    width: size,
    height: size,
    baseline: size - o.margin,
    rayDistance: o.modelHeight * 4
  }
}

export function rayOrigin (cam: Camera, x: number, y: number): Vec3 {
  const u = (x - cam.width / 2) / cam.pixelsPerUnit
  const v = (cam.baseline - y) / cam.pixelsPerUnit
  return add(add(scale(cam.right, u), scale(cam.up, v)), scale(cam.forward, -cam.rayDistance))
}

export function project (cam: Camera, p: Vec3): { x: number, y: number, depth: number } {
  return {
    x: cam.width / 2 + dot(p, cam.right) * cam.pixelsPerUnit,
    y: cam.baseline - dot(p, cam.up) * cam.pixelsPerUnit,
    depth: dot(p, cam.forward) + cam.rayDistance
  }
}

export function toCameraSpace (cam: Camera, n: Vec3): Vec3 {
  return [dot(n, cam.right), dot(n, cam.up), -dot(n, cam.forward)]
}
```

Camera-space normals have +Z pointing at the viewer, so a style's light direction stays fixed on screen (for example
upper left) whichever way the character faces.

**Step 4: Run test to verify it passes**

Run: `node --test test/camera.test.ts`
Expected: PASS, 4 tests.

**Step 5: Commit**

```bash
git add src/raster/camera.ts test/camera.test.ts
git commit -m "Add orthographic camera" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Rasterizer

Each sub-sample ray is tested against each part's bounding sphere, then sphere-traced against that single part. The
nearest hit wins. A pixel is filled when at least half its sub-samples hit; it takes the part with the most hits.

**Files:**
- Create: [`src/raster/gbuffer.ts`](../../src/raster/gbuffer.ts)
- Test: [`test/gbuffer.test.ts`](../../test/gbuffer.test.ts)

**Step 1: Write the failing test**

[`test/gbuffer.test.ts`](../../test/gbuffer.test.ts):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY, rasterize } from '../src/raster/gbuffer.ts'
import { makeCamera } from '../src/raster/camera.ts'
import type { Mannequin } from '../src/formats/mannequin.ts'
import { assertClose } from './helpers.ts'

const sphere: Mannequin = {
  name: 'sphere',
  height: 2,
  joints: { o: [0, 1, 0] },
  parts: [{ name: 'ball', shape: 'capsule', a: 'o', b: 'o', radiusA: 0.5, radiusB: 0.5, material: 'm' }],
  decals: []
}

const camera = makeCamera({ azimuthDeg: 0, elevationDeg: 0, targetHeightPx: 16, modelHeight: 2, margin: 2 })

test('a sphere fills a disc around its projected centre', () => {
  const g = rasterize(sphere, camera)
  assert.equal(g.width, 20)
  assert.equal(g.part[9 * g.width + 9], 0)
  assert.equal(g.part[0], EMPTY)
  const filled = g.part.filter(p => p !== EMPTY).length
  assert.ok(filled >= 44 && filled <= 56, `expected about 50 filled pixels, got ${filled}`)
})

test('normals face the viewer at the centre and depth matches the front surface', () => {
  const g = rasterize(sphere, camera)
  const i = 9 * g.width + 9
  assert.ok(g.normal[i * 3 + 2] > 0.9)
  assertClose(g.depth[i], 7.5, 0.02)
})

test('the nearer part wins where parts overlap', () => {
  const two: Mannequin = {
    ...sphere,
    joints: { back: [0, 1, -0.5], front: [0, 1, 0.5] },
    parts: [
      { name: 'back', shape: 'capsule', a: 'back', b: 'back', radiusA: 0.5, radiusB: 0.5, material: 'm' },
      { name: 'front', shape: 'capsule', a: 'front', b: 'front', radiusA: 0.3, radiusB: 0.3, material: 'm' }
    ]
  }
  const g = rasterize(two, camera)
  assert.equal(g.part[9 * g.width + 9], 1)
})
```

**Step 2: Run test to verify it fails**

Run: `node --test test/gbuffer.test.ts`
Expected: FAIL with `Cannot find module`.

**Step 3: Write the implementation**

[`src/raster/gbuffer.ts`](../../src/raster/gbuffer.ts):

```ts
import type { Mannequin, Part } from '../formats/mannequin.ts'
import { add, dot, length, normalize, scale, sub } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { rayOrigin, toCameraSpace } from './camera.ts'
import type { Camera } from './camera.ts'
import { boxFrame, sdBox, sdRoundCone } from './sdf.ts'

export const EMPTY = -1

export type GBuffer = {
  width: number
  height: number
  part: Int16Array
  depth: Float32Array
  normal: Float32Array
  coverage: Float32Array
}

type Primitive = { sdf: (p: Vec3) => number, center: Vec3, radius: number }

type Accumulator = { hits: Float64Array, depth: Float64Array, normal: Float64Array, total: number }

const HIT_EPSILON = 1e-4
const MAX_STEPS = 64
const NORMAL_STEP = 1e-4

function compile (m: Mannequin, part: Part): Primitive {
  const a = m.joints[part.a]
  const b = m.joints[part.b]
  const center = scale(add(a, b), 0.5)
  const halfLength = length(sub(b, a)) / 2
  if (part.shape === 'capsule') {
    return {
      sdf: p => sdRoundCone(p, a, b, part.radiusA, part.radiusB),
      center,
      radius: halfLength + Math.max(part.radiusA, part.radiusB)
    }
  }
  const frame = boxFrame(a, b, part)
  return { sdf: p => sdBox(p, frame), center, radius: length(frame.half) }
}

function trace (prim: Primitive, origin: Vec3, dir: Vec3): number {
  const oc = sub(origin, prim.center)
  const b = dot(oc, dir)
  const disc = b * b - (dot(oc, oc) - prim.radius * prim.radius)
  if (disc < 0) return Infinity
  const s = Math.sqrt(disc)
  const tFar = -b + s
  let t = Math.max(-b - s, 0)
  for (let i = 0; i < MAX_STEPS && t <= tFar; i++) {
    const d = prim.sdf(add(origin, scale(dir, t)))
    if (d < HIT_EPSILON) return t
    t += d
  }
  return Infinity
}

function surfaceNormal (prim: Primitive, p: Vec3): Vec3 {
  const h = NORMAL_STEP
  return normalize([
    prim.sdf([p[0] + h, p[1], p[2]]) - prim.sdf([p[0] - h, p[1], p[2]]),
    prim.sdf([p[0], p[1] + h, p[2]]) - prim.sdf([p[0], p[1] - h, p[2]]),
    prim.sdf([p[0], p[1], p[2] + h]) - prim.sdf([p[0], p[1], p[2] - h])
  ])
}

function sample (prims: Primitive[], cam: Camera, origin: Vec3, acc: Accumulator): void {
  let best = -1
  let bestT = Infinity
  for (let i = 0; i < prims.length; i++) {
    const t = trace(prims[i], origin, cam.forward)
    if (t < bestT) {
      bestT = t
      best = i
    }
  }
  if (best === -1) return
  const n = toCameraSpace(cam, surfaceNormal(prims[best], add(origin, scale(cam.forward, bestT))))
  acc.total++
  acc.hits[best]++
  acc.depth[best] += bestT
  acc.normal[best * 3] += n[0]
  acc.normal[best * 3 + 1] += n[1]
  acc.normal[best * 3 + 2] += n[2]
}

export function rasterize (m: Mannequin, cam: Camera, samples = 4): GBuffer {
  const prims = m.parts.map(part => compile(m, part))
  const count = cam.width * cam.height
  const g: GBuffer = {
    width: cam.width,
    height: cam.height,
    part: new Int16Array(count).fill(EMPTY),
    depth: new Float32Array(count),
    normal: new Float32Array(count * 3),
    coverage: new Float32Array(count)
  }
  const acc: Accumulator = {
    hits: new Float64Array(prims.length),
    depth: new Float64Array(prims.length),
    normal: new Float64Array(prims.length * 3),
    total: 0
  }
  for (let py = 0; py < cam.height; py++) {
    for (let px = 0; px < cam.width; px++) {
      acc.hits.fill(0)
      acc.depth.fill(0)
      acc.normal.fill(0)
      acc.total = 0
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          sample(prims, cam, rayOrigin(cam, px + (sx + 0.5) / samples, py + (sy + 0.5) / samples), acc)
        }
      }
      resolvePixel(g, py * cam.width + px, acc, samples * samples)
    }
  }
  return g
}

function resolvePixel (g: GBuffer, i: number, acc: Accumulator, sampleCount: number): void {
  g.coverage[i] = acc.total / sampleCount
  if (g.coverage[i] < 0.5) return
  let winner = 0
  for (let p = 1; p < acc.hits.length; p++) {
    if (acc.hits[p] > acc.hits[winner]) winner = p
  }
  g.part[i] = winner
  g.depth[i] = acc.depth[winner] / acc.hits[winner]
  g.normal.set(normalize([acc.normal[winner * 3], acc.normal[winner * 3 + 1], acc.normal[winner * 3 + 2]]), i * 3)
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/gbuffer.test.ts`
Expected: PASS, 3 tests.

**Step 5: Commit**

```bash
git add src/raster/gbuffer.ts test/gbuffer.test.ts
git commit -m "Add sphere-traced G-buffer rasterizer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Stylizer

Pipeline order matters: shade, then inner lines, then stray cleanup (so cleanup sees the final shading), then decals
(cleanup must not erase intentional single-pixel features), then the outline last (so it wraps everything).

**Files:**
- Create: [`src/style/stylize.ts`](../../src/style/stylize.ts)
- Test: [`test/stylize.test.ts`](../../test/stylize.test.ts)

**Step 1: Write the failing test**

[`test/stylize.test.ts`](../../test/stylize.test.ts):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stylize } from '../src/style/stylize.ts'
import { EMPTY } from '../src/raster/gbuffer.ts'
import type { GBuffer } from '../src/raster/gbuffer.ts'
import { makeCamera } from '../src/raster/camera.ts'
import { getPixel, TRANSPARENT } from '../src/image.ts'
import type { Mannequin } from '../src/formats/mannequin.ts'
import type { Style } from '../src/formats/style.ts'
import type { Vec3 } from '../src/math/vec.ts'

const DARK = 0x000010
const LIGHT = 0x0000ff
const OUTLINE = 0x101010

const style: Style = {
  name: 'test',
  light: [0, 0, 1],
  bands: [0.5],
  outline: '#101010',
  innerLineDepth: 0.1,
  decalMinFacing: 0.3,
  materials: { m: ['#000010', '#0000ff'] },
  decalColors: { x: '#ff0000' }
}

const mannequin: Mannequin = {
  name: 'm',
  height: 1,
  joints: { o: [0, 0, 0] },
  parts: [{ name: 'p', shape: 'capsule', a: 'o', b: 'o', radiusA: 1, radiusB: 1, material: 'm' }],
  decals: []
}

const camera = makeCamera({ azimuthDeg: 0, elevationDeg: 0, targetHeightPx: 1, modelHeight: 1, margin: 2 })

function block (normal: Vec3): GBuffer {
  const width = 5
  const height = 5
  const g: GBuffer = {
    width,
    height,
    part: new Int16Array(25).fill(EMPTY),
    depth: new Float32Array(25).fill(1),
    normal: new Float32Array(75),
    coverage: new Float32Array(25)
  }
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 3; x++) {
      const i = y * width + x
      g.part[i] = 0
      g.normal.set(normal, i * 3)
    }
  }
  return g
}

test('shades from the light and draws an outline around the silhouette', () => {
  const { image } = stylize(block([0, 0, 1]), mannequin, camera, style)
  assert.equal(getPixel(image, 2, 2), LIGHT)
  assert.equal(getPixel(image, 2, 0), OUTLINE)
  assert.equal(getPixel(image, 0, 0), TRANSPARENT)
})

test('surfaces facing away from the light take the darkest shade', () => {
  const { image } = stylize(block([0, 0, -1]), mannequin, camera, style)
  assert.equal(getPixel(image, 2, 2), DARK)
})

test('replaces an isolated pixel with its surroundings', () => {
  const g = block([0, 0, 1])
  g.normal.set([0, 0, -1], (2 * 5 + 2) * 3)
  const { image } = stylize(g, mannequin, camera, style)
  assert.equal(getPixel(image, 2, 2), LIGHT)
})

test('darkens the farther part where two parts meet at a depth break', () => {
  const g = block([0, 0, 1])
  const two: Mannequin = { ...mannequin, parts: [...mannequin.parts, { ...mannequin.parts[0], name: 'q' }] }
  for (let y = 1; y <= 3; y++) {
    g.part[y * 5 + 3] = 1
    g.depth[y * 5 + 3] = 2
  }
  const { image } = stylize(g, two, camera, style)
  assert.equal(getPixel(image, 3, 2), DARK)
  assert.equal(getPixel(image, 2, 2), LIGHT)
})
```

**Step 2: Run test to verify it fails**

Run: `node --test test/stylize.test.ts`
Expected: FAIL with `Cannot find module`.

**Step 3: Write the implementation**

[`src/style/stylize.ts`](../../src/style/stylize.ts):

```ts
import { createImage, getPixel, neighbours4, neighbours8, parseHex, setPixel, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import type { Mannequin } from '../formats/mannequin.ts'
import type { Style } from '../formats/style.ts'
import { dot, normalize } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import { project } from '../raster/camera.ts'
import type { Camera } from '../raster/camera.ts'
import { EMPTY } from '../raster/gbuffer.ts'
import type { GBuffer } from '../raster/gbuffer.ts'

export type StylizeResult = { image: Image, decalMask: Uint8Array }

// Model units. The decal anchor sits on the surface, so a surface closer than this means something covers it.
const DECAL_OCCLUSION = 0.05

export function stylize (g: GBuffer, m: Mannequin, cam: Camera, style: Style): StylizeResult {
  const shaded = createImage(g.width, g.height)
  shade(shaded, g, m, style)
  drawInnerLines(shaded, g, m, style)
  const image = removeStrays(shaded)
  const decalMask = drawDecals(image, g, m, cam, style)
  drawOutline(image, parseHex(style.outline))
  return { image, decalMask }
}

function rampOf (g: GBuffer, m: Mannequin, style: Style, i: number): string[] {
  return style.materials[m.parts[g.part[i]].material]
}

function shade (image: Image, g: GBuffer, m: Mannequin, style: Style): void {
  const light = normalize(style.light)
  for (let i = 0; i < g.part.length; i++) {
    if (g.part[i] === EMPTY) continue
    const n: Vec3 = [g.normal[i * 3], g.normal[i * 3 + 1], g.normal[i * 3 + 2]]
    const brightness = dot(n, light)
    const shadeIndex = style.bands.filter(t => brightness >= t).length
    setPixel(image, i % g.width, Math.floor(i / g.width), parseHex(rampOf(g, m, style, i)[shadeIndex]))
  }
}

function drawInnerLines (image: Image, g: GBuffer, m: Mannequin, style: Style): void {
  const marks: number[] = []
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const i = y * g.width + x
      if (g.part[i] === EMPTY) continue
      const right = x + 1 < g.width ? i + 1 : -1
      const below = y + 1 < g.height ? i + g.width : -1
      for (const j of [right, below]) {
        if (j === -1 || g.part[j] === EMPTY || g.part[j] === g.part[i]) continue
        if (Math.abs(g.depth[i] - g.depth[j]) <= style.innerLineDepth) continue
        marks.push(g.depth[i] > g.depth[j] ? i : j)
      }
    }
  }
  for (const i of marks) {
    setPixel(image, i % g.width, Math.floor(i / g.width), parseHex(rampOf(g, m, style, i)[0]))
  }
}

function mostCommon (values: number[]): number {
  const counts = new Map<number, number>()
  let best = values[0]
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1
    counts.set(v, n)
    if (n > (counts.get(best) ?? 0)) best = v
  }
  return best
}

function removeStrays (image: Image): Image {
  const out: Image = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) }
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const c = getPixel(image, x, y)
      if (c === TRANSPARENT) continue
      const around = neighbours8(image, x, y).filter(n => n !== TRANSPARENT)
      if (around.length === 0 || around.includes(c)) continue
      setPixel(out, x, y, mostCommon(around))
    }
  }
  return out
}

function drawDecals (image: Image, g: GBuffer, m: Mannequin, cam: Camera, style: Style): Uint8Array {
  const mask = new Uint8Array(g.width * g.height)
  for (const decal of m.decals) {
    if (-dot(normalize(decal.normal), cam.forward) < style.decalMinFacing) continue
    const p = project(cam, m.joints[decal.anchor])
    const cx = Math.floor(p.x)
    const cy = Math.floor(p.y)
    if (cx < 0 || cy < 0 || cx >= g.width || cy >= g.height) continue
    const centre = cy * g.width + cx
    if (g.part[centre] === EMPTY || g.depth[centre] < p.depth - DECAL_OCCLUSION) continue
    const ox = cx - Math.floor(decal.pattern[0].length / 2)
    const oy = cy - Math.floor(decal.pattern.length / 2)
    decal.pattern.forEach((row, dy) => {
      [...row].forEach((ch, dx) => {
        const x = ox + dx
        const y = oy + dy
        if (ch === '.' || x < 0 || y < 0 || x >= g.width || y >= g.height) return
        if (g.part[y * g.width + x] === EMPTY) return
        setPixel(image, x, y, parseHex(style.decalColors[ch]))
        mask[y * g.width + x] = 1
      })
    })
  }
  return mask
}

function drawOutline (image: Image, colour: number): void {
  const edge: Array<[number, number]> = []
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (getPixel(image, x, y) !== TRANSPARENT) continue
      if (neighbours4(image, x, y).some(n => n !== TRANSPARENT)) edge.push([x, y])
    }
  }
  for (const [x, y] of edge) setPixel(image, x, y, colour)
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/stylize.test.ts`
Expected: PASS, 4 tests.

**Step 5: Commit**

```bash
git add src/style test/stylize.test.ts
git commit -m "Add pixel-art stylizer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: P1 metrics

**Files:**
- Create: [`src/diagnostics/metrics.ts`](../../src/diagnostics/metrics.ts)
- Test: [`test/metrics.test.ts`](../../test/metrics.test.ts)

**Step 1: Write the failing test**

[`test/metrics.test.ts`](../../test/metrics.test.ts):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { outlineGaps, paletteSize, strayPixels, thinParts } from '../src/diagnostics/metrics.ts'
import { createImage, setPixel } from '../src/image.ts'
import { EMPTY } from '../src/raster/gbuffer.ts'
import type { GBuffer } from '../src/raster/gbuffer.ts'
import type { Mannequin } from '../src/formats/mannequin.ts'

const OUTLINE = 0x101010

test('outline gaps count fill pixels touching transparency or the edge', () => {
  const img = createImage(3, 3)
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) setPixel(img, x, y, OUTLINE)
  setPixel(img, 1, 1, 0xff0000)
  assert.equal(outlineGaps(img, OUTLINE), 0)
  setPixel(img, 1, 0, 0xff0000)
  assert.equal(outlineGaps(img, OUTLINE), 1)
})

test('stray pixels have no same-coloured neighbour, unless masked', () => {
  const img = createImage(3, 3)
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) setPixel(img, x, y, 0x00ff00)
  setPixel(img, 1, 1, 0xff0000)
  assert.equal(strayPixels(img, new Uint8Array(9)), 1)
  const mask = new Uint8Array(9)
  mask[4] = 1
  assert.equal(strayPixels(img, mask), 0)
})

test('palette size counts distinct opaque colours across images', () => {
  const a = createImage(2, 1)
  setPixel(a, 0, 0, 1)
  setPixel(a, 1, 0, 2)
  const b = createImage(1, 1)
  setPixel(b, 0, 0, 2)
  assert.equal(paletteSize([a, b]), 2)
})

test('thin parts are one pixel across in either direction', () => {
  const width = 6
  const g: GBuffer = {
    width,
    height: 4,
    part: new Int16Array(24).fill(EMPTY),
    depth: new Float32Array(24),
    normal: new Float32Array(72),
    coverage: new Float32Array(24)
  }
  for (let y = 0; y < 3; y++) {
    g.part[y * width] = 0
    g.part[y * width + 1] = 0
    g.part[y * width + 4] = 1
  }
  const part = { shape: 'capsule' as const, a: 'o', b: 'o', radiusA: 1, radiusB: 1, material: 'm' }
  const m: Mannequin = {
    name: 'm',
    height: 1,
    joints: { o: [0, 0, 0] },
    parts: [{ ...part, name: 'wide' }, { ...part, name: 'thin' }, { ...part, name: 'sword', allowThin: true }],
    decals: []
  }
  assert.deepEqual(thinParts(g, m), [
    { part: 'wide', pixels: 6, thinFraction: 0 },
    { part: 'thin', pixels: 3, thinFraction: 1 }
  ])
})
```

**Step 2: Run test to verify it fails**

Run: `node --test test/metrics.test.ts`
Expected: FAIL with `Cannot find module`.

**Step 3: Write the implementation**

[`src/diagnostics/metrics.ts`](../../src/diagnostics/metrics.ts):

```ts
import { getPixel, neighbours4, neighbours8, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import type { Mannequin } from '../formats/mannequin.ts'
import { EMPTY } from '../raster/gbuffer.ts'
import type { GBuffer } from '../raster/gbuffer.ts'

export type ThinPart = { part: string, pixels: number, thinFraction: number }

export function outlineGaps (img: Image, outline: number): number {
  let gaps = 0
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const c = getPixel(img, x, y)
      if (c === TRANSPARENT || c === outline) continue
      if (neighbours4(img, x, y).includes(TRANSPARENT)) gaps++
    }
  }
  return gaps
}

export function strayPixels (img: Image, exclude: Uint8Array): number {
  let strays = 0
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const c = getPixel(img, x, y)
      if (c === TRANSPARENT || exclude[y * img.width + x] === 1) continue
      if (!neighbours8(img, x, y).includes(c)) strays++
    }
  }
  return strays
}

export function paletteSize (images: Image[]): number {
  const colours = new Set<number>()
  for (const img of images) {
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const c = getPixel(img, x, y)
        if (c !== TRANSPARENT) colours.add(c)
      }
    }
  }
  return colours.size
}

export function thinParts (g: GBuffer, m: Mannequin): ThinPart[] {
  const pixels = new Array<number>(m.parts.length).fill(0)
  const thin = new Array<number>(m.parts.length).fill(0)
  const partAt = (x: number, y: number) => (x < 0 || y < 0 || x >= g.width || y >= g.height)
    ? EMPTY
    : g.part[y * g.width + x]
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const p = partAt(x, y)
      if (p === EMPTY) continue
      pixels[p]++
      const narrowAcross = partAt(x - 1, y) !== p && partAt(x + 1, y) !== p
      const narrowDown = partAt(x, y - 1) !== p && partAt(x, y + 1) !== p
      if (narrowAcross || narrowDown) thin[p]++
    }
  }
  return m.parts
    .map((part, i) => ({ part: part.name, pixels: pixels[i], thinFraction: pixels[i] === 0 ? 0 : thin[i] / pixels[i] }))
    .filter((_, i) => m.parts[i].allowThin !== true)
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/metrics.test.ts`
Expected: PASS, 4 tests.

**Step 5: Commit**

```bash
git add src/diagnostics/metrics.ts test/metrics.test.ts
git commit -m "Add P1 pixel metrics" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Debug images and report helpers

**Files:**
- Create: [`src/diagnostics/images.ts`](../../src/diagnostics/images.ts), [`src/diagnostics/report.ts`](../../src/diagnostics/report.ts)
- Test: [`test/report.test.ts`](../../test/report.test.ts)

**Step 1: Write the failing test**

[`test/report.test.ts`](../../test/report.test.ts):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluate, summarize } from '../src/diagnostics/report.ts'
import { sheet } from '../src/diagnostics/images.ts'
import { createImage, getPixel, setPixel } from '../src/image.ts'

test('evaluate applies each gate operator', () => {
  const results = evaluate([
    { name: 'a', value: 1, op: '<=', threshold: 1, rationale: '' },
    { name: 'b', value: 1, op: '>=', threshold: 2, rationale: '' }
  ])
  assert.deepEqual(results.map(r => r.pass), [true, false])
})

test('summary lists every gate and the overall verdict', () => {
  const text = summarize('P1', evaluate([{ name: 'gaps', value: 0.5, op: '<=', threshold: 0, rationale: '' }]))
  assert.match(text, /FAIL {2}gaps: 0\.500 <= 0/)
  assert.match(text, /automated gates: FAIL$/)
})

test('sheet upscales cells onto a background grid', () => {
  const cell = createImage(1, 1)
  setPixel(cell, 0, 0, 0xff0000)
  const out = sheet([[cell, cell]], { scale: 2, gap: 1, background: 0x000000 })
  assert.equal(out.width, 2 * 2 + 3)
  assert.equal(out.height, 2 + 2)
  assert.equal(getPixel(out, 0, 0), 0x000000)
  assert.equal(getPixel(out, 1, 1), 0xff0000)
  assert.equal(getPixel(out, 2, 2), 0xff0000)
  assert.equal(getPixel(out, 4, 1), 0xff0000)
})
```

**Step 2: Run test to verify it fails**

Run: `node --test test/report.test.ts`
Expected: FAIL with `Cannot find module`.

**Step 3: Write the implementation**

[`src/diagnostics/report.ts`](../../src/diagnostics/report.ts):

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type Gate = { name: string, value: number, op: '<=' | '>=', threshold: number, rationale: string }

export type GateResult = Gate & { pass: boolean }

export function evaluate (gates: Gate[]): GateResult[] {
  return gates.map(g => ({ ...g, pass: g.op === '<=' ? g.value <= g.threshold : g.value >= g.threshold }))
}

function formatNumber (v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(3)
}

export function summarize (title: string, results: GateResult[]): string {
  const lines = results.map(r => {
    return `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}: ${formatNumber(r.value)} ${r.op} ${r.threshold}`
  })
  const verdict = results.every(r => r.pass) ? 'PASS' : 'FAIL'
  return [title, ...lines, `automated gates: ${verdict}`].join('\n')
}

export function writeOutput (path: string, contents: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}
```

[`src/diagnostics/images.ts`](../../src/diagnostics/images.ts):

```ts
import { createImage, getPixel, setPixel, TRANSPARENT } from '../image.ts'
import type { Image } from '../image.ts'
import { EMPTY } from '../raster/gbuffer.ts'
import type { GBuffer } from '../raster/gbuffer.ts'

const PART_COLOURS = [
  0xe6194b, 0x3cb44b, 0xffe119, 0x4363d8, 0xf58231, 0x911eb4, 0x46f0f0, 0xf032e6,
  0xbcf60c, 0xfabebe, 0x008080, 0xe6beff, 0x9a6324, 0x800000, 0xaaffc3, 0x808000
]

export type SheetOptions = { scale: number, gap: number, background: number }

export function sheet (rows: Image[][], options: SheetOptions): Image {
  const { scale, gap, background } = options
  const cells = rows.flat()
  const cellWidth = Math.max(...cells.map(c => c.width)) * scale
  const cellHeight = Math.max(...cells.map(c => c.height)) * scale
  const cols = Math.max(...rows.map(r => r.length))
  const out = createImage(cols * cellWidth + (cols + 1) * gap, rows.length * cellHeight + (rows.length + 1) * gap)
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) setPixel(out, x, y, background)
  }
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      const ox = gap + c * (cellWidth + gap)
      const oy = gap + r * (cellHeight + gap)
      for (let y = 0; y < cell.height * scale; y++) {
        for (let x = 0; x < cell.width * scale; x++) {
          const rgb = getPixel(cell, Math.floor(x / scale), Math.floor(y / scale))
          if (rgb !== TRANSPARENT) setPixel(out, ox + x, oy + y, rgb)
        }
      }
    })
  })
  return out
}

function fromGBuffer (g: GBuffer, colour: (i: number) => number): Image {
  const out = createImage(g.width, g.height)
  for (let i = 0; i < g.part.length; i++) {
    if (g.part[i] !== EMPTY) setPixel(out, i % g.width, Math.floor(i / g.width), colour(i))
  }
  return out
}

export function partImage (g: GBuffer): Image {
  return fromGBuffer(g, i => PART_COLOURS[g.part[i] % PART_COLOURS.length])
}

export function normalImage (g: GBuffer): Image {
  const channel = (v: number) => Math.round((v * 0.5 + 0.5) * 255)
  return fromGBuffer(g, i => {
    return (channel(g.normal[i * 3]) << 16) | (channel(g.normal[i * 3 + 1]) << 8) | channel(g.normal[i * 3 + 2])
  })
}

export function depthImage (g: GBuffer): Image {
  let near = Infinity
  let far = -Infinity
  for (let i = 0; i < g.part.length; i++) {
    if (g.part[i] === EMPTY) continue
    near = Math.min(near, g.depth[i])
    far = Math.max(far, g.depth[i])
  }
  const span = far - near || 1
  return fromGBuffer(g, i => {
    const v = Math.round(255 - ((g.depth[i] - near) / span) * 200)
    return (v << 16) | (v << 8) | v
  })
}
```

**Step 4: Run all tests and type-check**

Run: `npm test && npm run typecheck`
Expected: all tests PASS; typecheck clean.

**Step 5: Commit**

```bash
git add src/diagnostics test/report.test.ts
git commit -m "Add gate evaluation, contact sheets and debug passes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: P1 assets and gates

The knight is deliberately chunky (big head, thick limbs): 32px characters are usually 3 to 4 heads tall, and limbs
need about 3px of width to survive. Model units are metres; +X is the character's left.

**Files:**
- Create: [`pocs/p1-static-style/knight.json`](../../pocs/p1-static-style/knight.json), [`pocs/p1-static-style/style.json`](../../pocs/p1-static-style/style.json), [`pocs/p1-static-style/gates.ts`](../../pocs/p1-static-style/gates.ts)

**Step 1: Create `knight.json`**

```json
{
  "name": "knight",
  "height": 1.8,
  "joints": {
    "hipsBottom": [0, 0.66, 0],
    "pelvis": [0, 0.82, 0],
    "chest": [0, 1.22, 0],
    "head": [0, 1.5, 0],
    "visor": [0, 1.52, 0.27],
    "capeTop": [0, 1.2, -0.18],
    "capeHem": [0, 0.35, -0.3],
    "hipL": [0.13, 0.8, 0],
    "kneeL": [0.13, 0.44, 0.01],
    "ankleL": [0.13, 0.1, 0],
    "toeL": [0.13, 0.06, 0.16],
    "hipR": [-0.13, 0.8, 0],
    "kneeR": [-0.13, 0.44, 0.01],
    "ankleR": [-0.13, 0.1, 0],
    "toeR": [-0.13, 0.06, 0.16],
    "shoulderL": [0.33, 1.18, 0],
    "elbowL": [0.37, 0.94, 0],
    "wristL": [0.38, 0.72, 0.02],
    "handL": [0.38, 0.66, 0.03],
    "shoulderR": [-0.33, 1.18, 0],
    "elbowR": [-0.37, 0.94, 0],
    "wristR": [-0.38, 0.72, 0.02],
    "handR": [-0.38, 0.66, 0.03],
    "swordTip": [-0.42, 0.12, 0.42]
  },
  "parts": [
    { "name": "helmet", "shape": "capsule", "a": "head", "b": "head", "radiusA": 0.27, "radiusB": 0.27, "material": "steel" },
    {
      "name": "torso", "shape": "box", "a": "pelvis", "b": "chest",
      "width": 0.52, "thickness": 0.32, "rounding": 0.1, "widthAxis": [1, 0, 0], "material": "steel"
    },
    {
      "name": "hips", "shape": "box", "a": "hipsBottom", "b": "pelvis",
      "width": 0.44, "thickness": 0.28, "rounding": 0.08, "widthAxis": [1, 0, 0], "material": "leather"
    },
    {
      "name": "cape", "shape": "box", "a": "capeTop", "b": "capeHem",
      "width": 0.58, "thickness": 0.06, "rounding": 0.025, "widthAxis": [1, 0, 0], "material": "cloth-red"
    },
    { "name": "thighL", "shape": "capsule", "a": "hipL", "b": "kneeL", "radiusA": 0.11, "radiusB": 0.1, "material": "steel-dark" },
    { "name": "shinL", "shape": "capsule", "a": "kneeL", "b": "ankleL", "radiusA": 0.1, "radiusB": 0.085, "material": "steel-dark" },
    { "name": "footL", "shape": "capsule", "a": "ankleL", "b": "toeL", "radiusA": 0.075, "radiusB": 0.065, "material": "leather" },
    { "name": "thighR", "shape": "capsule", "a": "hipR", "b": "kneeR", "radiusA": 0.11, "radiusB": 0.1, "material": "steel-dark" },
    { "name": "shinR", "shape": "capsule", "a": "kneeR", "b": "ankleR", "radiusA": 0.1, "radiusB": 0.085, "material": "steel-dark" },
    { "name": "footR", "shape": "capsule", "a": "ankleR", "b": "toeR", "radiusA": 0.075, "radiusB": 0.065, "material": "leather" },
    { "name": "pauldronL", "shape": "capsule", "a": "shoulderL", "b": "shoulderL", "radiusA": 0.13, "radiusB": 0.13, "material": "steel" },
    { "name": "upperArmL", "shape": "capsule", "a": "shoulderL", "b": "elbowL", "radiusA": 0.095, "radiusB": 0.085, "material": "steel-dark" },
    { "name": "forearmL", "shape": "capsule", "a": "elbowL", "b": "wristL", "radiusA": 0.085, "radiusB": 0.075, "material": "steel-dark" },
    { "name": "handL", "shape": "capsule", "a": "handL", "b": "handL", "radiusA": 0.085, "radiusB": 0.085, "material": "leather" },
    { "name": "pauldronR", "shape": "capsule", "a": "shoulderR", "b": "shoulderR", "radiusA": 0.13, "radiusB": 0.13, "material": "steel" },
    { "name": "upperArmR", "shape": "capsule", "a": "shoulderR", "b": "elbowR", "radiusA": 0.095, "radiusB": 0.085, "material": "steel-dark" },
    { "name": "forearmR", "shape": "capsule", "a": "elbowR", "b": "wristR", "radiusA": 0.085, "radiusB": 0.075, "material": "steel-dark" },
    { "name": "handR", "shape": "capsule", "a": "handR", "b": "handR", "radiusA": 0.085, "radiusB": 0.085, "material": "leather" },
    {
      "name": "sword", "shape": "capsule", "a": "handR", "b": "swordTip",
      "radiusA": 0.035, "radiusB": 0.03, "material": "blade", "allowThin": true
    }
  ],
  "decals": [
    { "name": "visor", "anchor": "visor", "normal": [0, 0, 1], "pattern": ["xxx"] }
  ]
}
```

**Step 2: Create `style.json`**

Three shades per material keeps the palette at 5 ramps x 3 + 1 outline = 16 colours, exactly the P1 limit. The light
is in camera space, from the upper left and slightly in front.

```json
{
  "name": "default",
  "light": [-0.5, 0.7, 0.5],
  "bands": [0.05, 0.6],
  "outline": "#1b1421",
  "innerLineDepth": 0.12,
  "decalMinFacing": 0.3,
  "materials": {
    "steel": ["#4a5368", "#8492ad", "#d0dbea"],
    "steel-dark": ["#2b3040", "#4f5870", "#7d89a3"],
    "leather": ["#3d2618", "#70452b", "#a8734a"],
    "cloth-red": ["#4f1622", "#8e2a35", "#d0554e"],
    "blade": ["#6a788c", "#b4c3d3", "#f2f7fb"]
  },
  "decalColors": { "x": "#1b1421" }
}
```

**Step 3: Create `gates.ts`**

Thresholds come from the design doc. They are locked for P1: tuning during iteration changes the assets and the
renderer, never these numbers. Changing a threshold needs a recorded reason in the findings log (Task 13).

```ts
import type { Gate } from '../../src/diagnostics/report.ts'

export const P1_GATES = {
  outlineGaps: {
    op: '<=',
    threshold: 0,
    rationale: 'The outline is closed by construction; a gap means the silhouette was clipped at the frame edge.'
  },
  maxThinFraction: {
    op: '<=',
    threshold: 0.25,
    rationale: 'Parts mostly 1px thick vanish or flicker at 32px; a quarter allows tapered ends. Occlusion is ignored.'
  },
  paletteSize: {
    op: '<=',
    threshold: 16,
    rationale: 'A common budget for 32-64px characters; more colours start to read as a downscaled render.'
  },
  maxStrayPixels: {
    op: '<=',
    threshold: 2,
    rationale: 'Isolated pixels read as noise. Decal pixels are excluded because single-pixel features are intended.'
  },
  nondeterministicFrames: {
    op: '<=',
    threshold: 0,
    rationale: 'Design requirement R9: identical inputs must produce identical bytes.'
  }
} as const

export function gate (name: keyof typeof P1_GATES, value: number): Gate {
  return { name, value, ...P1_GATES[name] }
}
```

**Step 4: Validate the assets**

There is no runner yet, so check the assets from a test:

[`test/p1-assets.test.ts`](../../test/p1-assets.test.ts):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateMannequin } from '../src/formats/mannequin.ts'
import { validateStyle } from '../src/formats/style.ts'
import { checkReferences } from '../src/formats/references.ts'

function load (file: string): unknown {
  return JSON.parse(readFileSync(new URL(`../pocs/p1-static-style/${file}`, import.meta.url), 'utf8'))
}

test('P1 assets are valid and consistent', () => {
  const mannequin = validateMannequin(load('knight.json'))
  const style = validateStyle(load('style.json'))
  assert.deepEqual(mannequin.errors, [])
  assert.deepEqual(style.errors, [])
  if (mannequin.value === undefined || style.value === undefined) return
  assert.deepEqual(checkReferences(mannequin.value, style.value), [])
})
```

Run: `node --test test/p1-assets.test.ts`
Expected: PASS. Include the test file in the commit below.

**Step 5: Commit**

```bash
git add pocs/p1-static-style test/p1-assets.test.ts
git commit -m "Add P1 knight mannequin, default style and gates" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: P1 runner and preview

**Files:**
- Create: [`pocs/p1-static-style/preview.ts`](../../pocs/p1-static-style/preview.ts), [`pocs/p1-static-style/run.ts`](../../pocs/p1-static-style/run.ts), [`refs/README.md`](../../refs/README.md)

**Step 1: Create `preview.ts`**

```ts
export type AbPair = { left: string, right: string }

function escapeHtml (text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function abSection (pairs: AbPair[]): string {
  if (pairs.length === 0) {
    return '<p>No reference sprites in <code>refs/p1/</code> yet. See <code>refs/README.md</code>.</p>'
  }
  return pairs.map((p, i) => `<figure>
<figcaption>Pair ${i + 1}: which looks more hand-made? Left, right, or can't tell?</figcaption>
<img class="px" src="${p.left}"><img class="px" src="${p.right}">
</figure>`).join('\n')
}

export function previewHtml (summary: string, pairs: AbPair[]): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>P1 static style</title>
<style>
body { font-family: system-ui, sans-serif; margin: 24px; background: #f4f4f4; color: #222; }
img { image-rendering: pixelated; display: block; margin: 8px 0; max-width: 100%; }
img.px { display: inline-block; margin-right: 32px; background: #c8c8c8; }
pre { background: #fff; padding: 12px; }
</style>
</head>
<body>
<h1>P1 static style</h1>
<pre>${escapeHtml(summary)}</pre>
<h2>Checklist</h2>
<ol>
<li>For each column of the contact sheet, write which way the character faces (front, front-left, left, back-left,
back, back-right, right, front-right). Compare with <code>facing</code> in <code>ab-key.json</code> afterwards.</li>
<li>In the 32px rows, can you point to the head, torso, arms, legs, cape and sword?</li>
<li>Answer each A/B pair below before opening <code>ab-key.json</code>.</li>
</ol>
<h2>Contact sheet</h2>
<p>Rows: 32px side, 32px 3/4, 48px side, 48px 3/4. Columns: 8 directions, 45 degrees apart.</p>
<img src="sheet.png">
<h2>Debug passes</h2>
<img src="debug-parts.png">
<img src="debug-normals.png">
<img src="debug-depth.png">
<h2>A/B</h2>
${abSection(pairs)}
<script>
for (const img of document.querySelectorAll('img.px')) {
  const grow = () => { img.width = img.naturalWidth * 8 }
  if (img.complete) grow()
  else img.addEventListener('load', grow)
}
</script>
</body>
</html>
`
}
```

**Step 2: Create `run.ts`**

```ts
import { createHash } from 'node:crypto'
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
import { previewHtml } from './preview.ts'
import type { AbPair } from './preview.ts'

const SIZES = [32, 48]
const ELEVATIONS = [0, 30]
const DIRECTIONS = 8
const MARGIN = 4
const SHEET_SCALE = 8
const SHEET_BACKGROUND = 0xc8c8c8
const MIN_PIXELS_FOR_THIN = 4
const AB_FRAME = '48px-el30-d1'
const FACING = ['front', 'front-left', 'left', 'back-left', 'back', 'back-right', 'right', 'front-right']

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const outDir = join(root, 'reports', 'p1')
const refsDir = join(root, 'refs', 'p1')

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
    console.error(formatErrors(file, result.errors))
    process.exit(2)
  }
  return result.value
}

function loadJson (file: string): unknown {
  return JSON.parse(readFileSync(join(here, file), 'utf8'))
}

const mannequin = requireValid('knight.json', validateMannequin(loadJson('knight.json')))
const style = requireValid('style.json', validateStyle(loadJson('style.json')))
const referenceErrors = checkReferences(mannequin, style)
if (referenceErrors.length > 0) {
  console.error(formatErrors('knight.json', referenceErrors))
  process.exit(2)
}

function renderFrame (size: number, elevation: number, direction: number): Frame {
  const camera = fitCamera(mannequin, {
    azimuthDeg: direction * 45,
    elevationDeg: elevation,
    targetHeightPx: size,
    margin: MARGIN
  })
  const gbuffer = rasterize(mannequin, camera)
  const { image, decalMask } = stylize(gbuffer, mannequin, camera, style)
  return { id: `${size}px-el${elevation}-d${direction}`, size, elevation, direction, camera, gbuffer, image, decalMask }
}

const frames = SIZES.flatMap(size => ELEVATIONS.flatMap(elevation => {
  return Array.from({ length: DIRECTIONS }, (_, direction) => renderFrame(size, elevation, direction))
}))
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

const nondeterministic = [frames[0], frames[frames.length - 1]].filter(f => {
  return imageHash(renderFrame(f.size, f.elevation, f.direction).image) !== imageHash(f.image)
}).length

const results = evaluate([
  gate('outlineGaps', Math.max(...frameMetrics.map(m => m.outlineGaps))),
  gate('maxThinFraction', Math.max(...frameMetrics.map(m => m.maxThinFraction))),
  gate('paletteSize', paletteSize(frames.map(f => f.image))),
  gate('maxStrayPixels', Math.max(...frameMetrics.map(m => m.strayPixels))),
  gate('nondeterministicFrames', nondeterministic)
])
const summary = summarize('P1 static style', results)

function abPairs (): { pairs: AbPair[], key: Array<{ ref: string, ours: 'left' | 'right' }> } {
  const refs = existsSync(refsDir) ? readdirSync(refsDir).filter(f => f.endsWith('.png')).sort() : []
  const ours = `frames/${AB_FRAME}.png`
  const key = refs.map(ref => {
    const side: 'left' | 'right' = createHash('sha256').update(ref).digest()[0] % 2 === 0 ? 'left' : 'right'
    return { ref, ours: side }
  })
  const pairs = key.map(({ ref, ours: side }) => {
    const theirs = `../../refs/p1/${ref}`
    return side === 'left' ? { left: ours, right: theirs } : { left: theirs, right: ours }
  })
  return { pairs, key }
}

rmSync(outDir, { recursive: true, force: true })
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
```

Check line length with `grep -n '.\{121,\}' src/**/*.ts pocs/**/*.ts test/*.ts` (expected: no output). The
knight's one-line part entries in `knight.json` are allowed to run longer; JSON is data, and one part per line keeps
diffs readable.

Exit codes: 0 when all automated gates pass, 1 when any fails, 2 on invalid input. The AI loop relies on these.

**Step 3: Create [`refs/README.md`](../../refs/README.md)**

```markdown
# Reference sprites

Hand-made sprites used for A/B comparisons. Each PoC reads its own folder, for example `refs/p1/`.

Criteria for `refs/p1/`:

- Licence CC0 or CC-BY, recorded in `refs/LICENSES.md` (file, source URL, author, licence).
- A single frame, PNG with a transparent background, character 32-64px tall.
- Standing pose, side or 3/4 view, ideally an armoured human.
- Cropped from sheets without scaling. Never resize pixel art.

Good sources: OpenGameArt (filter by CC0), Kenney assets (CC0), itch.io assets marked CC0.
```

**Step 4: Run P1**

Run: `npm run p1`
Expected: a summary listing five gates, `report: .../reports/p1/preview.html`, and exit code 0 or 1. Exit code 2 means
an asset error: fix the asset, not the validator. Rendering should take seconds, not minutes. If it takes over a
minute, measure before optimising (bounding-sphere misses or step count are the likely costs).

**Step 5: Type-check, run all tests, commit**

```bash
npm run typecheck && npm test
git add pocs/p1-static-style refs/README.md
git commit -m "Add P1 runner with report and A/B preview" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Iterate P1 to a reviewable state

This is the iteration loop from the design: metrics first, then Claude's review of the still images.

**Files:**
- Create: [`docs/plans/p1-findings.md`](p1-findings.md)
- Modify (as needed): [`pocs/p1-static-style/knight.json`](../../pocs/p1-static-style/knight.json), [`pocs/p1-static-style/style.json`](../../pocs/p1-static-style/style.json), [`src/style/stylize.ts`](../../src/style/stylize.ts),
  [`src/raster/gbuffer.ts`](../../src/raster/gbuffer.ts)

**Step 1: Review the first run**

Read `reports/p1/sheet.png`, `debug-parts.png`, `debug-normals.png` and `debug-depth.png` with the Read tool. For each,
note concrete issues with frame IDs, for example "32px-el0-d2: far arm is a 1px sliver behind torso".

**Step 2: Log the iteration**

Start [`docs/plans/p1-findings.md`](p1-findings.md) with one entry per run:

```markdown
## Run N

- Change: what was changed and why (one or two lines)
- Gates: outlineGaps 0, maxThinFraction 0.31 (FAIL), paletteSize 16, maxStrayPixels 1, nondeterministic 0
- Observed: the issues from the images
```

**Step 3: Change one thing, rerun, compare**

Allowed changes: mannequin proportions, style ramps, bands and light, and stylizer rules. For example, drop occluded
slivers below 2px, or snap the sword to a clean diagonal. Gate thresholds are not allowed changes. Rerun with
`npm run p1`, review again, and log. Commit after each change that improves things, with a subject such as
`Thicken knight forearms for 32px readability`.

**Step 4: Stop condition**

Stop when every automated gate passes and Claude's image review finds no issue a viewer would notice, or after 10
runs. If the gates still fail after 10 runs, record the failure and apply the fallback from the design (raise the bar
to 48px, or try per-part skins) as a separate, explicit decision with the user.

**Step 5: Commit the findings log**

```bash
git add docs/plans/p1-findings.md
git commit -m "Record P1 iteration findings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Reference sprites (user or agent with web access)

**Step 1:** Find 3 to 5 sprites matching [`refs/README.md`](../../refs/README.md). Verify each licence on its source page; do not rely on a
listing summary.

**Step 2:** Crop single frames without scaling, save them as `refs/p1/<name>.png`, and record each in
[`refs/LICENSES.md`](../../refs/LICENSES.md).

**Step 3:** Run `npm run p1` and confirm the A/B section of `reports/p1/preview.html` shows one pair per reference.

**Step 4: Commit**

```bash
git add refs
git commit -m "Add P1 reference sprites" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: P1 review checkpoint (human)

**Step 1:** The user goes through the checklist in `reports/p1/preview.html` without opening `ab-key.json` first,
then checks the answers against it.

**Step 2:** Send the same page (contact sheet plus A/B pairs, with the key removed) to 3 to 5 outside reviewers,
including at least one pixel artist (Lospec or r/PixelArt).

**Step 3:** Record the answers in [`docs/plans/p1-findings.md`](p1-findings.md) under `## Review`. P1 passes when the automated gates
pass, facing is identified correctly for at least 7 of 8 directions, parts are identifiable at 32px, and the A/B
answers are mostly "can't tell" or split. Otherwise apply the fallback from the design.
