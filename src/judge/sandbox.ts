import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PREFIX = 'judge-'
const FOLDER = 'packet'

export async function withJudgeDir<T> (
  source: string, names: readonly string[], use: (dir: string) => Promise<T>
): Promise<T> {
  const base = mkdtempSync(join(realpathSync(tmpdir()), PREFIX))
  const dir = join(base, FOLDER)
  try {
    mkdirSync(dir)
    for (const name of names) copyFileSync(join(source, name), join(dir, name))
    return await use(dir)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}
