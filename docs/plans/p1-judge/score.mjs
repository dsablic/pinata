import { readFileSync } from 'node:fs'
const dir = process.argv[2]
const key = JSON.parse(readFileSync(`${dir}/key.json`, 'utf8'))
const judges = [1, 2, 3].map(n => JSON.parse(readFileSync(`${dir}/judge${n}.json`, 'utf8')))
const F = ['front', 'front, turned to screen-left', 'side, facing screen-left', 'back, turned to screen-left',
  'back', 'back, turned to screen-right', 'side, facing screen-right', 'front, turned to screen-right']
const steps = (a, b) => { const d = Math.abs(F.indexOf(a) - F.indexOf(b)); return Math.min(d, 8 - d) }
console.log('FACING (32px; el0 = side camera, el30 = 3/4 camera)')
const byFrame = {}
for (const [item, { frame, truth }] of Object.entries(key.facing)) {
  const answers = judges.map(j => j.facing[item.replace('.png', '')].facing)
  byFrame[frame] = { truth, answers, exact: answers.filter(a => a === truth).length, offs: answers.map(a => steps(a, truth)) }
}
for (const el of [0, 30]) {
  let exact = 0; let within1 = 0
  for (let d = 0; d < 8; d++) {
    const r = byFrame[`32px-el${el}-d${d}`]
    exact += r.exact; within1 += r.offs.filter(o => o <= 1).length
    console.log(`  el${el} d${d} truth=${r.truth.padEnd(30)} exact ${r.exact}/3  off-by(45deg): ${r.offs.join(',')}`)
  }
  console.log(`  el${el}: exact ${exact}/24, within 45deg ${within1}/24`)
}
const perJudge = judges.map((j, i) => Object.entries(key.facing).filter(([item, { truth }]) =>
  j.facing[item.replace('.png', '')].facing === truth).length)
console.log('  exact per judge (of 16):', perJudge.join(', '))
const majority = Object.values(byFrame).filter(r => r.exact >= 2).length
console.log('  frames where majority is exact (of 16):', majority)
console.log('\nA/B')
const real = {}
const controls = []
for (const [item, k] of Object.entries(key.ab)) {
  const id = item.replace('.png', '')
  const picks = judges.map(j => j.pairs[id].more_hand_made)
  if (k.kind === 'control') { controls.push(...picks); continue }
  const theirs = k.ours === 'left' ? 'right' : 'left'
  real[k.ref] ??= []
  real[k.ref].push(...picks.map(p => p === theirs ? 'ref' : p === 'cant_tell' ? 'tie' : 'ours'))
}
for (const [ref, r] of Object.entries(real)) {
  console.log(`  vs ${ref.padEnd(32)} picked ref ${r.filter(x => x === 'ref').length}/6, ours ${r.filter(x => x === 'ours').length}/6, cant_tell ${r.filter(x => x === 'tie').length}/6`)
}
console.log(`  controls (hand-made vs hand-made): cant_tell ${controls.filter(x => x === 'cant_tell').length}/${controls.length}`)
