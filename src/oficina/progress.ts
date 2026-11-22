// What the Oficina screen keeps: the player's code per exercise (in localStorage) and which hints a run of failed submissions unlocks.

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
