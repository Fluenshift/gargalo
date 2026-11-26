import { describe, expect, it } from 'vitest'
import { parseDesign } from './savedDesign'
import { LEVELS } from './levels'

const loop = LEVELS.find((l) => l.id === 'pedidos-em-loop')!

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

  it('keeps a balance on a balancing piece and drops it elsewhere or when invalid', () => {
    const lb = (balance: unknown) => ({ ...node('lb', 'lb'), data: { kind: 'lb', balance } })
    const read = (nodes: unknown[]) => parseDesign(JSON.stringify({ ...valid, nodes: [...valid.nodes, ...nodes] }))?.nodes
    expect(read([lb('least-conn')])?.[2].data.balance).toBe('least-conn')
    expect(read([lb('hash')])?.[2].data.balance).toBe('hash')
    expect(read([lb('random')])?.[2].data.balance).toBeUndefined()
    expect(read([{ ...node('s2', 'server'), data: { kind: 'server', balance: 'hash' } }])?.[2].data.balance).toBeUndefined()
  })

  it('keeps a link policy and drops values out of range', () => {
    const edges = [
      { id: 'a', source: 'client', target: 'server', data: { retries: 2, backoff: true, breaker: true, idempotent: true } },
      { id: 'b', source: 'server', target: 'db', data: { retries: 9, backoff: 'yes', idempotent: 1 } },
    ]
    const design = parseDesign(JSON.stringify({ nodes: [...valid.nodes, node('db', 'db')], edges }))
    expect(design?.edges[0].data).toEqual({ retries: 2, backoff: true, breaker: true, idempotent: true })
    expect(design?.edges[1].data).toBeUndefined()
  })

  it('keeps a protocol the link can use and drops the rest back to REST', () => {
    const kinds = ['client', 'dns', 'cdn', 'lb', 'server', 'db']
    const nodes = [...kinds.map((k) => node(k, k)), node('server-2', 'server')]
    const link = (source: string, target: string, protocol: unknown) => ({ id: `${source}->${target}`, source, target, data: { protocol } })
    const design = parseDesign(
      JSON.stringify({
        nodes,
        edges: [
          link('client', 'cdn', 'graphql'), // a browser speaks GraphQL
          link('lb', 'server', 'grpc'), // internal link
          link('dns', 'server-2', 'grpc'), // a browser does not speak gRPC
          link('server', 'db', 'graphql'), // the database takes no API calls
          link('cdn', 'lb', 'soap'), // unknown
          link('lb', 'server-2', 'rest'), // the default is not stored
        ],
      }),
    )
    expect(design?.edges.map((e) => e.data?.protocol)).toEqual(['graphql', 'grpc', undefined, undefined, undefined, undefined])
  })

  it('drops run stats and other leftovers from the nodes', () => {
    const withStats = { ...valid, nodes: [{ ...node('client', 'client'), data: { kind: 'client', stats: { load: 9 } } }] }
    expect(parseDesign(JSON.stringify({ ...withStats, edges: [] }))?.nodes[0].data).toEqual({ kind: 'client' })
  })

  it('keeps a valid region and drops an invalid one or one on a global piece', () => {
    const at = (id: string, kind: string, region: unknown) => ({ ...node(id, kind), data: { kind, region } })
    const design = parseDesign(
      JSON.stringify({
        nodes: [at('client', 'client', 'us'), at('a', 'server', 'us'), at('b', 'server', 'mars'), at('c', 'dns', 'eu')],
        edges: [],
      }),
    )
    expect(design?.nodes.map((n) => n.data)).toEqual([{ kind: 'client' }, { kind: 'server', region: 'us' }, { kind: 'server' }, { kind: 'dns' }])
  })

  it("keeps the picks for the level's code challenges and drops the rest", () => {
    const raw = (fixes: unknown) => JSON.stringify({ ...valid, fixes })
    expect(parseDesign(raw({ 'n-mais-um': 'where-in' }), loop)?.fixes).toEqual({ 'n-mais-um': 'where-in' })
    expect(parseDesign(raw({ 'n-mais-um': 'nope', outro: 'where-in', 'sem-indice': 'indice' }), loop)?.fixes).toBeUndefined()
    expect(parseDesign(raw({ 'n-mais-um': 7 }), loop)?.fixes).toBeUndefined()
    expect(parseDesign(raw('where-in'), loop)?.fixes).toBeUndefined()
    // Without the level, any string pick is kept and the engine ignores unknown ones.
    expect(parseDesign(raw({ a: 'b', c: 1 }))?.fixes).toEqual({ a: 'b' })
  })

  it('keeps only links the board would draw', () => {
    const kinds = ['client', 'cdn', 'lb', 'server', 'db']
    const link = (source: string, target: string) => ({ id: `${source}->${target}`, source, target })
    const design = parseDesign(
      JSON.stringify({
        nodes: [...kinds.map((k) => node(k, k)), node('server-2', 'server')],
        edges: [
          link('client', 'cdn'),
          link('client', 'lb'), // the users link to one piece only
          link('cdn', 'lb'),
          { ...link('cdn', 'lb'), id: 'again' }, // the same two pieces twice
          link('lb', 'server'),
          link('lb', 'lb'), // a piece to itself
          link('server', 'server-2'), // a server sends nothing to a server
          link('db', 'client'), // nor a database to the users
          link('server', 'db'),
        ],
      }),
    )
    expect(design?.edges.map((e) => e.id)).toEqual(['client->cdn', 'cdn->lb', 'lb->server', 'server->db'])
  })

  it('keeps the first of a kind the board allows only once, and drops the links of the rest', () => {
    const design = parseDesign(
      JSON.stringify({
        nodes: [...valid.nodes, node('db', 'db'), node('db-2', 'db'), node('client-2', 'client')],
        edges: [...valid.edges, { source: 'server', target: 'db' }, { source: 'server', target: 'db-2' }],
      }),
    )
    expect(design?.nodes.map((n) => n.id)).toEqual(['client', 'server', 'db'])
    expect(design?.edges.map((e) => e.target)).toEqual(['server', 'db'])
  })

  it('has no fixes when none were saved', () => {
    expect(parseDesign(JSON.stringify(valid), loop)).not.toHaveProperty('fixes')
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
