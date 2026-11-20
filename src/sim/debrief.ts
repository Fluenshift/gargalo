// The post-mortem shown after a run: notable moments and the main bottleneck,
// derived from the ticks the engine produced.

import type { TickResult } from './engine'
import { SPECS } from './model'
import type { Architecture, Kind } from './model'

export interface DebriefEvent {
  /** Second the event happened. */
  t: number
  text: string
  tone: 'info' | 'warn' | 'bad'
}

export interface Bottleneck {
  kind: Kind
  /**
   * drops: refused load above capacity. down: was offline with nothing to take over.
   * limited: lost nothing, but turned users away with 429s. latency: nothing lost, but slowest.
   */
  reason: 'drops' | 'down' | 'limited' | 'latency'
  /** Requests lost or refused there over the run, retries included (0 for latency). */
  lost: number
}

const HOT_UTILIZATION = 0.9
const DROPPING = 0.001

const PLURAL: Partial<Record<Kind, string>> = {
  server: 'servidores',
  db: 'bancos de dados',
  cache: 'caches',
  lb: 'load balancers',
  cdn: 'CDNs',
  limiter: 'rate limiters',
  gateway: 'API gateways',
}

const fmt = (n: number) => Math.round(n).toLocaleString('pt-BR')

/** "servidor 2" when there are several of a kind, "banco de dados" when there is one. */
export function nodeName(arch: Architecture, id: string): string {
  const node = arch.nodes.find((n) => n.id === id)!
  const label = SPECS[node.kind].label.toLowerCase()
  const sameKind = arch.nodes.filter((n) => n.kind === node.kind)
  return sameKind.length > 1 ? `${label} ${sameKind.indexOf(node) + 1}` : label
}

/** Names a group of nodes of one kind that did the same thing in the same second. */
function groupName(arch: Architecture, ids: string[]): string {
  if (ids.length === 1) return nodeName(arch, ids[0])
  const kind = arch.nodes.find((n) => n.id === ids[0])!.kind
  return `${ids.length} ${PLURAL[kind] ?? `peças do tipo ${SPECS[kind].label}`}`
}

/** First second at which `test` holds for each node (nodes it never holds for are left out). */
function firstSeconds(ticks: TickResult[], test: (tick: TickResult, id: string) => boolean): Map<string, number> {
  const first = new Map<string, number>()
  for (const tick of ticks) {
    for (const id of Object.keys(tick.nodes)) if (!first.has(id) && test(tick, id)) first.set(id, tick.t)
  }
  return first
}

/** Turns per-node first seconds into one event per (second, kind). */
function grouped(
  arch: Architecture,
  first: Map<string, number>,
  text: (who: string, plural: boolean) => string,
  tone: DebriefEvent['tone'],
): DebriefEvent[] {
  const groups = new Map<string, { t: number; ids: string[] }>()
  for (const [id, t] of first) {
    const kind = arch.nodes.find((n) => n.id === id)!.kind
    const key = `${t}:${kind}`
    const group = groups.get(key) ?? { t, ids: [] }
    group.ids.push(id)
    groups.set(key, group)
  }
  return [...groups.values()].map(({ t, ids }) => ({ t, text: text(groupName(arch, ids), ids.length > 1), tone }))
}

