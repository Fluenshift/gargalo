// A design saved in localStorage is untrusted: an older version of the game,
// another tab or a hand edit may have left something the board cannot draw.

import { MAX_RETRIES, PROTOCOLS, REGIONS, SPECS, openEdges, protocolRefusal } from './sim/model'
import type { Balance, Kind, Level, Protocol, Region } from './sim/model'

export interface SavedNode {
  id: string
  type: 'component'
  position: { x: number; y: number }
  data: { kind: Kind; region?: Region; balance?: Balance }
  deletable?: boolean
}

export interface SavedEdge {
  id: string
  source: string
  target: string
  data?: { retries?: number; backoff?: boolean; breaker?: boolean; idempotent?: boolean; protocol?: Protocol }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

const isRegion = (v: unknown): v is Region => typeof v === 'string' && Object.hasOwn(REGIONS, v)

const isProtocol = (v: unknown): v is Protocol => typeof v === 'string' && Object.hasOwn(PROTOCOLS, v)

const isBalance = (v: unknown): v is Balance => v === 'round-robin' || v === 'least-conn' || v === 'hash'

const isKind = (v: unknown): v is Kind => typeof v === 'string' && Object.hasOwn(SPECS, v)

/**
 * Keeps the picks that name a string option. With the level at hand, only known
 * challenge ids and their own option ids survive; without it, `levelWork` ignores unknown ones.
 */
function parseFixes(value: unknown, level?: Level): Record<string, string> | undefined {
  if (!isObject(value)) return undefined
  const fixes: Record<string, string> = {}
  for (const [challenge, option] of Object.entries(value)) {
    if (typeof option !== 'string') continue
    if (level && !level.code?.some((c) => c.id === challenge && c.options.some((o) => o.id === option))) continue
    fixes[challenge] = option
  }
  return Object.keys(fixes).length ? fixes : undefined
}

/** The saved design, or null when it is not one the board can draw. */
export function parseDesign(raw: string, level?: Level): { nodes: SavedNode[]; edges: SavedEdge[]; fixes?: Record<string, string> } | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObject(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return null

  const nodes: SavedNode[] = []
  for (const n of value.nodes) {
    if (!isObject(n) || typeof n.id !== 'string' || !isObject(n.position) || !isObject(n.data)) return null
    const { x, y } = n.position
    if (!Number.isFinite(x) || !Number.isFinite(y) || !isKind(n.data.kind)) return null
    const kind = n.data.kind
    nodes.push({
      id: n.id,
      type: 'component',
      position: { x: x as number, y: y as number },
      // Global pieces (users, DNS) sit in no region; a bad region is dropped.
      data: {
        kind,
        ...(isRegion(n.data.region) && !SPECS[kind].global ? { region: n.data.region } : {}),
        // Only pieces that divide traffic have a balance, and round robin is the default, not stored.
        ...(isBalance(n.data.balance) && n.data.balance !== 'round-robin' && SPECS[kind].balances ? { balance: n.data.balance } : {}),
      },
      ...(kind === 'client' || SPECS[kind].external ? { deletable: false } : {}),
    })
  }
  const ids = new Set(nodes.map((n) => n.id))
  if (ids.size !== nodes.length || !nodes.some((n) => n.data.kind === 'client')) return null

  const edges: SavedEdge[] = []
  for (const e of value.edges) {
    if (!isObject(e) || typeof e.source !== 'string' || typeof e.target !== 'string') return null
    if (!ids.has(e.source) || !ids.has(e.target)) return null
    const data = isObject(e.data) ? e.data : {}
    const policy: NonNullable<SavedEdge['data']> = {}
    if (Number.isInteger(data.retries) && (data.retries as number) >= 0 && (data.retries as number) <= MAX_RETRIES) policy.retries = data.retries as number
    if (data.backoff === true) policy.backoff = true
    if (data.breaker === true) policy.breaker = true
    if (data.idempotent === true) policy.idempotent = true
    // REST is the default and is not stored; a protocol the link cannot use falls back to it.
    if (isProtocol(data.protocol) && data.protocol !== 'rest') {
      const source = nodes.find((n) => n.id === e.source)!.data.kind
      const target = nodes.find((n) => n.id === e.target)!.data.kind
      if (!protocolRefusal(source, target, data.protocol)) policy.protocol = data.protocol
    }
    edges.push({
      id: typeof e.id === 'string' ? e.id : `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      ...(Object.keys(policy).length ? { data: policy } : {}),
    })
  }
  const fixes = parseFixes(value.fixes, level)
  // Links the picked code forbids cannot come back from storage.
  const open = new Set(openEdges({ nodes: nodes.map((n) => ({ id: n.id, kind: n.data.kind })), edges, ...(fixes ? { fixes } : {}) }, level))
  return { nodes, edges: edges.filter((e) => open.has(e)), ...(fixes ? { fixes } : {}) }
}
