type Recorded = { frames: unknown[] }

export function aroundFrame<R extends Recorded> (recording: R, frame: number): R {
  return { ...recording, frames: recording.frames.slice(Math.max(0, frame - 1), frame + 1) }
}

export function firstWorstFrame<R extends Recorded> (recording: R, measure: (r: R) => number, from = 0): number {
  let best = from
  let bestValue = -Infinity
  for (let i = from; i < recording.frames.length; i++) {
    const value = measure(aroundFrame(recording, i))
    if (value > bestValue) {
      best = i
      bestValue = value
    }
  }
  return best
}

export function frameTime (frame: number, fps: number): string {
  return `frame ${frame} (t = ${(frame / fps).toFixed(2)} s)`
}
