import { describe, expect, it } from 'vitest'
import { COMPANIES } from './career'
import { RANKS, XP_PER_BOSS, XP_PER_LEVEL, XP_PER_STAR, achievements, loadResults, oficinaXp, rankFor, record, starGaps, starsFor, totalXp, xpGain } from './score'
import type { LevelResult } from './score'
import type { RunSummary } from './sim/engine'
import type { Level } from './sim/model'

const level = { goals: { minAvailability: 0.99, maxP99Ms: 200, maxCost: 1000 } } as Level
const run = (over: Partial<RunSummary>, passed = true): RunSummary =>
  ({ availability: 1, p99Ms: 190, cost: 900, passed: { all: passed }, ...over }) as RunSummary
const result = (stars: number, cost = 500, availability = 0.995): LevelResult => ({ stars, cost, p99Ms: 100, availability })
const startup = COMPANIES[0]

describe('stars', () => {
  it('none for a failed run', () => {
    expect(starsFor(run({ cost: 100, p99Ms: 10 }, false), level)).toBe(0)
  })
  it('one for passing, one for 80% of the budget, one for a p99 at 60% of the goal', () => {
    expect(starsFor(run({}), level)).toBe(1)
    expect(starsFor(run({ cost: 800 }), level)).toBe(2)
    expect(starsFor(run({ p99Ms: 120 }), level)).toBe(2)
    expect(starsFor(run({ cost: 800, p99Ms: 120 }), level)).toBe(3)
  })
})

describe('record', () => {
  it('keeps the run with more stars, then the cheaper one, and never a failure', () => {
    let r = record({}, 'a', result(1, 900))
    r = record(r, 'a', result(0, 10))
    expect(r.a.cost).toBe(900)
    r = record(r, 'a', result(1, 700))
    expect(r.a.cost).toBe(700)
    r = record(r, 'a', result(1, 800))
    expect(r.a.cost).toBe(700)
    r = record(r, 'a', result(2, 990))
    expect(r.a.stars).toBe(2)
  })
})

describe('loadResults', () => {
  it('gives levels passed before results existed one star', () => {
    expect(loadResults(null, ['colocar-no-ar'])['colocar-no-ar'].stars).toBe(1)
  })
  it('keeps valid saved results and drops malformed ones', () => {
    const raw = JSON.stringify({ a: result(3), b: { stars: 7, cost: 1, p99Ms: 1, availability: 1 }, c: 'x' })
    expect(loadResults(raw, [])).toEqual({ a: result(3) })
    expect(loadResults('{not json', ['a'])).toEqual({ a: { stars: 1, cost: Infinity, p99Ms: Infinity, availability: 0 } })
  })
  it('a saved result beats the one-star migration', () => {
    expect(loadResults(JSON.stringify({ a: result(2) }), ['a']).a.stars).toBe(2)
  })
})

describe('XP and ranks', () => {
  it('pays a base per level, more for a boss, and a bonus per star', () => {
    const first = startup.levels[0].id
    expect(totalXp({ [first]: result(2) })).toBe(XP_PER_LEVEL + 2 * XP_PER_STAR)
    expect(totalXp({ [startup.boss.id]: result(1) })).toBe(XP_PER_BOSS + XP_PER_STAR)
  })
  it('starts as intern and needs every star of the career for Staff', () => {
    expect(rankFor(0)).toEqual({ title: 'Estagiário', next: { title: 'Júnior', missing: RANKS[1].xp } })
    const everything = Object.fromEntries(COMPANIES.flatMap((c) => [...c.levels, c.boss]).map((l) => [l.id, result(3)]))
    expect(rankFor(totalXp(everything)).title).toBe('Staff')
    expect(rankFor(totalXp(everything)).next).toBeUndefined()
  })
  it('adds the Oficina exercises, which count for XP but are no career level', () => {
    const first = startup.levels[0].id
    const both = { [first]: result(2), 'oficina:ola': result(3, 0, 1) }
    expect(totalXp(both)).toBe(2 * XP_PER_LEVEL + 5 * XP_PER_STAR)
    expect(oficinaXp(both)).toBe(XP_PER_LEVEL + 3 * XP_PER_STAR)
    expect(xpGain({}, 'oficina:ola', result(1))).toBe(XP_PER_LEVEL + XP_PER_STAR)
    expect(achievements({ 'oficina:ola': result(3, 0, 1) })).toEqual([])
    expect(loadResults(JSON.stringify(both), [])).toEqual(both)
  })
})

describe('achievements', () => {
  it('earns each one from what the results show', () => {
    const lvl = startup.levels[0]
    expect(achievements({})).toEqual([])
    expect(achievements({ [lvl.id]: result(1, lvl.goals.maxCost, 1) })).toEqual(['zero-downtime'])
    expect(achievements({ [lvl.id]: result(1, lvl.goals.maxCost * 0.5) })).toEqual(['mao-de-vaca'])
    expect(achievements({ [startup.boss.id]: result(1, startup.boss.goals.maxCost, 1) })).toContain('chefao-sem-5xx')
    const allThree = Object.fromEntries([...startup.levels, startup.boss].map((l) => [l.id, result(3, l.goals.maxCost)]))
    expect(achievements(allThree)).toEqual(['empresa-tres-estrelas'])
  })
})

describe('starGaps and xpGain', () => {
  it('reports the limits and which bonus stars were met', () => {
    const g = starGaps(run({ cost: 800, p99Ms: 190 }), level)
    expect(g.thrifty).toEqual({ earned: true, limit: 800 })
    expect(g.fast).toEqual({ earned: false, limit: 120 })
  })
  it('xp gain is the improvement only', () => {
    const id = startup.levels[0].id
    expect(xpGain({}, id, result(2))).toBe(XP_PER_LEVEL + 2 * XP_PER_STAR)
    expect(xpGain({ [id]: result(2) }, id, result(3))).toBe(XP_PER_STAR)
    expect(xpGain({ [id]: result(3) }, id, result(1))).toBe(0)
  })
})
