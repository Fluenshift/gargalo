import { describe, expect, it } from 'vitest'
import { LEVELS } from '../levels'
import { mulberry32, runLevel, simulateTick } from './engine'
import { canConnect } from './model'
import type { Architecture, Kind, Level } from './model'

/** Builds an architecture from `kind#n` names, e.g. chain('client', 'server#1'). */
function arch(edges: [string, string][], extra: string[] = []): Architecture {
  const ids = new Set([...edges.flat(), ...extra])
  return {
    nodes: [...ids].map((id) => ({ id, kind: id.split('#')[0] as Kind })),
    edges: edges.map(([source, target]) => ({ source, target })),
  }
}

function fanOut(servers: number, downstream: string, front: [string, string][] = []): Architecture {
  const edges: [string, string][] = [...front]
  for (let i = 0; i < servers; i++) {
    edges.push(['lb', `server#${i}`], [`server#${i}`, downstream])
  }
  return arch(edges)
}

const steady: Level = {
  id: 't',
  title: 't',
  briefing: '',
  durationS: 10,
  mix: { static: 0, read: 1, write: 0 },
  traffic: [{ from: 0, rps: 800 }],
  failures: [],
  goals: { minAvailability: 0.99, maxP99Ms: 1000, maxCost: 10_000 },
}

const byId = (id: string) => LEVELS.find((l) => l.id === id)!

describe('simulateTick', () => {
  it('drops the load above a node capacity', () => {
    const tick = simulateTick(arch([['client', 'server'], ['server', 'db']]), steady, 0, mulberry32(1))
    expect(tick.nodes.server.dropRate).toBeCloseTo(0.5)
    expect(tick.failed.overload).toBeCloseTo(400 + 0) // server drops 400; db gets 400 < 1000
    expect(tick.served).toBeCloseTo(400)
  })

  it('fails requests that have nowhere to go', () => {
    const tick = simulateTick(arch([['client', 'server']]), steady, 0, mulberry32(1))
    expect(tick.failed.noRoute).toBeCloseTo(400)
  })

  it('load balancer routes around a crashed server', () => {
    const level: Level = { ...steady, failures: [{ kind: 'server', index: 0, from: 0, to: 5 }] }
    const a = fanOut(3, 'db', [['client', 'lb']])
    const tick = simulateTick(a, level, 0, mulberry32(1))
    expect(tick.nodes['server#0'].down).toBe(true)
    expect(tick.nodes['server#0'].load).toBe(0)
    expect(tick.nodes['server#1'].load).toBeCloseTo(400)
    expect(tick.failed.down).toBe(0)
  })

  it('cache absorbs reads before the database', () => {
    const tick = simulateTick(
      arch([['client', 'server'], ['server', 'cache'], ['cache', 'db']]),
      { ...steady, traffic: [{ from: 0, rps: 300 }] },
      0,
      mulberry32(1),
    )
    expect(tick.nodes.db.load).toBeCloseTo(300 * 0.15)
  })

  it('latency grows with utilization', () => {
    const light = simulateTick(arch([['client', 'server'], ['server', 'db']]), { ...steady, traffic: [{ from: 0, rps: 100 }] }, 0, mulberry32(1))
    const heavy = simulateTick(arch([['client', 'server'], ['server', 'db']]), { ...steady, traffic: [{ from: 0, rps: 380 }] }, 0, mulberry32(1))
    expect(heavy.p99Ms).toBeGreaterThan(light.p99Ms * 2)
  })

  it('is deterministic for a seed', () => {
    const a = fanOut(3, 'db', [['client', 'lb']])
    expect(runLevel(a, steady, 7).summary).toEqual(runLevel(a, steady, 7).summary)
  })
})

describe('canConnect', () => {
  const a = arch([['client', 'lb']], ['server', 'db', 'cdn'])
  it('enforces allowed targets and max outputs', () => {
    expect(canConnect(a, 'lb', 'server')).toBe(true)
    expect(canConnect(a, 'db', 'server')).toBe(false)
    expect(canConnect(a, 'client', 'cdn')).toBe(false) // client already points somewhere
    expect(canConnect(a, 'client', 'lb')).toBe(false) // duplicate
  })
})

describe('levels', () => {
  const cases: [string, boolean, Architecture][] = [
    ['primeiro-deploy', false, arch([['client', 'server'], ['server', 'db']])],
    ['primeiro-deploy', true, fanOut(4, 'db', [['client', 'lb']])],
    ['banco-nao-aguenta', false, fanOut(6, 'db', [['client', 'lb']])],
    ['banco-nao-aguenta', true, fanOut(7, 'cache', [['client', 'lb'], ['cache', 'db']])],
    ['black-friday', false, fanOut(10, 'cache', [['client', 'lb'], ['cache', 'db']])],
    ['black-friday', true, fanOut(8, 'cache', [['client', 'cdn'], ['cdn', 'lb'], ['cache', 'db']])],
  ]
  it.each(cases)('%s: design passes = %s', (id, shouldPass, a) => {
    const { summary } = runLevel(a, byId(id))
    console.log(id, shouldPass, a.nodes.length, JSON.stringify(summary))
    expect(summary.passed.all).toBe(shouldPass)
  })
})
