import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rootAt, scriptDuration } from '../src/motion/script.ts'
import type { Script } from '../src/motion/script.ts'

test('a zero-length script stays at the origin', () => {
  const script: Script = { segments: [], accelSeconds: 0.5 }
  assert.equal(scriptDuration(script), 0)
  const root = rootAt(script, 5)
  assert.deepEqual(root.position, [0, 0, 0])
  assert.equal(root.yaw, 0)
  assert.deepEqual(root.velocity, [0, 0, 0])
})

test('moving at a constant speed without acceleration time covers speed times duration', () => {
  const script: Script = { segments: [{ action: 'move', speed: 1, duration: 2 }], accelSeconds: 0 }
  assert.equal(scriptDuration(script), 2)
  const [x, y, z] = rootAt(script, 2).position
  assert.ok(Math.abs(z - 2) < 1e-6)
  assert.equal(x, 0)
  assert.equal(y, 0)
})

test('easing the speed ends slightly short and keeps the velocity continuous', () => {
  const accelSeconds = 0.5
  const script: Script = { segments: [{ action: 'move', speed: 1, duration: 2 }], accelSeconds }
  const z = rootAt(script, 2).position[2]
  assert.ok(z < 2 && z > 1.7, `z = ${z}`)
  const limit = 1 * 0.001 / accelSeconds * 2
  let previous = rootAt(script, 0).velocity[2]
  for (let t = 0.001; t < 2; t += 0.001) {
    const speed = rootAt(script, t).velocity[2]
    assert.ok(Math.abs(speed - previous) <= limit, `jump at t = ${t}`)
    previous = speed
  }
})

test('a 90 degree turn ends at yaw pi/2 and moves toward +X', () => {
  const script: Script = {
    segments: [{ action: 'move', speed: 1, duration: 1 }, { action: 'turn', degrees: 90, duration: 1 },
      { action: 'move', speed: 1, duration: 1 }],
    accelSeconds: 0
  }
  const end = rootAt(script, scriptDuration(script))
  assert.ok(Math.abs(end.yaw - Math.PI / 2) < 1e-9)
  const mid = rootAt(script, 2.5)
  assert.ok(mid.velocity[0] > 0.99)
  assert.ok(Math.abs(mid.velocity[2]) < 1e-9)
  assert.ok(rootAt(script, 1.5).angularVelocity > 0)
})

test('hold decelerates to zero velocity', () => {
  const script: Script = {
    segments: [{ action: 'move', speed: 1, duration: 1 }, { action: 'hold', duration: 2 }],
    accelSeconds: 0.5
  }
  assert.deepEqual(rootAt(script, 2.9).velocity, [0, 0, 0])
  const end = rootAt(script, scriptDuration(script))
  assert.deepEqual(end.velocity, [0, 0, 0])
  assert.equal(end.angularVelocity, 0)
})

test('the root stays at its final position after the script ends', () => {
  const script: Script = { segments: [{ action: 'move', speed: 1, duration: 1 }], accelSeconds: 0.2 }
  assert.deepEqual(rootAt(script, 1).position, rootAt(script, 10).position)
  assert.deepEqual(rootAt(script, 10).velocity, [0, 0, 0])
})

test('the same time gives identical results', () => {
  const script: Script = {
    segments: [{ action: 'move', speed: 1.2, duration: 1 }, { action: 'turn', degrees: 90, duration: 0.8 }],
    accelSeconds: 0.3
  }
  assert.deepEqual(rootAt(script, 1.3), rootAt(script, 1.3))
})
