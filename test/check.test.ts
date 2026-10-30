import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ok = new URL('./fixtures/character-ok', import.meta.url).pathname
const dog = new URL('../examples/dog', import.meta.url).pathname
const invalid = new URL('./fixtures/character-invalid', import.meta.url).pathname
const cli = new URL('../src/cli/check.ts', import.meta.url).pathname

const scratch: string[] = []

after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

function tmp (prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  scratch.push(dir)
  return dir
}

type Run = { status: number | null, stdout: string, stderr: string, out: string }

function check (dir: string, out = tmp('pinata-report-')): Run {
  const run = spawnSync(process.execPath, [cli, dir, '--out', out], { encoding: 'utf8' })
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, out }
}

function variant (edit: (dir: string) => void, source = ok): string {
  const dir = tmp('pinata-character-')
  cpSync(source, dir, { recursive: true })
  edit(dir)
  return dir
}

function patch (dir: string, file: string, change: (json: any) => void): void {
  const json = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  change(json)
  writeFileSync(join(dir, file), JSON.stringify(json))
}

test('a valid character passes every gate and writes the summary and stills', () => {
  const run = check(ok)
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const summary = readFileSync(join(run.out, 'summary.txt'), 'utf8')
  assert.match(summary, /^PASS {2}footSlidePx: /m)
  assert.match(summary, /^PASS {2}maxStrain: /m)
  assert.match(summary, /automated gates: PASS/)
  for (const file of ['sheet.png', 'walk.png', 'footprints.png', 'cloth.png', 'metrics.json']) {
    assert.ok(existsSync(join(run.out, file)), file)
  }
})

test('an invalid package exits 2 and lists every error with its file name', () => {
  const run = check(invalid)
  assert.equal(run.status, 2)
  assert.match(run.stderr, /^mannequin\.json: parts\[0\]\.radiusA: /m)
  assert.match(run.stderr, /^motion\.json: name: unknown field/m)
  assert.match(run.stderr, /^motion\.json: fps: /m)
  assert.match(readFileSync(join(run.out, 'summary.txt'), 'utf8'), /automated gates: ERROR/)
})

test('a missing directory and missing arguments exit 2', () => {
  assert.equal(check('/nonexistent/character').status, 2)
  assert.equal(spawnSync(process.execPath, [cli], { encoding: 'utf8' }).status, 2)
})

test('a thin part fails maxThinFraction with a hint naming the part and the width to use', () => {
  const dir = variant(d => {
    patch(d, 'mannequin.json', j => {
      for (const part of j.parts) if (part.name === 'forearmL') Object.assign(part, { radiusA: 0.012, radiusB: 0.012 })
    })
  })
  const run = check(dir)
  assert.equal(run.status, 1, run.stdout + run.stderr)
  const summary = readFileSync(join(run.out, 'summary.txt'), 'utf8')
  assert.match(summary, /^FAIL {2}maxThinFraction: /m)
  assert.match(summary, /hint: thin parts at \d+px.*'forearmL'.* is 0\.024 m across and needs at least 0\.075 m/)
  assert.match(summary, /\(2 px at 32 px\)/)
  assert.match(summary, /allowThin/)
})

test('a window with too few plants makes rootSpeedError non-finite and the hint says why', () => {
  const dir = variant(d => {
    patch(d, 'motion.json', j => { j.script.segments[0].duration = 0.8 })
  })
  const run = check(dir)
  const summary = readFileSync(join(run.out, 'summary.txt'), 'utf8')
  assert.match(summary, /^FAIL {2}rootSpeedError: Infinity /m)
  assert.match(summary, /hint: the metric is not finite.*neither foot has two plants.*longer/)
})

test('a character without cloth skips the cloth gates and the cloth still', () => {
  const dir = variant(d => { patch(d, 'motion.json', j => { delete j.cape }) })
  const run = check(dir)
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const summary = readFileSync(join(run.out, 'summary.txt'), 'utf8')
  assert.doesNotMatch(summary, /nonFinite/)
  assert.ok(!existsSync(join(run.out, 'cloth.png')))
})

