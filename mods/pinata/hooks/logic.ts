import type { Mode } from '../types'

export type Layout = { format: 'png' | 'cells', px: number, columns: number, rows: number }

const VIEW_WIDTH = 128
const VIEW_HEIGHT = 140
const VIEW_PX = 64
const MAX_IMAGE_COLUMNS = 40
const MAX_RASTER_PX = 32
const MIN_RASTER_PX = 8
const DEFAULT_COLOR = 0x01000000
const SPACE = 0x20

const LABELS: Record<string, string> = {
  idle: 'idle', think: 'thinking', busy: 'working', celebrate: 'done!', fail: 'ouch'
}

function clamp (n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function layoutFor (mode: Mode, bodyColumns: number, bodyRows: number): Layout {
  const roomRows = Math.max(4, bodyRows - 2)
  const aspect = VIEW_HEIGHT / VIEW_WIDTH
  if (mode === 'image') {
    const columns = clamp(Math.min(bodyColumns, MAX_IMAGE_COLUMNS, Math.floor(roomRows * 2 / aspect)), 4, 255)
    return { format: 'png', px: VIEW_PX, columns, rows: Math.max(2, Math.round(columns * aspect / 2)) }
  }
  const fit = Math.min(Math.floor(bodyColumns * VIEW_PX / VIEW_WIDTH), Math.floor(roomRows * 2 * VIEW_PX / VIEW_HEIGHT))
  const px = clamp(fit, MIN_RASTER_PX, MAX_RASTER_PX)
  const width = Math.round(VIEW_WIDTH * px / VIEW_PX)
  const height = Math.round(VIEW_HEIGHT * px / VIEW_PX)
  return { format: 'cells', px, columns: width, rows: Math.ceil(height / 2) }
}

export function sameLayout (a: Layout, b: Layout): boolean {
  return a.format === b.format && a.px === b.px && a.columns === b.columns && a.rows === b.rows
}

export function labelFor (behaviour: string): string {
  return LABELS[behaviour] ?? behaviour
}

export function blankCells (columns: number, rows: number): string {
  const words = new Uint32Array(columns * rows * 3)
  for (let i = 0; i < words.length; i += 3) words.set([SPACE, DEFAULT_COLOR, DEFAULT_COLOR], i)
  const bytes = new Uint8Array(words.buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export type TerminalEnv = { term?: string, termVersion?: string, kitty?: string, termName?: string }

export function guessMode (env: TerminalEnv): Mode {
  if (env.kitty !== undefined && env.kitty !== '') return 'image'
  if (env.termName === 'xterm-kitty' || env.termName === 'xterm-ghostty') return 'image'
  if (env.term === 'ghostty') return 'image'
  if (env.term === 'iTerm.app') {
    const [major = 0, minor = 0] = (env.termVersion ?? '').split('.').map(Number)
    return major > 3 || (major === 3 && minor >= 5) ? 'image' : 'raster'
  }
  return 'raster'
}

export function isAltDeny (deny: string, fix?: string): boolean {
  return fix === 'tmux-passthrough' || /\balt\b/i.test(deny)
}
