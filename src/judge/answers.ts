import { isRecord } from '../formats/validate.ts'
import { choiceProblems, isChoiceKey } from './choice.ts'
import type { ChoiceKey } from './choice.ts'
import type { PanelKey } from './packet.ts'
import { answerProblems } from './score.ts'

function balancedObjects (text: string): string[] {
  const found: string[] = []
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0
    let inString = false
    for (let i = start; i < text.length; i++) {
      const c = text[i]
      if (inString) {
        if (c === '\\') i++
        else if (c === '"') inString = false
      } else if (c === '"') inString = true
      else if (c === '{') depth++
      else if (c === '}' && --depth === 0) {
        found.push(text.slice(start, i + 1))
        break
      }
    }
  }
  return found
}

function parsed (text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

export function extractAnswers (text: string, items: readonly string[]): Record<string, unknown> | undefined {
  const isPanelAnswer = (value: Record<string, unknown>): boolean => {
    const keys = Object.keys(value)
    return keys.length > 0 && keys.every(key => items.includes(key))
  }
  return balancedObjects(text).map(parsed).filter(v => v !== undefined).filter(isPanelAnswer).at(-1)
}

export function problemsWithAnswers (answers: unknown, key: PanelKey | ChoiceKey): string[] {
  return isChoiceKey(key) ? choiceProblems(answers, key) : answerProblems(answers, key)
}
