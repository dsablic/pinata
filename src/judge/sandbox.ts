import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PREFIX = 'judge-'
const FOLDER = 'packet'
const live = new Set<string>()

export function removeJudgeDirs (): void {
  for (const base of live) rmSync(base, { recursive: true, force: true })
  live.clear()
}

export async function withJudgeDir<T> (
  source: string, names: readonly string[], use: (dir: string) => Promise<T>
): Promise<T> {
  const base = mkdtempSync(join(realpathSync(tmpdir()), PREFIX))
  live.add(base)
  const dir = join(base, FOLDER)
  try {
    mkdirSync(dir)
    for (const name of names) copyFileSync(join(source, name), join(dir, name))
    return await use(dir)
  } finally {
    rmSync(base, { recursive: true, force: true })
    live.delete(base)
  }
}
