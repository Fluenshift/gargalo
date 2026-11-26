import { describe, expect, it } from 'vitest'
import { dailyLevel, dailyXp, dayNumber, loadDaily, shareText, streak, XP_PER_DAY, XP_PER_STREAK_DAY } from './daily'
import { runLevel } from './sim/engine'

const dates = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, 10, 16 + i * 7)).toISOString().slice(0, 10))

describe('daily level', () => {
  it('is the same for the same date and changes with the date', () => {
    expect(dailyLevel('2026-12-01')).toEqual(dailyLevel('2026-12-01'))
    expect(new Set(dates.map((d) => JSON.stringify(dailyLevel(d).level.traffic))).size).toBeGreaterThan(6)
  })

  it('numbers days from the first one', () => {
    expect(dayNumber('2026-11-16')).toBe(1)
    expect(dailyLevel('2026-11-26').number).toBe(11)
  })

  it('rejects something that is not a date', () => {
    expect(() => dailyLevel('ontem')).toThrow()
  })

  it('always has a solution, whatever the seed, and a lone server is never one', { timeout: 120_000 }, () => {
    for (const date of dates) {
      const { level, reference } = dailyLevel(date)
      for (let seed = 1; seed <= 3; seed++) expect(runLevel(reference, level, seed).summary.passed.all, `${date} seed ${seed}`).toBe(true)
      const lone = {
        nodes: [
          { id: 'client', kind: 'client' as const },
          { id: 'server', kind: 'server' as const },
          { id: 'db', kind: 'db' as const },
        ],
        edges: [
          { source: 'client', target: 'server' },
          { source: 'server', target: 'db' },
        ],
      }
      expect(runLevel(lone, level).summary.passed.all, date).toBe(false)
    }
  })
})

describe('streak and XP', () => {
  it('counts days in a row up to today, or up to yesterday while today is open', () => {
    const record = { '2026-12-01': 2, '2026-12-02': 1, '2026-12-03': 3, '2026-11-29': 1 }
    expect(streak(record, '2026-12-03')).toBe(3)
    expect(streak(record, '2026-12-04')).toBe(3)
    expect(streak(record, '2026-12-05')).toBe(0)
    expect(streak({ ...record, '2026-12-02': 0 }, '2026-12-03')).toBe(1)
  })

  it('pays per day passed plus the streak', () => {
    expect(dailyXp({ '2026-12-01': 1, '2026-12-02': 2 }, '2026-12-02')).toBe(2 * XP_PER_DAY + 2 * XP_PER_STREAK_DAY)
  })

  it('drops malformed records', () => {
    expect(loadDaily(JSON.stringify({ '2026-12-01': 2, ontem: 3, '2026-12-02': 9 }))).toEqual({ '2026-12-01': 2 })
    expect(loadDaily('{')).toEqual({})
  })
})

it('shares a result without the design', () => {
  expect(shareText({ number: 42 }, 2, 410.4, 211.6)).toBe('gargalo #42: ★★☆ $410 · 212 ms')
})