test('a cape with a render entry is drawn into sheet.png and walk.png without changing any gate', () => {
  const plain = check(ok)
  const drawn = check(variant(d => {
    patch(d, 'motion.json', j => { j.cape.render = { material: 'tunic', radius: 0.02 } })
  }))
  assert.equal(drawn.status, 0, drawn.stdout + drawn.stderr)
  for (const file of ['sheet.png', 'walk.png']) {
    assert.notDeepEqual(readFileSync(join(drawn.out, file)), readFileSync(join(plain.out, file)), file)
  }
  for (const file of ['footprints.png', 'cloth.png']) {
    assert.deepEqual(readFileSync(join(drawn.out, file)), readFileSync(join(plain.out, file)), file)
  }
  const gates = (run: Run): unknown => JSON.parse(readFileSync(join(run.out, 'metrics.json'), 'utf8')).gates
  assert.deepEqual(gates(drawn), gates(plain))
})

test('the four-legged dog example passes every gate with one planted gate per leg', () => {
  const run = check(dog)
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const summary = readFileSync(join(run.out, 'summary.txt'), 'utf8')
  for (const leg of ['left hind', 'left front', 'right hind', 'right front']) {
    assert.match(summary, new RegExp(`^PASS {2}plantedFrames\\.${leg}: `, 'm'))
  }
})

test('hints for a four-legged character name the leg', () => {
  const run = check(variant(d => { patch(d, 'rig.json', j => { j.gait.stepHeight = 0.001 }) }, dog))
  const summary = readFileSync(join(run.out, 'summary.txt'), 'utf8')
  assert.match(summary, /hint: the (left|right) (hind|front) foot moves/)
})

test('four legs without phases are rejected with the walk order', () => {
  const run = check(variant(d => { patch(d, 'rig.json', j => { delete j.legs[1].phase }) }, dog))
  assert.equal(run.status, 2)
  assert.match(run.stderr, /^rig\.json: legs\[1\]\.phase: .*left hind 0, left front 0\.25/m)
})

const OUTPUTS = ['sheet.png', 'walk.png', 'footprints.png', 'cloth.png', 'metrics.json']

test('an exit 2 run leaves no report files from an earlier run', () => {
  const first = check(ok)
  assert.equal(first.status, 0, first.stdout + first.stderr)
  const dir = variant(d => { patch(d, 'rig.json', j => { j.pelvis = 'nowhere' }) })
  const run = check(dir, first.out)
  assert.equal(run.status, 2)
  for (const file of OUTPUTS) assert.ok(!existsSync(join(run.out, file)), file)
  assert.match(readFileSync(join(run.out, 'summary.txt'), 'utf8'), /automated gates: ERROR/)
})

test('an exit 1 run leaves no cloth still from an earlier run', () => {
  const first = check(ok)
  const dir = variant(d => {
    patch(d, 'motion.json', j => { delete j.cape })
    patch(d, 'rig.json', j => { j.gait.stepHeight = 0.001 })
  })
  const run = check(dir, first.out)
  assert.equal(run.status, 1, run.stdout + run.stderr)
  assert.ok(!existsSync(join(run.out, 'cloth.png')))
  assert.ok(existsSync(join(run.out, 'metrics.json')))
})

test('a file instead of a directory exits 2 with a clear message', () => {
  const run = check(join(ok, 'rig.json'))
  assert.equal(run.status, 2)
  assert.match(run.stderr, /is not a directory/)
  assert.doesNotMatch(run.stderr, /at .*\.ts:\d+/)
})

test('a missing manifest is reported once', () => {
  const dir = variant(d => { rmSync(join(d, 'character.json')) })
  const run = check(dir)
  assert.equal(run.status, 2)
  assert.equal(run.stderr.trim().split('\n').length, 1, run.stderr)
})

function summaryOf (run: Run): string {
  return readFileSync(join(run.out, 'summary.txt'), 'utf8')
}

test('a low stepHeight makes the slide and root-speed hints say to raise it', () => {
  const run = check(variant(d => { patch(d, 'rig.json', j => { j.gait.stepHeight = 0.01 }) }))
  assert.equal(run.status, 1, run.stdout + run.stderr)
  const summary = summaryOf(run)
  assert.match(summary, /stepHeight is below 0\.1 x the leg length: raise rig\.gait\.stepHeight/)
  assert.match(summary, /Raising it raises knee speed, which a lower stanceFraction offsets/)
  assert.match(summary, /window is long enough.*the feet never rise above 2 cm.*Raise rig\.gait\.stepHeight/)
})

