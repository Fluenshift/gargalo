/** Pure helpers for removing, restoring and duplicating pieces on the board. */

interface Item {
  id: string
  deletable?: boolean
}

interface Link {
  id: string
  source: string
  target: string
}

/** An item that was removed, with the index it had so undo puts it back in the same place. */
export interface Indexed<T> {
  item: T
  index: number
}

export interface Removal<N extends Item = Item, E extends Link = Link> {
  nodes: Indexed<N>[]
  edges: Indexed<E>[]
}

/**
 * What removing these nodes and edges takes away: the nodes that can be deleted
 * and every edge asked for or touching one of those nodes.
 */
export function planRemoval<N extends Item, E extends Link>(nodes: N[], edges: E[], nodeIds: Iterable<string>, edgeIds: Iterable<string> = []): Removal<N, E> {
  const askedNodes = new Set(nodeIds)
  const askedEdges = new Set(edgeIds)
  const removedNodes = nodes.flatMap((item, index) => (askedNodes.has(item.id) && item.deletable !== false ? [{ item, index }] : []))
  const gone = new Set(removedNodes.map((r) => r.item.id))
  const removedEdges = edges.flatMap((item, index) => (askedEdges.has(item.id) || gone.has(item.source) || gone.has(item.target) ? [{ item, index }] : []))
  return { nodes: removedNodes, edges: removedEdges }
}

export const isEmptyRemoval = (r: Removal<Item, Link>) => r.nodes.length === 0 && r.edges.length === 0

/** The list without the removed items. */
export function without<T extends { id: string }>(list: T[], removed: Indexed<T>[]): T[] {
  const ids = new Set(removed.map((r) => r.item.id))
  return list.filter((x) => !ids.has(x.id))
}

/** Puts removed items back at their old indices, skipping ids already present or rejected by `keep`. */
export function restore<T extends { id: string }>(list: T[], removed: Indexed<T>[], keep: (item: T) => boolean = () => true): T[] {
  const out = [...list]
  const present = new Set(list.map((x) => x.id))
  for (const { item, index } of [...removed].sort((a, b) => a.index - b.index)) {
    if (present.has(item.id) || !keep(item)) continue
    out.splice(Math.min(index, out.length), 0, item)
    present.add(item.id)
  }
  return out
}

export function applyRemoval<N extends Item, E extends Link>(nodes: N[], edges: E[], r: Removal<N, E>) {
  return { nodes: without(nodes, r.nodes), edges: without(edges, r.edges) }
}

/**
 * Undoes a removal. Nodes come back unless `keepNode` refuses them; edges come back only if both
 * their ends exist and the same two pieces were not linked again in the meantime.
 */
export function undoRemoval<N extends Item, E extends Link>(nodes: N[], edges: E[], r: Removal<N, E>, keepNode: (node: N) => boolean = () => true) {
  const restoredNodes = restore(nodes, r.nodes, keepNode)
  const ids = new Set(restoredNodes.map((n) => n.id))
  const pairs = new Set(edges.map((e) => `${e.source}->${e.target}`))
  const restoredEdges = restore(edges, r.edges, (e) => {
    const pair = `${e.source}->${e.target}`
    if (!ids.has(e.source) || !ids.has(e.target) || pairs.has(pair)) return false
    pairs.add(pair)
    return true
  })
  return { nodes: restoredNodes, edges: restoredEdges }
}

/** The toast text for a removal. */
export function removalMessage(r: Removal<Item, Link>): string {
  const n = r.nodes.length
  const e = r.edges.length
  if (n === 1) return 'Peça removida.'
  if (n > 1) return `${n} peças removidas.`
  if (e === 1) return 'Ligação removida.'
  return `${e} ligações removidas.`
}

/** Pushes onto a small, bounded undo stack. */
export function pushBounded<T>(stack: T[], item: T, max = 20): T[] {
  return [...stack, item].slice(-max)
}

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export const pointInRect = (x: number, y: number, r: Rect) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom

/** Keeps a menu of size w×h opened at (x, y) inside a vw×vh viewport. */
export function clampMenu(x: number, y: number, w: number, h: number, vw: number, vh: number, margin = 8) {
  return {
    x: Math.max(margin, Math.min(x, vw - w - margin)),
    y: Math.max(margin, Math.min(y, vh - h - margin)),
  }
}

/** Screen position of a mouse, touch or pointer event. */
export function eventPoint(event: Event | { clientX: number; clientY: number }): { x: number; y: number } | null {
  if ('clientX' in event && typeof event.clientX === 'number') return { x: event.clientX, y: event.clientY }
  const touches = (event as TouchEvent).changedTouches ?? (event as TouchEvent).touches
  const t = touches?.[0]
  return t ? { x: t.clientX, y: t.clientY } : null
}
