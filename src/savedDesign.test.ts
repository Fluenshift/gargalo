import { describe, expect, it } from 'vitest'
import { parseDesign } from './savedDesign'

const node = (id: string, kind: string) => ({ id, type: 'component', position: { x: 0, y: 0 }, data: { kind } })
const valid = {
  nodes: [node('client', 'client'), node('server', 'server')],
  edges: [{ id: 'client->server', source: 'client', target: 'server' }],
}

describe('parseDesign', () => {
  it('reads a design the board saved', () => {
    const design = parseDesign(JSON.stringify(valid))
    expect(design?.nodes.map((n) => n.data.kind)).toEqual(['client', 'server'])
    expect(design?.nodes[0].deletable).toBe(false)
    expect(design?.edges).toEqual(valid.edges)
  })

  it('keeps a link policy and drops values out of range', () => {
    const edges = [
      { id: 'a', source: 'client', target: 'server', data: { retries: 2, backoff: true, breaker: true } },
      { id: 'b', source: 'server', target: 'client', data: { retries: 9, backoff: 'yes' } },
    ]
    const design = parseDesign(JSON.stringify({ ...valid, edges }))
    expect(design?.edges[0].data).toEqual({ retries: 2, backoff: true, breaker: true })
    expect(design?.edges[1].data).toBeUndefined()
  })

  it('drops run stats and other leftovers from the nodes', () => {
    const withStats = { ...valid, nodes: [{ ...node('client', 'client'), data: { kind: 'client', stats: { load: 9 } } }] }
    expect(parseDesign(JSON.stringify({ ...withStats, edges: [] }))?.nodes[0].data).toEqual({ kind: 'client' })
  })

  it.each([
    ['not JSON', '{'],
    ['not an object', '42'],
    ['missing edges', JSON.stringify({ nodes: valid.nodes })],
    ['an unknown kind', JSON.stringify({ ...valid, nodes: [...valid.nodes, node('x', 'mainframe')] })],
    ['a position that is not a number', JSON.stringify({ ...valid, nodes: [{ ...node('client', 'client'), position: { x: 'a', y: 0 } }] })],
    ['no users node', JSON.stringify({ nodes: [node('server', 'server')], edges: [] })],
    ['repeated ids', JSON.stringify({ nodes: [node('client', 'client'), node('client', 'server')], edges: [] })],
    ['an edge to a missing node', JSON.stringify({ ...valid, edges: [{ source: 'client', target: 'db' }] })],
  ])('rejects %s', (_, raw) => {
    expect(parseDesign(raw)).toBeNull()
  })
})