test('a tilted foot is diagnosed by the difference of its sole points, not their height', () => {
  const run = check(variant(d => {
    patch(d, 'mannequin.json', j => { j.joints.toeL[1] = 0.12; j.joints.toeR[1] = 0.12 })
    patch(d, 'rig.json', j => { j.gait.stepHeight = 0.01 })
  }))
  const summary = summaryOf(run)
  assert.match(summary, /the foot is tilted by 0\.070 m.*absolute height does not matter/)
  assert.match(summary, /Set the 'toeL' joint y to 0\.050/)
})

test('a cape that starts inside the body gets a start-inside maxSpeed hint', () => {
  const run = check(variant(d => {
    patch(d, 'mannequin.json', j => { j.joints.capeL = [0.1, 0.9, -0.02]; j.joints.capeR = [-0.1, 0.9, -0.02] })
  }))
  assert.match(summaryOf(run), /FAIL {2}maxSpeed: [^]*starts inside part 'torso'[^]*Move the cape anchors outward/)
})

test('a cape whose bottom rows hang into a foot is told to shorten length', () => {
  const run = check(variant(d => {
    patch(d, 'mannequin.json', j => { j.joints.capeL = [0.1, 0.5, -0.03]; j.joints.capeR = [-0.1, 0.5, -0.03] })
    patch(d, 'motion.json', j => { j.exclude = ['torso'] })
  }))
  assert.match(summaryOf(run), /bottom rows of the cape hang into 'footL'.*shorten cape\.length \(now 0\.4\)/)
})

test('an appendage adds its gates and passes; balance is not gated for two legs', () => {
  const run = check(variant(d => {
    patch(d, 'mannequin.json', j => {
      j.joints.tail1 = [0, 0.6, -0.1]
      j.joints.tail2 = [0, 0.55, -0.25]
      j.joints.tail3 = [0, 0.5, -0.38]
    })
    patch(d, 'rig.json', j => {
      const legs = j.legs.map((l: any) => ({ kind: 'leg', side: l.side, joints: [l.hip, l.knee, l.ankle, l.toe] }))
      const arms = j.arms.map((a: any) => {
        return { kind: 'arm', side: a.side, joints: [a.shoulder, a.elbow, a.wrist, a.hand] }
      })
      const oscillate = { axis: [0, 1, 0], degrees: 20, period: 0.8 }
      const tail = { kind: 'appendage', name: 'tail', joints: ['tail1', 'tail2', 'tail3'], stiffness: 0.3, oscillate }
      j.limbs = [...legs, ...arms, tail]
      delete j.legs
      delete j.arms
    })
  }))
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const summary = summaryOf(run)
  assert.match(summary, /^PASS {2}appendageBoneLengthError: 0\.000 <= 0\.01$/m)
  assert.match(summary, /^PASS {2}appendageNonFinite: 0 <= 0$/m)
  assert.doesNotMatch(summary, /unbalancedFrames/)
})

test('the ok character has no appendage gates', () => {
  assert.doesNotMatch(summaryOf(check(ok)), /appendage/)
})

test('a knee-speed failure on a nearly straight leg says to bend it more at rest', () => {
  const run = check(variant(d => { patch(d, 'rig.json', j => { j.gait.stepHeight = 0.12 }) }))
  const summary = summaryOf(run)
  assert.match(summary, /^FAIL {2}kneeSpeedDegPerSec: /m)
  assert.match(summary, /The knee is bent only 14 degrees at rest: .* bend the knee more in the mannequin/)
  assert.match(summary, /\(move 'knee[LR]' toward its bend side/)
})

test('a knee-speed failure on a bent leg does not ask for more bend', () => {
  const run = check(variant(d => { patch(d, 'rig.json', j => { j.gait.stepHeight = 0.14 }) }, dog))
  const summary = summaryOf(run)
  assert.match(summary, /^FAIL {2}kneeSpeedDegPerSec: /m)
  assert.doesNotMatch(summary, /bent only/)
})
