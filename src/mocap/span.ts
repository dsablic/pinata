const SPAN = ':span'

export function spanKey (joint: string): string {
  return `${joint}${SPAN}`
}

export function isSpanKey (key: string): boolean {
  return key.endsWith(SPAN)
}
