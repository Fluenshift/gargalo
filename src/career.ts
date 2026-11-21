// Career mode: companies are chapters, each with levels, a boss and the pieces it unlocks.

import { LEVELS, STARTUP_LEGACY } from './levels'
import type { Architecture, Kind, Level } from './sim/model'

export interface Company {
  id: string
  name: string
  /** Who you work for and what money there is, in one or two sentences. */
  budget: string
  /** Played in order. */
  levels: Level[]
  /** Opens once every level above is done. Beating it is the promotion. */
  boss: Level
  /** Pieces this company adds to the parts list, on top of the earlier companies'. */
  unlocks: Kind[]
  /** What every level of the company starts from, unless the level has its own. */
  start?: Architecture
}

const level = (id: string): Level => {
  const found = LEVELS.find((l) => l.id === id)
  if (!found) throw new Error(`Fase desconhecida: ${id}`)
  return found
}

export const COMPANIES: Company[] = [
  {
    id: 'startup',
    name: 'Startup',
    budget: 'Três pessoas e o dinheiro do primeiro investidor. Cada servidor a mais sai do caixa.',
    levels: [
      level('colocar-no-ar'),
      level('primeiro-deploy'),
      level('banco-nao-aguenta'),
      level('imagens-pesadas'),
      level('pedidos-em-loop'),
      level('caiu-de-madrugada'),
    ],
    boss: level('materia-na-tv'),
    unlocks: ['cdn', 'lb', 'server', 'cache', 'db'],
  },
  {
    id: 'ecommerce',
    name: 'E-commerce',
    budget: 'Uma loja online que fatura de verdade. O caixa aguenta mais, mas cada pedido perdido é dinheiro na mesa.',
    levels: [
      level('checkout-travando'),
      level('catalogo-gigante'),
      level('replica-parada'),
      level('catalogo-sem-paginacao'),
      level('bot-de-precos'),
      level('pagamento-instavel'),
      level('servidor-velho'),
    ],
    boss: level('black-friday'),
    unlocks: ['queue', 'worker', 'replica', 'limiter', 'gateway'],
    // What the Startup left behind.
    start: STARTUP_LEGACY,
  },
  {
    id: 'fintech',
    name: 'Fintech global',
    budget: 'Uma fintech com clientes em três continentes. Dinheiro não pode sumir nem sair duas vezes, e a conta de nuvem já é grande.',
    levels: [level('transferencia-duplicada'), level('livro-razao'), level('sql-espalhado'), level('extrato-lento'), level('clientes-na-europa')],
    boss: level('fechamento-do-mes'),
    unlocks: ['shard', 'dns'],
    // A team that grew from a startup like yours.
    start: STARTUP_LEGACY,
  },
  {
    id: 'streaming',
    name: 'Streaming de vídeo',
    budget: 'Uma plataforma de vídeo com milhões de assinantes. Vídeo é arquivo pesado, e uma estreia põe o país inteiro no mesmo episódio.',
    levels: [level('upload-trava-servidor')],
    boss: level('estreia-de-serie'),
    unlocks: ['storage', 'topic', 'search'],
    // A video site that started as a plain web app.
    start: STARTUP_LEGACY,
  },
]

export type Status = 'done' | 'open' | 'locked'

/** Ids of the levels the player has passed. */
export type Passed = readonly string[]

export interface Stage {
  company: Company
  /** Index of the company in the career. */
  companyIndex: number
  level: Level
  isBoss: boolean
  /** 1-based position inside the company; the boss is last. */
  number: number
}

/** Every level of the career in play order, bosses after their company's levels. */
export function stages(companies: Company[] = COMPANIES): Stage[] {
  return companies.flatMap((company, companyIndex) =>
    [...company.levels, company.boss].map((l, i) => ({
      company,
      companyIndex,
      level: l,
      isBoss: l === company.boss,
      number: i + 1,
    })),
  )
}

