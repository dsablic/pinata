import { DIRECTIONS } from './directions.ts'
import type { Frame, Recording } from './record.ts'
import { widestStride } from './stride.ts'
import type { PanelBase, PanelItem } from '../cli/choice-panel.ts'

const QUESTION = 'The image is one frame of a character, standing or walking, seen by a camera a little above ' +
  'its eye level. Which way is it facing? "front" is toward the viewer, "back" is away from the viewer (its ' +
  'back is visible), "right" and "left" are toward the right and the left edge of the image (seen from the ' +
  'side), and the four diagonals are in between ("front-right" is toward the viewer and toward the right ' +
  'edge, "back-left" is away from the viewer and toward the left edge, and so on). Left and right are as seen ' +
  'on screen.'

export function directionBase (name: string, seed: string): PanelBase {
  return { kind: 'choice', name, seed, question: QUESTION, labels: [...DIRECTIONS], scale: 6 }
}

const FRAMES: Record<string, (frames: Frame[]) => Frame> = {
  idle: frames => frames[0],
  walk: widestStride
}

export function directionItems (recording: Recording, idPrefix: string): PanelItem[] {
  return recording.tracks.map(track => {
    const id = `${idPrefix}${track.behaviour}-${track.direction}`
    const picture = FRAMES[track.behaviour](track.frames).image
    return { id, image: `frames/${id}.png`, label: track.direction, picture }
  })
}
