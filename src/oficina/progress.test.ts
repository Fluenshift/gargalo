import { afterEach, describe, expect, it, vi } from 'vitest'
import { RESULTS_KEY, XP_PER_LEVEL, XP_PER_STAR, totalXp } from '../score'
import { allPassed, byCompany, clearCode, codeKey, loadCode, loadSavedResults, resultId, revealedHints, saveCode, saveResult, unlockedHints } from './progress'

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('saved code', () => {
  it('starts from the starter, keeps what is saved and goes back to the starter when cleared', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    expect(loadCode('ola', 'início')).toBe('início')
    expect(saveCode('ola', 'meu código')).toBe(true)
    expect(localStorage.getItem(codeKey('ola'))).toBe('meu código')
    expect(loadCode('ola', 'início')).toBe('meu código')
    clearCode('ola')
    expect(loadCode('ola', 'início')).toBe('início')
  })

  it('still works when storage is off', () => {
    const fail = () => {
      throw new Error('blocked')
    }
    vi.stubGlobal('localStorage', { getItem: fail, setItem: fail, removeItem: fail })
    expect(loadCode('ola', 'início')).toBe('início')
    expect(saveCode('ola', 'x')).toBe(false)
    expect(() => clearCode('ola')).not.toThrow()
  })
})

describe('hints and results', () => {
  it('unlocks one hint per failed submission, up to the last', () => {
    const hints = ['a', 'b']
    expect(unlockedHints(hints, 0)).toEqual([])
    expect(unlockedHints(hints, 1)).toEqual(['a'])
    expect(unlockedHints(hints, 5)).toEqual(['a', 'b'])
  })

  it('revealedHints shows hint 1 at once, then one more per failed run or request', () => {
    const hints = ['a', 'b', 'c']
    expect(revealedHints([], 0, 0)).toEqual([])
    expect(revealedHints(hints, 0, 0)).toEqual(['a'])
    expect(revealedHints(hints, 1, 0)).toEqual(['a', 'b'])
    expect(revealedHints(hints, 0, 1)).toEqual(['a', 'b'])
    expect(revealedHints(hints, 1, 1)).toEqual(['a', 'b', 'c'])
    expect(revealedHints(hints, 9, 9)).toEqual(hints)
  })

  it('passes only when there are results and all of them passed', () => {
    expect(allPassed([])).toBe(false)
    expect(
      allPassed([
        { name: 'a', passed: true },
        { name: 'b', passed: false },
      ]),
    ).toBe(false)
    expect(allPassed([{ name: 'a', passed: true }])).toBe(true)
  })

  it('groups by company in first-seen order', () => {
    const items = [
      { company: 'Startup', id: 1 },
      { company: 'Fintech', id: 2 },
      { company: 'Startup', id: 3 },
    ]
    expect(byCompany(items).map(([c, xs]) => [c, xs.map((x) => x.id)])).toEqual([
      ['Startup', [1, 3]],
      ['Fintech', [2]],
    ])
  })
})

describe('saved results', () => {
  const result = (stars: number) => ({ stars, cost: 170, p99Ms: 70, availability: 1 })

  it('keeps the best result beside the career results, and counts its XP', () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    storage.setItem(RESULTS_KEY, JSON.stringify({ 'startup-1': result(2) }))
    expect(saveResult('ola', result(2)).xp).toBe(XP_PER_LEVEL + 2 * XP_PER_STAR)
    expect(saveResult('ola', result(1))).toMatchObject({ xp: 0 })
    expect(saveResult('ola', result(3)).xp).toBe(XP_PER_STAR)
    const saved = loadSavedResults()
    expect(saved).toEqual({ 'startup-1': result(2), [resultId('ola')]: result(3) })
    expect(totalXp(saved) - totalXp({ 'startup-1': result(2) })).toBe(XP_PER_LEVEL + 3 * XP_PER_STAR)
  })

  it('still answers when storage is off', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(loadSavedResults()).toEqual({})
    expect(saveResult('ola', result(1)).xp).toBe(XP_PER_LEVEL + XP_PER_STAR)
  })
})
