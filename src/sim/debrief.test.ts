import { describe, expect, it } from 'vitest'
import { LEVELS } from '../levels'
import { ALTERNATIVES } from '../alternatives'
import { bottleneck, nodeName, timeline } from './debrief'
import { runLevel } from './engine'
import type { Architecture, Kind, Level } from './model'

function arch(edges: [string, string][]): Architecture {
  const ids = [...new Set(edges.flat())]
  return {
    nodes: ids.map((id) => ({ id, kind: id.split('#')[0] as Kind })),
    edges: edges.map(([source, target]) => ({ source, target })),
  }
}

function lbServers(servers: number, downstream: string[]): Architecture {
  const edges: [string, string][] = [['client', 'lb']]
  for (let i = 0; i < servers; i++) edges.push(['lb', `server#${i}`], [`server#${i}`, downstream[0]])
  for (let i = 1; i < downstream.length; i++) edges.push([downstream[i - 1], downstream[i]])
  return arch(edges)
}

const spike: Level = {
  id: 't',
  title: 't',
  briefing: '',
  durationS: 10,
  mix: { static: 0, read: 1, write: 0 },
  traffic: [
    { from: 0, rps: 300 },
    { from: 4, rps: 900 },
  ],
  failures: [{ kind: 'server', index: 0, from: 6, to: 8 }],
  goals: { minAvailability: 0.99, maxP99Ms: 1000, maxCost: 10_000 },
}

describe('timeline', () => {
  const a = lbServers(3, ['db'])
  const events = timeline(a, runLevel(a, spike).ticks)
  const at = (t: number) => events.filter((e) => e.t === t).map((e) => e.text)

  it('reports traffic changes with the multiplier', () => {
    expect(at(4)).toContain('O tráfego subiu de 300 para 900 req/s (3×).')
  })

  it('reports a piece going down and coming back', () => {
    expect(at(6)).toContain('Servidor 1 caiu.')
    expect(at(8)).toContain('Servidor 1 voltou.')
  })

  it('groups pieces of one kind that hit the limit in the same second', () => {
    // With one server down, 900 req/s over two servers is 450 each: above 400.
    expect(at(6)).toContain('2 servidores passaram do limite e começaram a descartar requisições.')
  })

  it('reports a piece running hot before it drops', () => {
    // 900 over three servers is 300 each (75%); the db at 900 of 1000 is 90%.
    expect(events.some((e) => e.text.startsWith('Banco de dados passou de 90%'))).toBe(false)
    const hotDb = timeline(a, runLevel(a, { ...spike, traffic: [{ from: 0, rps: 950 }], failures: [] }).ticks)
    expect(hotDb.map((e) => e.text)).toContain('Banco de dados passou de 90% de utilização; a fila começa a crescer.')
  })

  it('reports missing connections', () => {
    const broken = arch([['client', 'server']])
    const texts = timeline(broken, runLevel(broken, spike).ticks).map((e) => e.text)
    expect(texts.some((t) => t.includes('falta uma ligação'))).toBe(true)
  })

  it('is sorted by second', () => {
    expect(events.map((e) => e.t)).toEqual([...events.map((e) => e.t)].sort((x, y) => x - y))
  })
})

describe('bottleneck', () => {
  it('points at the piece that refused load', () => {
    const a = lbServers(2, ['db'])
    expect(bottleneck(a, runLevel(a, { ...spike, failures: [] }).ticks)).toMatchObject({ kind: 'server', reason: 'drops' })
  })

  it('points at an offline piece with nothing to take over', () => {
    const a = arch([['client', 'server'], ['server', 'db']])
    const level = { ...spike, traffic: [{ from: 0, rps: 300 }] }
    expect(bottleneck(a, runLevel(a, level).ticks)).toMatchObject({ kind: 'server', reason: 'down' })
  })

  it('points at the rate limiter when it only turned users away', () => {
    const a = arch([['client', 'limiter'], ['limiter', 'server'], ['server', 'db']])
    const result = bottleneck(a, runLevel(a, { ...spike, traffic: [{ from: 0, rps: 600 }], failures: [] }).ticks)
    expect(result).toMatchObject({ kind: 'limiter', reason: 'limited' })
    expect(result!.lost).toBeCloseTo(10 * (600 - 0.8 * 400))
  })

  it('counts requests, not the extra work a bug puts on each of them', () => {
    const level = LEVELS.find((l) => l.id === 'pedidos-em-loop')!
    const { ticks } = runLevel(level.start!, level)
    const neck = bottleneck(level.start!, ticks)!
    expect(neck.kind).toBe('db')
    expect(neck.lost).toBeLessThan(ticks.reduce((s, t) => s + t.rps, 0))
  })

  it('falls back to the slowest piece when nothing was lost', () => {
    const a = lbServers(4, ['db'])
    const result = bottleneck(a, runLevel(a, { ...spike, traffic: [{ from: 0, rps: 300 }], failures: [] }).ticks)
    expect(result).toMatchObject({ kind: 'server', reason: 'latency', lost: 0 })
  })
})

describe('nodeName', () => {
  it('numbers pieces only when there are several of a kind', () => {
    const a = lbServers(2, ['db'])
    expect(nodeName(a, 'server#1')).toBe('servidor 2')
    expect(nodeName(a, 'db')).toBe('banco de dados')
  })
})

describe('alternatives', () => {
  it('every level has at least one commented alternative', () => {
    for (const level of LEVELS) expect(ALTERNATIVES[level.id]?.length ?? 0).toBeGreaterThan(0)
  })
})
