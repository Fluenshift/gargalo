import { describe, expect, it } from 'vitest'
import { LEVELS } from '../levels'
import { latencyPercentiles, mulberry32, runLevel, simulateTick } from './engine'
import { QUEUE_MAX_BACKLOG, SPECS, canConnect } from './model'
import type { Architecture, Kind, Level, Spec } from './model'

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

describe('latency percentiles', () => {
  it('reads p50, p95 and p99 from the samples', () => {
    const values = Array.from({ length: 100 }, (_, i) => 100 - i)
    expect(latencyPercentiles(values)).toEqual({ p50Ms: 51, p95Ms: 96, p99Ms: 100 })
  })

  it('is zero without samples', () => {
    expect(latencyPercentiles([])).toEqual({ p50Ms: 0, p95Ms: 0, p99Ms: 0 })
  })

  it('are ordered in every second and for the run', () => {
    const a = arch([['client', 'server'], ['server', 'db']])
    const { ticks, summary } = runLevel(a, steady, 3)
    for (const p of [...ticks, summary]) {
      expect(p.p50Ms).toBeGreaterThan(0)
      expect(p.p50Ms).toBeLessThanOrEqual(p.p95Ms)
      expect(p.p95Ms).toBeLessThanOrEqual(p.p99Ms)
    }
    expect(summary.p99Ms).toBe(latencyPercentiles(ticks.flatMap((t) => t.latencies)).p99Ms)
  })

  it('gives each node its mean latency, growing with utilization', () => {
    const a = arch([['client', 'server'], ['server', 'db']])
    const light = simulateTick(a, { ...steady, traffic: [{ from: 0, rps: 40 }] }, 0, mulberry32(1))
    const heavy = simulateTick(a, { ...steady, traffic: [{ from: 0, rps: 380 }] }, 0, mulberry32(1))
    expect(light.nodes.server.latencyMs).toBeGreaterThanOrEqual(SPECS.server.baseLatencyMs)
    expect(heavy.nodes.server.latencyMs).toBeGreaterThan(light.nodes.server.latencyMs * 2)
  })
})

describe('custom pieces', () => {
  // A toy piece that only exists here: it handles up to 200 writes/s and keeps
  // the rest for the next second instead of dropping them.
  const buffer: Spec = {
    label: 'Buffer',
    capacity: 200,
    baseLatencyMs: 1,
    cost: 10,
    serves: {},
    targets: ['db'],
    maxOut: 1,
    description: '',
    step: (arriving, state) => {
      const total = arriving.write + (state?.backlog ?? 0)
      const load = Math.min(total, 200)
      return { load: { ...arriving, write: load }, state: { backlog: total - load } }
    },
  }
  const burst: Level = {
    ...steady,
    durationS: 2,
    mix: { static: 0, read: 0, write: 1 },
    traffic: [{ from: 0, rps: 300 }, { from: 1, rps: 0 }],
  }

  it('runs through the engine and carries load to the next second', () => {
    const { ticks, summary } = runLevel(arch([['client', 'buffer'], ['buffer', 'db']]), burst, 1, { ...SPECS, buffer })
    expect(ticks[0].nodes.db.load).toBeCloseTo(200)
    expect(ticks[1].nodes.db.load).toBeCloseTo(100)
    expect(summary.failed.overload).toBe(0)
    expect(summary.availability).toBeCloseTo(1)
    expect(summary.cost).toBe(SPECS.db.cost + 10)
  })
})

