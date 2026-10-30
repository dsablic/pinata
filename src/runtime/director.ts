import { add, scale } from '../math/vec.ts'
import type { Vec3 } from '../math/vec.ts'
import type { Behaviour, Behaviours, Event } from './behaviours.ts'

/** What the active behaviours ask of the body at one moment, already weighted by their blends. */
export type Directions = {
  /** Horizontal acceleration on the hook, m/s^2 (sway). */
  push: Vec3
  /** A twist rate to drive toward, rad/s, with the weight of the spin layers asking for it (0: none). */
  spin: { rate: number, weight: number }
  /** Offset of the whole body along the rope, metres (bounce). */
  bounce: number
  /** Offsets of masked joints along the body's up axis, metres (breathe). */
  breathe: Array<{ mask: string[], offset: number }>
  /** Events due since the previous update. */
  events: Event[]
  current: string
}

type Active = { name: string, behaviour: Behaviour, start: number, blend: number, end?: number, fadeOut?: number }

const DEFAULT_THEN_BLEND = 0.3
/** Offsets move joints directly, so they fade in and out over at least this long, even on a zero blend. */
const MIN_OFFSET_BLEND = 0.2
/** Reduced motion: amplitudes, impulses, spins and turns are scaled down, periods stretched. */
const REDUCED_SCALE = 0.4
const REDUCED_SLOWDOWN = 1.5

function smooth (x: number): number {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

function weightAt (active: Active, time: number, minimum = 0): number {
  const blend = Math.max(active.blend, minimum)
  const fadeIn = blend > 0 ? smooth((time - active.start) / blend) : 1
  if (active.end === undefined) return fadeIn
  const fadeOut = Math.max(active.fadeOut ?? 0, minimum)
  return Math.min(fadeIn, fadeOut > 0 ? 1 - smooth((time - active.end) / fadeOut) : 0)
}

export type Director = {
  play: (name: string, blend: number, time: number) => void
  dispatch: (event: string, time: number) => boolean
  update: (time: number) => Directions
  current: () => string
}

/**
 * Plays named behaviours with cross-fades: a new behaviour fades in over `blend` seconds while the previous ones fade
 * out over the same time (offsets over at least 0.2 s). Periodic primitives run on the shared clock, so a wave that
 * two behaviours share carries on across a switch. Behaviours with `then` hand over after `duration`; events in a
 * behaviour fire once, at their time after it starts. `reduced` applies the reduced-motion scaling.
 */
export function createDirector (spec: Behaviours, options: { reduced: boolean }): Director {
  const factor = options.reduced ? REDUCED_SCALE : 1
  const slow = options.reduced ? REDUCED_SLOWDOWN : 1
  const actives: Active[] = []
  let lastUpdate = 0
  const fired = new Set<string>()
  const play = (name: string, blend: number, time: number): void => {
    const behaviour = spec.behaviours[name]
    if (behaviour === undefined) throw new Error(`unknown behaviour '${name}'`)
    for (const active of actives) {
      if (active.end === undefined) {
        active.end = time
        active.fadeOut = blend
      }
    }
    actives.push({ name, behaviour, start: time, blend })
  }
  const current = (): string => actives[actives.length - 1]?.name ?? spec.states.initial
  play(spec.states.initial, 0, 0)
  return {
    play,
    current,
    dispatch: (event, time) => {
      const transition = spec.states.transitions.find(t => {
        return t.on === event && (t.from === undefined || t.from === current())
      })
      if (transition === undefined) return false
      play(transition.to, transition.blend, time)
      return true
    },
    update: (time) => {
      const latest = actives[actives.length - 1]
      const { then, duration } = latest.behaviour
      if (then !== undefined && duration !== undefined && time - latest.start >= duration) {
        play(then, DEFAULT_THEN_BLEND, latest.start + duration)
      }
      const directions: Directions = {
        push: [0, 0, 0], spin: { rate: 0, weight: 0 }, bounce: 0, breathe: [], events: [], current: current()
      }
      for (const active of actives) {
        const weight = weightAt(active, time)
        const offsetWeight = weightAt(active, time, MIN_OFFSET_BLEND)
        const local = time - active.start
        for (const layer of active.behaviour.layers) {
          if (layer.do === 'sway') {
            const wave = Math.sin(2 * Math.PI * time / (layer.period * slow))
            directions.push = add(directions.push, [layer.amplitude * factor * wave * weight, 0, 0])
          } else if (local < layer.duration * slow) {
            const rate = 2 * Math.PI * layer.turns * factor / (layer.duration * slow)
            const total = directions.spin.weight + weight
            if (total > 0) {
              directions.spin.rate = (directions.spin.rate * directions.spin.weight + rate * weight) / total
              directions.spin.weight = Math.min(1, total)
            }
          }
        }
        for (const additive of active.behaviour.additive) {
          const wave = Math.sin(2 * Math.PI * time / (additive.period * slow))
          const offset = additive.amplitude * factor * wave * offsetWeight
          if (additive.do === 'bounce') directions.bounce += offset
          else directions.breathe.push({ mask: additive.mask, offset })
        }
        if (active.end !== undefined) continue
        active.behaviour.events.forEach((event, i) => {
          const key = `${active.start}/${active.name}/${i}`
          const due = active.start + event.at
          if (fired.has(key) || due > time || due < lastUpdate - 1e-9) return
          fired.add(key)
          directions.events.push({ ...event, impulse: scale(event.impulse, factor), spin: event.spin * factor })
        })
      }
      while (actives.length > 1 && actives[0].end !== undefined && weightAt(actives[0], time, MIN_OFFSET_BLEND) === 0) {
        actives.shift()
      }
      lastUpdate = time
      return directions
    }
  }
}
