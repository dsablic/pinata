export type Io = { out: (line: string) => void, err: (line: string) => void }
export type Invoke = (command: string) => string

export const consoleIo: Io = {
  out: line => console.log(line),
  err: line => console.error(line)
}

export function messageOf (err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function bufferIo (): { io: Io, lines: string[] } {
  const lines: string[] = []
  return { io: { out: line => lines.push(line), err: line => lines.push(line) }, lines }
}

export function npmInvoke (command: string): string {
  return `npm run ${command} --`
}

export function pinataInvoke (command: string): string {
  return `pinata ${command}`
}
