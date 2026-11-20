import { describe, expect, it } from 'vitest'
import {
  applyRemoval,
  clampMenu,
  eventPoint,
  isEmptyRemoval,
  planRemoval,
  pointInRect,
  pushBounded,
  removalMessage,
  undoRemoval,
} from './editing'

const nodes = [
  { id: 'client', deletable: false },
  { id: 'lb' },
  { id: 's1' },
  { id: 's2' },
  { id: 'db' },
]
const edges = [
  { id: 'e1', source: 'client', target: 'lb' },
  { id: 'e2', source: 'lb', target: 's1' },
  { id: 'e3', source: 'lb', target: 's2' },
  { id: 'e4', source: 's1', target: 'db' },
  { id: 'e5', source: 's2', target: 'db' },
]

describe('planRemoval', () => {
  it('takes a node and every edge touching it', () => {
    const r = planRemoval(nodes, edges, ['s1'])
    expect(r.nodes).toEqual([{ item: nodes[2], index: 2 }])
    expect(r.edges.map((e) => e.item.id)).toEqual(['e2', 'e4'])
  })

  it('never removes a node marked not deletable', () => {
    const r = planRemoval(nodes, edges, ['client'])
    expect(isEmptyRemoval(r)).toBe(true)
  })

  it('removes a single edge without touching nodes', () => {
    const r = planRemoval(nodes, edges, [], ['e3'])
    expect(r.nodes).toEqual([])
    expect(r.edges).toEqual([{ item: edges[2], index: 2 }])
  })

  it('counts an edge only once when asked for and touching a removed node', () => {
    const r = planRemoval(nodes, edges, ['s1'], ['e2'])
    expect(r.edges.map((e) => e.item.id)).toEqual(['e2', 'e4'])
  })
})

describe('undoRemoval', () => {
  it('restores nodes and edges exactly, in their old order', () => {
    const r = planRemoval(nodes, edges, ['lb', 'db'])
    const after = applyRemoval(nodes, edges, r)
    expect(after.nodes.map((n) => n.id)).toEqual(['client', 's1', 's2'])
    expect(after.edges).toEqual([])
    const back = undoRemoval(after.nodes, after.edges, r)
    expect(back.nodes).toEqual(nodes)
    expect(back.edges).toEqual(edges)
  })

  it('appends when the list got shorter in the meantime', () => {
    const r = planRemoval(nodes, edges, ['db'])
    const after = applyRemoval(nodes, edges, r)
    const back = undoRemoval(after.nodes.slice(0, 1), [], r)
    expect(back.nodes.map((n) => n.id)).toEqual(['client', 'db'])
    // s1 and s2 are gone, so their edges to db cannot come back.
    expect(back.edges).toEqual([])
  })

  it('does not bring back a link drawn again in the meantime', () => {
    const r = planRemoval(nodes, edges, [], ['e4'])
    const after = applyRemoval(nodes, edges, r)
    const redrawn = [...after.edges, { id: 'xy-edge__s1-db', source: 's1', target: 'db' }]
    const back = undoRemoval(after.nodes, redrawn, r)
    expect(back.edges.filter((e) => e.source === 's1' && e.target === 'db')).toHaveLength(1)
  })

  it('leaves out the nodes `keepNode` refuses, and their edges', () => {
    const r = planRemoval(nodes, edges, ['db'])
    const after = applyRemoval(nodes, edges, r)
    const back = undoRemoval(after.nodes, after.edges, r, (n) => n.id !== 'db')
    expect(back.nodes.map((n) => n.id)).toEqual(['client', 'lb', 's1', 's2'])
    expect(back.edges.map((e) => e.id)).toEqual(['e1', 'e2', 'e3'])
  })

  it('does not duplicate an id that already exists', () => {
    const r = planRemoval(nodes, edges, ['s2'])
    const back = undoRemoval(nodes, edges, r)
    expect(back.nodes).toEqual(nodes)
    expect(back.edges).toEqual(edges)
  })
})

describe('removalMessage', () => {
  it('names what was removed', () => {
    expect(removalMessage(planRemoval(nodes, edges, ['s1']))).toBe('Peça removida.')
    expect(removalMessage(planRemoval(nodes, edges, ['s1', 's2']))).toBe('2 peças removidas.')
    expect(removalMessage(planRemoval(nodes, edges, [], ['e1']))).toBe('Ligação removida.')
    expect(removalMessage(planRemoval(nodes, edges, [], ['e1', 'e2']))).toBe('2 ligações removidas.')
  })
})

describe('small helpers', () => {
  it('keeps the undo stack bounded', () => {
    expect(pushBounded([1, 2, 3], 4, 3)).toEqual([2, 3, 4])
  })

  it('checks a point against a rect, edges included', () => {
    const r = { left: 10, top: 10, right: 20, bottom: 20 }
    expect(pointInRect(10, 20, r)).toBe(true)
    expect(pointInRect(21, 15, r)).toBe(false)
  })

  it('keeps a menu inside the viewport', () => {
    expect(clampMenu(380, 790, 160, 100, 390, 800)).toEqual({ x: 222, y: 692 })
    expect(clampMenu(-5, 3, 160, 100, 390, 800)).toEqual({ x: 8, y: 8 })
  })

  it('reads the point of mouse and touch events', () => {
    expect(eventPoint({ clientX: 4, clientY: 5 })).toEqual({ x: 4, y: 5 })
    const touch = { changedTouches: [{ clientX: 7, clientY: 8 }] } as unknown as Event
    expect(eventPoint(touch)).toEqual({ x: 7, y: 8 })
  })
})
