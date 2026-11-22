import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeTests } from './execute'
import type { Db, TestResult } from './exercise'
import { EXERCISES } from './exercises'
import { allPassed, byCompany, clearCode, codeKey, loadCode, saveCode, unlockedHints } from './progress'

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

  it('passes only when there are results and all of them passed', () => {
    expect(allPassed([])).toBe(false)
    expect(allPassed([{ name: 'a', passed: true }, { name: 'b', passed: false }])).toBe(false)
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

const noDb: Db = { query: () => Promise.reject(new Error('sem banco')), transaction: (fn) => fn(noDb) }

async function runAll(code: string, exercise: (typeof EXERCISES)[number]): Promise<TestResult[]> {
  const results: TestResult[] = []
  const tests = [...exercise.visible, ...exercise.hidden]
  await executeTests({ code, schema: exercise.schema, seed: exercise.seed, tests }, async () => noDb, ({ result }) => results.push(result))
  return results
}

describe('exercises', () => {
  it('have unique ids', () => {
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length)
  })

  // shortcut: runs without a database; once ctx.db is Postgres (#83), exercises that query it need the real one here.
  for (const exercise of EXERCISES.filter((e) => !e.schema)) {
    it(`${exercise.id}: the reference passes, the naive and the starter fail`, async () => {
      expect(allPassed(await runAll(exercise.reference, exercise))).toBe(true)
      expect(allPassed(await runAll(exercise.naive, exercise))).toBe(false)
      expect(allPassed(await runAll(exercise.starter, exercise))).toBe(false)
    })
  }
})
