// A design saved in localStorage is untrusted: an older version of the game,
// another tab or a hand edit may have left something the board cannot draw.

import { MAX_RETRIES, REGIONS, SPECS } from './sim/model'
import type { Kind, Region } from './sim/model'

export interface SavedNode {
  id: string
  type: 'component'
  position: { x: number; y: number }
  data: { kind: Kind; region?: Region }
  deletable?: boolean
}

export interface SavedEdge {
  id: string
  source: string
  target: string
  data?: { retries?: number; backoff?: boolean; breaker?: boolean; idempotent?: boolean }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

const isRegion = (v: unknown): v is Region => typeof v === 'string' && Object.hasOwn(REGIONS, v)

const isKind = (v: unknown): v is Kind => typeof v === 'string' && Object.hasOwn(SPECS, v)

/** The saved design, or null when it is not one the board can draw. */
export function parseDesign(raw: string): { nodes: SavedNode[]; edges: SavedEdge[] } | null {
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
      data: { kind, ...(isRegion(n.data.region) && !SPECS[kind].global ? { region: n.data.region } : {}) },
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
    edges.push({
      id: typeof e.id === 'string' ? e.id : `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      ...(Object.keys(policy).length ? { data: policy } : {}),
    })
  }
  return { nodes, edges }
}