describe('message queue and workers', () => {
  /** lb → `servers` servers → one queue → `workers` workers → db. */
  const queued = (servers: number, workers: number, extra: [string, string][] = []): Architecture => {
    const edges: [string, string][] = [['client', 'lb'], ...extra]
    for (let i = 0; i < servers; i++) edges.push(['lb', `server#${i}`], [`server#${i}`, 'queue'])
    for (let i = 0; i < workers; i++) edges.push(['queue', `worker#${i}`], [`worker#${i}`, 'db'])
    return arch(edges)
  }
  const writes = (traffic: Level['traffic'], durationS = 60): Level => ({
    ...steady,
    durationS,
    mix: { static: 0, read: 0, write: 1 },
    traffic,
  })
  // 10 s at three times the usual writes, then back to normal.
  const spike = writes([{ from: 0, rps: 600 }, { from: 10, rps: 1800 }, { from: 20, rps: 600 }])

  it('absorbs a write spike the database alone would drop', () => {
    const direct = runLevel(fanOut(5, 'db', [['client', 'lb']]), spike)
    expect(direct.summary.failed.overload).toBeGreaterThan(0)
    expect(direct.summary.passed.availability).toBe(false)

    const { ticks, summary } = runLevel(queued(5, 5), spike)
    expect(summary.failed).toEqual({ overload: 0, down: 0, noRoute: 0 })
    expect(summary.availability).toBeCloseTo(1)
    // The database never sees the spike: the workers (5 × 200/s) cap what reaches it.
    for (const t of ticks) expect(t.nodes.db.load).toBeLessThanOrEqual(1000 + 1e-6)
    // The backlog builds during the spike and empties afterwards.
    const peak = Math.max(...ticks.map((t) => t.nodes.queue.backlog!))
    expect(peak).toBeCloseTo(800 * 10)
    expect(summary.backlogAtEnd).toBe(0)
    expect(summary.async.lost).toBe(0)
    expect(summary.async.done).toBeCloseTo(spike.durationS * 600 + 10 * 1200)
  })

  it('answers writes on acceptance, so they skip the workers and the database', () => {
    const direct = runLevel(fanOut(5, 'db', [['client', 'lb']]), writes([{ from: 0, rps: 600 }], 10))
    const viaQueue = runLevel(queued(5, 5), writes([{ from: 0, rps: 600 }], 10))
    expect(viaQueue.summary.p99Ms).toBeLessThan(direct.summary.p99Ms)
  })

  it('overflows when the workers are too few, and the wait grows', () => {
    const { ticks, summary } = runLevel(queued(5, 2), writes([{ from: 0, rps: 1500 }]))
    // 1500 in, 400 out: 1100 more per second, so the 20.000 slots fill near second 18.
    expect(ticks[15].nodes.queue.dropRate).toBe(0)
    expect(ticks[20].nodes.queue.backlog).toBeCloseTo(QUEUE_MAX_BACKLOG)
    expect(ticks[20].nodes.queue.dropRate).toBeCloseTo(1100 / 1500)
    expect(ticks[20].nodes.queue.waitMs).toBeCloseTo((QUEUE_MAX_BACKLOG / 400) * 1000)
    expect(summary.failed.overload).toBeGreaterThan(0)
    expect(summary.passed.availability).toBe(false)
    expect(summary.backlogAtEnd).toBeCloseTo(QUEUE_MAX_BACKLOG)
  })

  it('never drains without workers', () => {
    const { ticks } = runLevel(queued(2, 0), writes([{ from: 0, rps: 300 }], 5))
    expect(ticks[4].nodes.queue.backlog).toBeCloseTo(1500)
    expect(ticks[4].nodes.queue.waitMs).toBe(Infinity)
  })

  it('counts work lost after the answer apart from user failures', () => {
    const a = queued(2, 2)
    a.edges = a.edges.filter((e) => e.target !== 'db')
    a.nodes = a.nodes.filter((n) => n.id !== 'db')
    const { summary } = runLevel(a, writes([{ from: 0, rps: 300 }], 5))
    expect(summary.availability).toBeCloseTo(1)
    expect(summary.failed.noRoute).toBe(0)
    expect(summary.async.lost).toBeCloseTo(5 * 300)
  })

  it('takes only writes; reads keep going to the database', () => {
    const level: Level = { ...steady, mix: { static: 0, read: 0.5, write: 0.5 }, traffic: [{ from: 0, rps: 300 }] }
    const tick = simulateTick(
      arch([['client', 'server'], ['server', 'db'], ['server', 'queue'], ['queue', 'worker'], ['worker', 'db']]),
      level,
      0,
      mulberry32(1),
    )
    expect(tick.edges['server->db']).toBeCloseTo(150)
    expect(tick.edges['server->queue']).toBeCloseTo(150)
    expect(tick.served).toBeCloseTo(300)
  })

  it('a crashed queue refuses writes and keeps its backlog for later', () => {
    const level: Level = { ...writes([{ from: 0, rps: 300 }], 6), failures: [{ kind: 'queue', index: 0, from: 2, to: 4 }] }
    const { ticks, summary } = runLevel(queued(1, 0), level)
    expect(ticks[2].failed.down).toBeCloseTo(300)
    expect(summary.backlogAtEnd).toBeCloseTo(4 * 300)
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
