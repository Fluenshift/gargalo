// Daily challenge: one level per calendar day, the same for everyone, built
// from the date alone. Each day comes with the design it was tuned on, so the
// goals always have an answer.

import { mulberry32, runLevel } from './sim/engine'
import type { Architecture, ArchEdge, Kind, Level, UserClass } from './sim/model'

/** Day 1 of the daily challenge. */
export const FIRST_DAY = '2026-11-16'
export const DAILY_KEY = 'gargalo:daily'
/** XP for each day played, and on top for each day of the current streak (capped). */
export const XP_PER_DAY = 40
export const XP_PER_STREAK_DAY = 10
export const STREAK_XP_CAP = 7

const DAY_MS = 86_400_000
const isDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`))

/** 1 on the first day, then one more per calendar day. */
export function dayNumber(date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${FIRST_DAY}T00:00:00Z`)) / DAY_MS) + 1
}

/** `YYYY-MM-DD` of a moment, in the player's own calendar. */
export function localDate(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

function seedOf(date: string): number {
  let h = 2166136261
  for (const ch of `gargalo:${date}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}

interface Shape {
  /** Names the day's problem in the briefing. */
  theme: string
  mix: Record<UserClass, number>
  rps: number
  bot: number
  /** A server crashes from 20s to 40s. */
  crash: boolean
  cdn: boolean
  cache: boolean
  limiter: boolean
}

const round = (n: number, step: number) => Math.round(n / step) * step

/** What the day asks for: one of four kinds of trouble, sized at random. */
function shape(date: string): Shape {
  const rng = mulberry32(seedOf(date))
  const between = (lo: number, hi: number, step: number) => round(lo + rng() * (hi - lo), step)
  const kind = Math.floor(rng() * 4)
  if (kind === 0) {
    const read = between(0.6, 0.8, 0.05)
    return {
      theme: 'quase tudo leitura',
      mix: { static: round(0.9 - read, 0.05), read, write: 0.1 },
      rps: between(1200, 2800, 100),
      bot: 0,
      crash: false,
      cdn: false,
      cache: true,
      limiter: false,
    }
  }
  if (kind === 1) {
    const stat = between(0.55, 0.75, 0.05)
    return {
      theme: 'muitas imagens',
      mix: { static: stat, read: round(0.95 - stat, 0.05), write: 0.05 },
      rps: between(2000, 4500, 100),
      bot: 0,
      crash: false,
      cdn: true,
      cache: true,
      limiter: false,
    }
  }
  if (kind === 2)
    return {
      theme: 'um servidor cai no meio',
      mix: { static: 0.3, read: 0.55, write: 0.15 },
      rps: between(500, 1500, 100),
      bot: 0,
      crash: true,
      cdn: false,
      cache: true,
      limiter: false,
    }
  return {
    theme: 'um bot raspando o site',
    mix: { static: 0.3, read: 0.55, write: 0.15 },
    rps: between(600, 1200, 100),
    bot: between(1500, 3000, 100),
    crash: false,
    cdn: false,
    cache: true,
    limiter: true,
  }
}

/** The design the day is tuned on: enough servers to stay under 70% busy, plus what the trouble calls for. */
function referenceDesign(s: Shape): Architecture {
  const edgeServed = s.cdn ? s.mix.static * 0.95 : 0
  const atServers = s.rps * (1 - edgeServed)
  const servers = Math.max(2, Math.ceil(atServers / (400 * 0.7)) + (s.crash ? 1 : 0))
  const ids: [string, Kind][] = [
    ['client', 'client'],
    ['lb', 'lb'],
    ['db', 'db'],
  ]
  const edges: ArchEdge[] = []
  let front = 'client'
  for (const [on, id, kind] of [
    [s.cdn, 'cdn', 'cdn'],
    [s.limiter, 'limiter', 'limiter'],
  ] as [boolean, string, Kind][]) {
    if (!on) continue
    ids.push([id, kind])
    edges.push({ source: front, target: id })
    front = id
  }
  edges.push({ source: front, target: 'lb' })
  if (s.cache) {
    ids.push(['cache', 'cache'])
    edges.push({ source: 'cache', target: 'db' })
  }
  for (let i = 0; i < servers; i++) {
    ids.push([`server-${i}`, 'server'])
    edges.push({ source: 'lb', target: `server-${i}` }, { source: `server-${i}`, target: s.cache ? 'cache' : 'db' })
  }
  return { nodes: ids.map(([id, kind]) => ({ id, kind })), edges }
}

export interface Daily {
  date: string
  number: number
  level: Level
  /** A design that meets the day's goals. */
  reference: Architecture
}

/** The day's level. The same date always gives the same level, for every player. */
export function dailyLevel(date: string): Daily {
  if (!isDate(date)) throw new Error(`Data inválida: ${date}`)
  const s = shape(date)
  const reference = referenceDesign(s)
  const number = dayNumber(date)
  const draft: Level = {
    id: `diario-${date}`,
    title: `Desafio do dia #${number}`,
    briefing: '',
    durationS: 60,
    mix: s.mix,
    traffic: [{ from: 0, rps: s.rps }],
    ...(s.bot
      ? {
          bot: [
            { from: 0, rps: 0 },
            { from: 10, rps: s.bot },
          ],
        }
      : {}),
    failures: s.crash ? [{ kind: 'server', index: 0, from: 20, to: 40 }] : [],
    goals: { minAvailability: 0.99, maxP99Ms: Infinity, maxCost: Infinity },
  }
  const { summary } = runLevel(reference, draft)
  // Room over the reference, so other good designs pass too and the clock's seed never decides.
  const maxCost = Math.ceil((summary.cost * 1.15) / 10) * 10
  const maxP99Ms = Math.ceil((summary.p99Ms * 1.25) / 10) * 10
  const pct = (n: number) => `${Math.round(n * 100)}%`
  const briefing = [
    `Hoje: ${s.theme}. São ${s.rps.toLocaleString('pt-BR')} req/s, ${pct(s.mix.static)} estáticos, ${pct(s.mix.read)} leituras e ${pct(s.mix.write)} escritas.`,
    s.bot ? `A partir de 10s um bot manda mais ${s.bot.toLocaleString('pt-BR')} req/s.` : '',
    s.crash ? 'Dos 20s aos 40s um servidor fica fora do ar.' : '',
    `Metas: 99% de disponibilidade, p99 até ${maxP99Ms} ms, até $${maxCost} por mês.`,
  ]
    .filter(Boolean)
    .join(' ')
  return { date, number, reference, level: { ...draft, briefing, goals: { minAvailability: 0.99, maxP99Ms, maxCost } } }
}

/** Stars per date played. */
export type DailyRecord = Record<string, number>

/** Reads the daily record, dropping anything that is not a date with 0 to 3 stars. */
export function loadDaily(raw: string | null): DailyRecord {
  const out: DailyRecord = {}
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}')
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
      for (const [date, stars] of Object.entries(parsed)) if (isDate(date) && typeof stars === 'number' && [0, 1, 2, 3].includes(stars)) out[date] = stars
  } catch {
    // Corrupt: start the record over.
  }
  return out
}

/** Days passed in a row up to `today`, or up to yesterday when today is still open. */
export function streak(record: DailyRecord, today: string): number {
  const passed = (date: string) => (record[date] ?? 0) > 0
  let day = Date.parse(`${today}T00:00:00Z`)
  if (!passed(today)) day -= DAY_MS
  let count = 0
  while (passed(new Date(day).toISOString().slice(0, 10))) {
    count++
    day -= DAY_MS
  }
  return count
}

/** XP from the daily challenge: a share per day passed and a bonus that grows with the current streak. */
export function dailyXp(record: DailyRecord, today: string): number {
  const days = Object.values(record).filter((stars) => stars > 0).length
  return days * XP_PER_DAY + Math.min(streak(record, today), STREAK_XP_CAP) * XP_PER_STREAK_DAY
}

/** A result to paste anywhere without giving the design away. */
export function shareText(daily: Pick<Daily, 'number'>, stars: number, cost: number, p99Ms: number): string {
  return `gargalo #${daily.number}: ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)} $${Math.round(cost)} · ${Math.round(p99Ms)} ms`
}
