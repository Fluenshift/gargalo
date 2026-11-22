// What the Oficina screen keeps: the player's code per exercise and its best result (in localStorage), and which hints a run of failed submissions unlocks.

import { OFICINA_PREFIX, RESULTS_KEY, loadResults, record, xpGain } from '../score'
import type { LevelResult, Results } from '../score'
import type { TestResult } from './exercise'

export const codeKey = (id: string) => `gargalo:oficina:code:${id}`

/** The saved code, or the starter when there is none or storage is off. */
export function loadCode(id: string, starter: string): string {
  try {
    return localStorage.getItem(codeKey(id)) ?? starter
  } catch {
    return starter
  }
}

/** Keeps the code; returns false when the browser refuses (it still works this visit). */
export function saveCode(id: string, code: string): boolean {
  try {
    localStorage.setItem(codeKey(id), code)
    return true
  } catch {
    return false
  }
}

export function clearCode(id: string) {
  try {
    localStorage.removeItem(codeKey(id))
  } catch {
    // Nothing saved to clear.
  }
}

export const allPassed = (results: TestResult[]) => results.length > 0 && results.every((r) => r.passed)

/** One hint per failed submission, in order, never more than there are. */
export const unlockedHints = (hints: string[], failedSubmits: number) => hints.slice(0, Math.max(0, failedSubmits))

/** Groups items by company, keeping the first-seen order of companies and items. */
export function byCompany<T extends { company: string }>(items: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const item of items) groups.set(item.company, [...(groups.get(item.company) ?? []), item])
  return [...groups]
}

export const resultId = (id: string) => `${OFICINA_PREFIX}${id}`

/** Every saved result, the career's included (they share one key); none when storage is off. */
export function loadSavedResults(): Results {
  try {
    return loadResults(localStorage.getItem(RESULTS_KEY), [])
  } catch {
    return {}
  }
}

/** Keeps the exercise's result when it beats the saved one; returns what is saved now and the XP it added. */
export function saveResult(id: string, result: LevelResult): { results: Results; xp: number } {
  const saved = loadSavedResults()
  const results = record(saved, resultId(id), result)
  if (results !== saved)
    try {
      localStorage.setItem(RESULTS_KEY, JSON.stringify(results))
    } catch {
      // Storage off: the result holds for this visit only.
    }
  return { results, xp: xpGain(saved, resultId(id), result) }
}