export function findStage(levelId: string, companies: Company[] = COMPANIES): Stage | undefined {
  return stages(companies).find((s) => s.level.id === levelId)
}

/** A company opens when the previous company's boss is beaten (or anything in it was already played). */
export function companyOpen(index: number, passed: Passed, companies: Company[] = COMPANIES): boolean {
  if (index === 0) return true
  const company = companies[index]
  if ([...company.levels, company.boss].some((l) => passed.includes(l.id))) return true
  return passed.includes(companies[index - 1].boss.id)
}

/**
 * Levels open one after the other; the boss after all of the company's levels.
 * A level already passed always stays done, even if it was passed out of order
 * before career mode existed. Passing a level also clears the way past every
 * level before it, so a level added in front of one the player already passed
 * stays open to play without locking the levels after it.
 */
export function levelStatus(levelId: string, passed: Passed, companies: Company[] = COMPANIES): Status {
  if (passed.includes(levelId)) return 'done'
  const stage = findStage(levelId, companies)
  if (!stage || !companyOpen(stage.companyIndex, passed, companies)) return 'locked'
  const { levels } = stage.company
  // Index of the level right before this one (the last level, for the boss).
  const previous = (stage.isBoss ? levels.length : levels.indexOf(stage.level)) - 1
  const furthest = levels.findLastIndex((l) => passed.includes(l.id))
  return furthest >= previous ? 'open' : 'locked'
}

export function bossBeaten(company: Company, passed: Passed): boolean {
  return passed.includes(company.boss.id)
}

/** The piece is usable in this company, or the company that unlocks it (if any). */
export function pieceUnlock(
  kind: Kind,
  companyIndex: number,
  companies: Company[] = COMPANIES,
): { unlocked: true } | { unlocked: false; by?: Company } {
  const by = companies.findIndex((c) => c.unlocks.includes(kind))
  if (by !== -1 && by <= companyIndex) return { unlocked: true }
  return { unlocked: false, by: by === -1 ? undefined : companies[by] }
}

/** What is on the drawing when a level opens with no saved design. Always has the users. */
export function startArchitecture(stage: Pick<Stage, 'company' | 'level'>): Architecture {
  const start = stage.level.start ?? stage.company.start
  if (start?.nodes.some((n) => n.id === 'client')) return start
  return {
    nodes: [{ id: 'client', kind: 'client' }, ...(start?.nodes ?? [])],
    edges: start?.edges ?? [],
  }
}

export const PASSED_KEY = 'gargalo:passed'
/** JSON string with the id of the level on screen. */
export const CURRENT_KEY = 'gargalo:current'

export interface Progress {
  passed: string[]
  /** Level on screen. */
  current: string
}

/** First level that is open and not done; the last level when everything is done. */
export function nextLevel(passed: Passed, companies: Company[] = COMPANIES): string {
  const all = stages(companies)
  return (all.find((s) => levelStatus(s.level.id, passed, companies) === 'open') ?? all[all.length - 1]).level.id
}

/**
 * Reads progress saved by any version of the game. `gargalo:passed` keeps its
 * format (a list of level ids), so older versions still read it; anything that
 * is not a list of strings counts as no progress. The level on screen comes
 * back only if it still exists and is playable.
 */
export function loadProgress(read: (key: string) => string | null, companies: Company[] = COMPANIES): Progress {
  let passed: string[] = []
  try {
    const raw: unknown = JSON.parse(read(PASSED_KEY) ?? '[]')
    if (Array.isArray(raw)) passed = [...new Set(raw.filter((x): x is string => typeof x === 'string'))]
  } catch {
    // Corrupt: start over rather than crash.
  }
  let saved: unknown
  try {
    saved = JSON.parse(read(CURRENT_KEY) ?? 'null')
  } catch {
    saved = null
  }
  const current =
    typeof saved === 'string' && findStage(saved, companies) && levelStatus(saved, passed, companies) !== 'locked'
      ? saved
      : nextLevel(passed, companies)
  return { passed, current }
}
