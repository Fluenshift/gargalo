// Stars, XP, ranks and achievements: what a run is worth, kept apart from the UI.

import { COMPANIES, stages } from './career'
import type { Company, Passed } from './career'
import type { RunSummary } from './sim/engine'
import type { Level } from './sim/model'

/** Passing with at most this share of the budget earns a star. */
export const THRIFTY_SHARE = 0.8
/** Passing with a p99 at most this share of the goal earns a star. */
export const FAST_SHARE = 0.6
/** Passing with at most this share of the budget earns "Mão de vaca". */
export const STINGY_SHARE = 0.6
/** Availability this close to 100% counts as no failed request at all. */
const NO_FAILURES = 0.99999

export const XP_PER_LEVEL = 100
export const XP_PER_BOSS = 300
export const XP_PER_STAR = 50

/** Ranks in order, each with the XP it takes. */
export const RANKS: { title: string; xp: number }[] = [
  { title: 'Estagiário', xp: 0 },
  { title: 'Júnior', xp: 400 },
  { title: 'Pleno', xp: 1600 },
  { title: 'Sênior', xp: 3300 },
  { title: 'Staff', xp: 4900 },
]

/** The best run kept for a level. */
export interface LevelResult {
  stars: number
  cost: number
  p99Ms: number
  availability: number
}

/** Best result per level id. */
export type Results = Record<string, LevelResult>

export const RESULTS_KEY = 'gargalo:results'

/** 0 when the run failed; else 1, plus one for staying under 80% of the budget and one for a p99 well under the goal. */
export function starsFor(summary: RunSummary, level: Level): number {
  if (!summary.passed.all) return 0
  const thrifty = summary.cost <= THRIFTY_SHARE * level.goals.maxCost
  const fast = summary.p99Ms <= FAST_SHARE * level.goals.maxP99Ms
  return 1 + Number(thrifty) + Number(fast)
}

export function resultOf(summary: RunSummary, level: Level): LevelResult {
  return { stars: starsFor(summary, level), cost: summary.cost, p99Ms: summary.p99Ms, availability: summary.availability }
}

/** More stars wins; on a tie, the cheaper run. */
export function better(a: LevelResult, b: LevelResult | undefined): boolean {
  if (!b) return true
  return a.stars > b.stars || (a.stars === b.stars && a.cost < b.cost)
}

/** Keeps the new result for `levelId` when it beats the saved one. A failed run is never kept. */
export function record(results: Results, levelId: string, result: LevelResult): Results {
  if (result.stars === 0 || !better(result, results[levelId])) return results
  return { ...results, [levelId]: result }
}

const isResult = (v: unknown): v is LevelResult =>
  typeof v === 'object' &&
  v !== null &&
  ['stars', 'cost', 'p99Ms', 'availability'].every((k) => typeof (v as Record<string, unknown>)[k] === 'number') &&
  [1, 2, 3].includes((v as LevelResult).stars)

/**
 * Reads saved results. Levels passed before results existed (only in `passed`)
 * count as one star, so nobody loses progress; anything malformed is dropped.
 */
export function loadResults(raw: string | null, passed: Passed): Results {
  const results: Results = {}
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}')
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
      for (const [id, value] of Object.entries(parsed)) if (isResult(value)) results[id] = value
  } catch {
    // Corrupt: keep only what `passed` proves.
  }
  for (const id of passed) results[id] ??= { stars: 1, cost: Infinity, p99Ms: Infinity, availability: 0 }
  return results
}

/** Results of Oficina exercises are kept beside the career's under this prefix. */
export const OFICINA_PREFIX = 'oficina:'
/** Results of project stages (`projeto:<course>:<stage>`) are kept the same way and count like exercises. */
export const PROJETO_PREFIX = 'projeto:'

/** XP from every level and Oficina exercise passed: a base per level (more for a boss) and a bonus per star. */
export function totalXp(results: Results, companies: Company[] = COMPANIES): number {
  const career = stages(companies).reduce((sum, s) => {
    const r = results[s.level.id]
    return r ? sum + (s.isBoss ? XP_PER_BOSS : XP_PER_LEVEL) + XP_PER_STAR * r.stars : sum
  }, 0)
  return career + oficinaXp(results)
}

/** XP from the Oficina exercises and project stages alone: a base per exercise or stage and a bonus per star, like a level. */
export function oficinaXp(results: Results): number {
  return Object.entries(results).reduce(
    (sum, [id, r]) => (id.startsWith(OFICINA_PREFIX) || id.startsWith(PROJETO_PREFIX) ? sum + XP_PER_LEVEL + XP_PER_STAR * r.stars : sum),
    0,
  )
}

/** The rank this much XP reaches, and the next one with how much XP is still missing. */
export function rankFor(xp: number): { title: string; next?: { title: string; missing: number } } {
  const reached = RANKS.filter((r) => xp >= r.xp)
  const next = RANKS[reached.length]
  return { title: reached[reached.length - 1].title, ...(next ? { next: { title: next.title, missing: next.xp - xp } } : {}) }
}

export interface Achievement {
  id: string
  title: string
  description: string
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'zero-downtime', title: 'Zero downtime', description: 'Passar uma fase sem nenhuma requisição perdida.' },
  { id: 'mao-de-vaca', title: 'Mão de vaca', description: 'Passar uma fase gastando até 60% do orçamento.' },
  { id: 'chefao-sem-5xx', title: 'Sobreviveu ao chefão sem nenhum 5xx', description: 'Vencer um chefão sem perder nenhuma requisição.' },
  { id: 'empresa-tres-estrelas', title: 'Arquitetura de referência', description: 'Três estrelas em todas as fases de uma empresa.' },
]

/** Ids of the achievements these results earned. */
export function achievements(results: Results, companies: Company[] = COMPANIES): string[] {
  const all = stages(companies)
  const done = all.filter((s) => results[s.level.id])
  const earned = new Set<string>()
  for (const s of done) {
    const r = results[s.level.id]
    if (r.availability >= NO_FAILURES) earned.add('zero-downtime')
    if (r.cost <= STINGY_SHARE * s.level.goals.maxCost) earned.add('mao-de-vaca')
    if (s.isBoss && r.availability >= NO_FAILURES) earned.add('chefao-sem-5xx')
  }
  if (companies.some((c) => [...c.levels, c.boss].every((l) => results[l.id]?.stars === 3))) earned.add('empresa-tres-estrelas')
  return ACHIEVEMENTS.map((a) => a.id).filter((id) => earned.has(id))
}

/** For a passing run, the cost and p99 limits behind the two bonus stars, and whether each was met. */
export function starGaps(summary: RunSummary, level: Level): { thrifty: { earned: boolean; limit: number }; fast: { earned: boolean; limit: number } } {
  const cost = THRIFTY_SHARE * level.goals.maxCost
  const p99 = FAST_SHARE * level.goals.maxP99Ms
  return { thrifty: { earned: summary.cost <= cost, limit: cost }, fast: { earned: summary.p99Ms <= p99, limit: p99 } }
}

/** XP this result adds on top of what `results` already holds (0 when it is not an improvement). */
export function xpGain(results: Results, levelId: string, result: LevelResult, companies: Company[] = COMPANIES): number {
  return totalXp(record(results, levelId, result), companies) - totalXp(results, companies)
}