export function timeline(arch: Architecture, ticks: TickResult[]): DebriefEvent[] {
  const events: DebriefEvent[] = []

  // Traffic changes.
  for (let i = 1; i < ticks.length; i++) {
    const before = ticks[i - 1].rps
    const now = ticks[i].rps
    if (now === before) continue
    const ratio = now > before ? now / before : before / now
    const times = ratio >= 2 && Number.isInteger(ratio) ? ` (${ratio}×)` : ''
    events.push({
      t: ticks[i].t,
      text: `O tráfego ${now > before ? 'subiu' : 'caiu'} de ${fmt(before)} para ${fmt(now)} req/s${times}.`,
      tone: 'info',
    })
  }

  // Pieces going offline and coming back.
  for (const node of arch.nodes) {
    for (let i = 0; i < ticks.length; i++) {
      const down = ticks[i].nodes[node.id]?.down ?? false
      const wasDown = i > 0 && (ticks[i - 1].nodes[node.id]?.down ?? false)
      if (down && !wasDown) events.push({ t: ticks[i].t, text: `${capitalize(nodeName(arch, node.id))} caiu.`, tone: 'bad' })
      if (!down && wasDown) events.push({ t: ticks[i].t, text: `${capitalize(nodeName(arch, node.id))} voltou.`, tone: 'info' })
    }
  }

  const noRoute = ticks.find((tick) => tick.failed.noRoute > 0)
  if (noRoute) {
    events.push({
      t: noRoute.t,
      text: `${fmt(noRoute.failed.noRoute)} req/s não tinham para onde ir: falta uma ligação no desenho.`,
      tone: 'bad',
    })
  }

  const limited = ticks.find((tick) => tick.failed.limited >= 1)
  if (limited) {
    events.push({
      t: limited.t,
      text: `O rate limiter começou a recusar ${fmt(limited.failed.limited)} req/s de usuários com 429.`,
      tone: 'warn',
    })
  }

  // Circuit breakers opening and closing, grouped by second.
  const opened = new Map<number, number>()
  const closed = new Map<number, number>()
  for (let i = 1; i < ticks.length; i++) {
    const before = ticks[i - 1].breakers
    const now = ticks[i].breakers
    for (const key of Object.keys(now)) if (now[key] === 'open' && !before[key]) opened.set(ticks[i].t, (opened.get(ticks[i].t) ?? 0) + 1)
    for (const key of Object.keys(before)) if (!now[key]) closed.set(ticks[i].t, (closed.get(ticks[i].t) ?? 0) + 1)
  }
  for (const [t, n] of opened) {
    events.push({
      t,
      text: n === 1 ? 'Um circuit breaker abriu: as chamadas falham na hora.' : `${n} circuit breakers abriram: as chamadas falham na hora.`,
      tone: 'warn',
    })
  }
  for (const [t, n] of closed) {
    events.push({ t, text: n === 1 ? 'Um circuit breaker fechou de novo.' : `${n} circuit breakers fecharam de novo.`, tone: 'info' })
  }

  // First time each piece refused load, and first time it ran hot without refusing yet.
  const dropping = firstSeconds(ticks, (tick, id) => !tick.nodes[id].down && tick.nodes[id].dropRate > DROPPING)
  events.push(
    ...grouped(
      arch,
      dropping,
      (who, plural) =>
        `${capitalize(who)} ${plural ? 'passaram' : 'passou'} do limite e ${plural ? 'começaram' : 'começou'} a descartar requisições.`,
      'bad',
    ),
  )
  const hot = firstSeconds(
    ticks,
    (tick, id) => tick.nodes[id].utilization > HOT_UTILIZATION && (dropping.get(id) ?? Infinity) > tick.t,
  )
  events.push(
    ...grouped(
      arch,
      hot,
      (who, plural) => `${capitalize(who)} ${plural ? 'passaram' : 'passou'} de 90% de utilização; a fila começa a crescer.`,
      'warn',
    ),
  )

  // Events were pushed causes first (traffic, outages, missing links, then load);
  // a stable sort by second keeps that order within each second.
  return events.sort((a, b) => a.t - b.t)
}

/** The kind of piece that hurt the run most: where requests were lost, or else where they waited longest. */
export function bottleneck(arch: Architecture, ticks: TickResult[]): Bottleneck | undefined {
  const lost = new Map<Kind, { drops: number; down: number }>()
  let slowest: { kind: Kind; latencyMs: number } | undefined
  for (const tick of ticks) {
    for (const [id, stats] of Object.entries(tick.nodes)) {
      const kind = arch.nodes.find((n) => n.id === id)!.kind
      const entry = lost.get(kind) ?? { drops: 0, down: 0 }
      entry[stats.down ? 'down' : 'drops'] += stats.lost
      lost.set(kind, entry)
      if (!stats.down && stats.load > 0 && stats.latencyMs > (slowest?.latencyMs ?? 0)) {
        slowest = { kind, latencyMs: stats.latencyMs }
      }
    }
  }
  let worst: Bottleneck | undefined
  for (const [kind, { drops, down }] of lost) {
    const reason = down > drops ? 'down' : 'drops'
    const amount = Math.max(drops, down)
    if (amount >= 1 && amount > (worst?.lost ?? 0)) worst = { kind, reason, lost: amount }
  }
  if (worst) return worst
  // Nothing failed, but users were turned away: the piece that refused them is where the run hurt.
  const refusedUsers = ticks.reduce((sum, tick) => sum + tick.failed.limited, 0)
  if (refusedUsers >= 1) {
    const refusedBy = new Map<Kind, number>()
    for (const tick of ticks) {
      for (const [id, stats] of Object.entries(tick.nodes)) {
        const kind = arch.nodes.find((n) => n.id === id)!.kind
        refusedBy.set(kind, (refusedBy.get(kind) ?? 0) + (stats.refused ?? 0))
      }
    }
    const kind = [...refusedBy].sort((a, b) => b[1] - a[1])[0][0]
    return { kind, reason: 'limited', lost: refusedUsers }
  }
  return slowest && { kind: slowest.kind, reason: 'latency', lost: 0 }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
