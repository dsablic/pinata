import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRootTrack, rootAt, scriptDuration } from '../src/motion/script.ts'
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

test('zero acceleration time moves at exactly the requested speed', () => {
  const script: Script = { segments: [{ action: 'move', speed: 2, duration: 3 }], accelSeconds: 0 }
  const end = rootAt(script, 2.999)
  assert.ok(Math.abs(end.velocity[2] - 2) < 1e-9)
  assert.ok(Math.abs(rootAt(script, 3).position[2] - 6) < 1e-6)
  assert.ok(Math.abs(rootAt(script, 1).position[2] - 2) < 1e-6)
})

test('zero acceleration time stops during a hold', () => {
  const script: Script = {
    segments: [{ action: 'move', speed: 2, duration: 1 }, { action: 'hold', duration: 2 }],
    accelSeconds: 0
  }
  assert.deepEqual(rootAt(script, 1.5).velocity, [0, 0, 0])
  assert.ok(Math.abs(rootAt(script, 2.5).position[2] - 2) < 1e-6)
})

test('a move shorter than accelSeconds followed by a turn and a hold stays finite and stops', () => {
  const script: Script = {
    segments: [
      { action: 'move', speed: 2, duration: 0.2 },
      { action: 'turn', degrees: 90, duration: 0.5 },
      { action: 'hold', duration: 1 }
    ],
    accelSeconds: 0.5
  }
  for (let t = 0; t < scriptDuration(script); t += 0.05) {
    const speed = Math.hypot(...rootAt(script, t).velocity)
    assert.ok(speed >= 0 && speed <= 2 + 1e-9, `speed ${speed} at t = ${t}`)
  }
  assert.ok(Math.abs(Math.hypot(...rootAt(script, 1.65).velocity)) < 1e-9)
})

test('position and yaw differences match velocity and angular velocity', () => {
  const script: Script = {
    segments: [
      { action: 'move', speed: 1.5, duration: 2 },
      { action: 'turn', degrees: 120, duration: 1.5 },
      { action: 'move', speed: 0.5, duration: 1 },
      { action: 'hold', duration: 1 }
    ],
    accelSeconds: 0.4
  }
  const h = 0.01
  for (let t = 0.1; t < scriptDuration(script) - 0.2; t += 0.37) {
    const a = rootAt(script, t - h)
    const b = rootAt(script, t + h)
    const mid = rootAt(script, t)
    for (const axis of [0, 2]) {
      const rate = (b.position[axis] - a.position[axis]) / (2 * h)
      assert.ok(Math.abs(rate - mid.velocity[axis]) < 1e-3, `axis ${axis} at t = ${t}`)
    }
    assert.ok(Math.abs((b.yaw - a.yaw) / (2 * h) - mid.angularVelocity) < 1e-3, `yaw at t = ${t}`)
  }
})

const mixed: Script = {
  segments: [
    { action: 'move', speed: 1.5, duration: 2 },
    { action: 'turn', degrees: 120, duration: 1.5 },
    { action: 'move', speed: 0.5, duration: 1.3 },
    { action: 'hold', duration: 1 }
  ],
  accelSeconds: 0.4
}

test('createRootTrack matches rootAt at random times, including past the ends', () => {
  const track = createRootTrack(mixed)
  const times = [-1, 0, scriptDuration(mixed), scriptDuration(mixed) + 3]
  for (let i = 0; i < 200; i++) times.push(Math.random() * scriptDuration(mixed))
  for (const t of times) {
    const a = track(t)
    const b = rootAt(mixed, t)
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(a.position[i] - b.position[i]) < 1e-6, `position at t = ${t}`)
      assert.ok(Math.abs(a.velocity[i] - b.velocity[i]) < 1e-6, `velocity at t = ${t}`)
    }
    assert.ok(Math.abs(a.yaw - b.yaw) < 1e-6)
    assert.ok(Math.abs(a.angularVelocity - b.angularVelocity) < 1e-6)
  }
})

test('createRootTrack is a pure function of t', () => {
  const track = createRootTrack(mixed)
  const first = track(3.3)
  track(0.2)
  track(7)
  assert.deepEqual(track(3.3), first)
  assert.deepEqual(createRootTrack(mixed)(3.3), first)
})

test('createRootTrack handles an empty script', () => {
  assert.deepEqual(createRootTrack({ segments: [], accelSeconds: 0.3 })(1).position, [0, 0, 0])
})
