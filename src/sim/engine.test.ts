import { describe, expect, it } from 'vitest'
import { BLACK_FRIDAY, LEVELS } from '../levels'
import { latencyPercentiles, mulberry32, runLevel, simulateTick } from './engine'
import { QUEUE_MAX_BACKLOG, REPLICA_BASE_LAG_MS, LIMITER_HEADROOM, PER_CLIENT_LIMIT, SPECS, canConnect, connectRefusal } from './model'
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

const byId = (id: string) => [...LEVELS, BLACK_FRIDAY].find((l) => l.id === id)!

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
    expect(summary.failed).toEqual({ overload: 0, down: 0, noRoute: 0, limited: 0 })
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

describe('read replicas', () => {
  /** lb → `servers` servers, each to the primary and to every replica; the primary feeds the replicas. */
  const replicated = (servers: number, replicas: number, feed = true): Architecture => {
    const edges: [string, string][] = [['client', 'lb']]
    for (let i = 0; i < servers; i++) {
      edges.push(['lb', `server#${i}`], [`server#${i}`, 'db'])
      for (let r = 0; r < replicas; r++) edges.push([`server#${i}`, `replica#${r}`])
    }
    if (feed) for (let r = 0; r < replicas; r++) edges.push(['db', `replica#${r}`])
    return arch(edges)
  }
  const mixed = (rps: number, write: number, durationS = 10): Level => ({
    ...steady,
    durationS,
    mix: { static: 0, read: 1 - write, write },
    traffic: [{ from: 0, rps }],
  })

  it('sends reads to the replicas and writes to the primary, which copies them over', () => {
    const tick = simulateTick(replicated(4, 2), mixed(1500, 0.2), 0, mulberry32(1))
    expect(tick.nodes.db.load).toBeCloseTo(300)
    expect(tick.nodes['replica#0'].load).toBeCloseTo(600 + 300)
    expect(tick.edges['db->replica#1']).toBeCloseTo(300)
    expect(tick.edges['server#0->replica#0']).toBeCloseTo(150)
    // Replication is background work: the users got exactly what they asked for.
    expect(tick.served).toBeCloseTo(1500)
    expect(tick.servedByClass.read).toBeCloseTo(1200)
    expect(tick.async.done).toBeCloseTo(2 * 300)
  })

  it('takes the reads off the primary: same traffic, one database would drop', () => {
    expect(runLevel(fanOut(4, 'db', [['client', 'lb']]), mixed(1500, 0.2)).summary.failed.overload).toBeGreaterThan(0)
    expect(runLevel(replicated(4, 2), mixed(1500, 0.2)).summary.failed.overload).toBe(0)
  })

  it('cache misses go to the replicas, cache writes to the primary', () => {
    const a = arch([['client', 'server'], ['server', 'cache'], ['cache', 'db'], ['cache', 'replica'], ['db', 'replica']])
    const tick = simulateTick(a, mixed(300, 0.5), 0, mulberry32(1))
    expect(tick.edges['cache->replica']).toBeCloseTo(150 * 0.15)
    expect(tick.edges['cache->db']).toBeCloseTo(150)
  })

  it('lags more, and serves more stale reads, under heavier writes', () => {
    const light = runLevel(replicated(4, 2), mixed(1500, 0.05))
    const heavy = runLevel(replicated(4, 2), mixed(1500, 0.2))
    const lag = (r: typeof light) => r.ticks[5].nodes['replica#0'].lagMs!
    expect(lag(light)).toBeGreaterThan(REPLICA_BASE_LAG_MS)
    expect(lag(heavy)).toBeGreaterThan(lag(light) * 1.5)
    expect(light.summary.staleReadRate).toBeLessThan(0.01)
    expect(heavy.summary.staleReadRate).toBeGreaterThan(light.summary.staleReadRate * 5)
    expect(heavy.summary.staleReadRate).toBeCloseTo(heavy.ticks[5].nodes['replica#0'].staleRate!)
  })

  it('falls further behind every second when reads leave no room to apply writes', () => {
    // One replica takes 1.000 reads/s: its whole capacity.
    const { ticks } = runLevel(replicated(4, 1), mixed(1250, 0.2))
    const lags = ticks.map((t) => t.nodes['replica#0'].lagMs!)
    for (let i = 1; i < lags.length; i++) expect(lags[i]).toBeGreaterThan(lags[i - 1])
    expect(ticks.at(-1)!.nodes['replica#0'].staleRate).toBeGreaterThan(0.5)
  })

  it('a replica the primary does not feed only has old data', () => {
    const { ticks, summary } = runLevel(replicated(4, 2, false), mixed(1500, 0.2))
    expect(ticks[0].nodes['replica#0'].lagMs).toBe(Infinity)
    expect(summary.staleReadRate).toBeCloseTo(1)
  })

  it('a level can cap the stale reads', () => {
    const strict: Level = { ...mixed(1500, 0.2), goals: { ...steady.goals, maxStaleReads: 0.02 } }
    const { summary } = runLevel(replicated(5, 2), strict)
    expect(summary.passed.availability).toBe(true)
    expect(summary.passed.stale).toBe(false)
    expect(summary.passed.all).toBe(false)
    expect(runLevel(replicated(5, 2), { ...strict, mix: { static: 0, read: 0.95, write: 0.05 } }).summary.passed.all).toBe(true)
  })
})

describe('rate limiter', () => {
  // Two servers take 800 req/s; the spike asks for 1.500.
  const spike: Level = {
    ...steady,
    traffic: [
      { from: 0, rps: 400 },
      { from: 3, rps: 1500 },
    ],
  }
  const unprotected = fanOut(2, 'db', [['client', 'lb']])
  const limited = fanOut(2, 'db', [['client', 'limiter'], ['limiter', 'lb']])

  it('turns a spike into fast 429s instead of overloaded servers', () => {
    const without = runLevel(unprotected, spike).summary
    const withLimiter = runLevel(limited, spike).summary
    expect(without.failed.overload).toBeGreaterThan(1000)
    expect(without.failed.limited).toBe(0)
    expect(withLimiter.failed.overload).toBeLessThan(1)
    expect(withLimiter.failed.limited).toBeGreaterThan(1000)
    // Servers kept below the limit answer fast; overloaded ones queue.
    expect(withLimiter.p99Ms).toBeLessThan(without.p99Ms / 2)
  })

  it('lets through a share of what the servers behind the load balancer take', () => {
    const tick = simulateTick(limited, spike, 5, mulberry32(1))
    // 80% of 2 × 400 req/s.
    expect(tick.nodes['server#0'].load + tick.nodes['server#1'].load).toBeCloseTo(LIMITER_HEADROOM * 800)
    expect(tick.failed.limited).toBeCloseTo(1500 - LIMITER_HEADROOM * 800)
    expect(tick.nodes.limiter.refused).toBeCloseTo(1500 - LIMITER_HEADROOM * 800)
    expect(tick.nodes.limiter.dropRate).toBeCloseTo(0)
  })

  it('refuses more when a server behind it goes down', () => {
    const outage = { ...spike, traffic: [{ from: 0, rps: 600 }], failures: [{ kind: 'server' as const, index: 0, from: 0, to: 10 }] }
    const tick = simulateTick(limited, outage, 0, mulberry32(1))
    expect(tick.failed.limited).toBeCloseTo(600 - LIMITER_HEADROOM * 400)
    expect(tick.failed.down).toBeCloseTo(0)
  })

  it('with nothing behind it, leaves the missing link to show as a missing link', () => {
    const tick = simulateTick(arch([['client', 'limiter']]), steady, 0, mulberry32(1))
    expect(tick.failed.limited).toBe(0)
    expect(tick.failed.noRoute).toBeCloseTo(800)
  })
})

describe('bot traffic', () => {
  // 300 req/s from people and 1.500 from one scraper.
  const scraped: Level = { ...steady, traffic: [{ from: 0, rps: 300 }], bot: [{ from: 0, rps: 1500 }] }

  it('loads the servers but never counts for availability', () => {
    const tick = simulateTick(fanOut(2, 'db', [['client', 'lb']]), scraped, 0, mulberry32(1))
    expect(tick.rps).toBe(300)
    expect(tick.botRps).toBe(1500)
    // 1.800 req/s on 800 of capacity: the people lose more than half.
    expect(tick.served / tick.rps).toBeCloseTo(800 / 1800)
    expect(tick.failed.overload).toBeCloseTo(300 * (1 - 800 / 1800))
  })

  it('a per-client limit at the gateway or the rate limiter keeps the bot out', () => {
    const gateway = arch([['client', 'gateway'], ['gateway', 'server#0'], ['gateway', 'server#1'], ['server#0', 'db'], ['server#1', 'db']])
    const limiter = fanOut(2, 'db', [['client', 'limiter'], ['limiter', 'lb']])
    for (const a of [gateway, limiter]) {
      const { summary, ticks } = runLevel(a, scraped)
      expect(summary.availability).toBe(1)
      expect(summary.failed.limited).toBe(0)
      expect(ticks[0].nodes['server#0'].load).toBeCloseTo((300 + PER_CLIENT_LIMIT) / 2)
    }
  })

  it('reads like a user read: the cache answers most of it', () => {
    const cached = arch([['client', 'server'], ['server', 'cache'], ['cache', 'db']])
    const tick = simulateTick(cached, { ...scraped, traffic: [{ from: 0, rps: 0 }], bot: [{ from: 0, rps: 300 }] }, 0, mulberry32(1))
    expect(tick.nodes.db.load).toBeCloseTo(300 * 0.15)
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

describe('connectRefusal', () => {
  const a = arch([['client', 'lb']], ['server', 'db', 'cdn'])
  it('allows what canConnect allows', () => {
    expect(connectRefusal(a, 'lb', 'server')).toBeNull()
  })

  it('points users who want two servers at the load balancer', () => {
    const direct = arch([['client', 'server#0']], ['server#1'])
    expect(connectRefusal(direct, 'client', 'server#1')).toMatch(/DNS.*Load Balancer/)
  })

  it('names where a piece can go when the kind is wrong', () => {
    expect(connectRefusal(a, 'client', 'db')).toBe(
      'Não dá para ligar Usuários a Banco de dados. Daqui só se chega a CDN, Rate limiter, API Gateway, Load Balancer ou Servidor.',
    )
  })

  it('explains duplicates', () => {
    expect(connectRefusal(a, 'client', 'lb')).toBe('Essas duas peças já estão ligadas.')
  })
})

describe('levels', () => {
  const cases: [string, boolean, Architecture][] = [
    // A server alone keeps nothing: reads and writes have nowhere to go.
    ['colocar-no-ar', false, arch([['client', 'server']])],
    // Built for traffic that has not come yet: over the budget.
    ['colocar-no-ar', false, fanOut(2, 'db', [['client', 'lb']])],
    ['colocar-no-ar', true, arch([['client', 'server'], ['server', 'db']])],
    ['primeiro-deploy', false, arch([['client', 'server'], ['server', 'db']])],
    ['primeiro-deploy', true, fanOut(4, 'db', [['client', 'lb']])],
    ['banco-nao-aguenta', false, fanOut(6, 'db', [['client', 'lb']])],
    ['banco-nao-aguenta', true, fanOut(7, 'cache', [['client', 'lb'], ['cache', 'db']])],
    // Servers for the images: as many as the budget pays still drop half the traffic.
    ['imagens-pesadas', false, fanOut(4, 'cache', [['client', 'lb'], ['cache', 'db']])],
    ['imagens-pesadas', true, fanOut(4, 'cache', [['client', 'cdn'], ['cdn', 'lb'], ['cache', 'db']])],
    // One server, alone or behind a balancer, is a single point of failure.
    ['caiu-de-madrugada', false, arch([['client', 'server'], ['server', 'db']])],
    ['caiu-de-madrugada', false, fanOut(1, 'db', [['client', 'lb']])],
    ['caiu-de-madrugada', true, fanOut(2, 'db', [['client', 'lb']])],
    // Six servers hold the peak, but when one falls the other five run too hot.
    ['materia-na-tv', false, fanOut(6, 'cache', [['client', 'cdn'], ['cdn', 'lb'], ['cache', 'db']])],
    // No CDN: the images alone sink the servers.
    ['materia-na-tv', false, fanOut(9, 'cache', [['client', 'lb'], ['cache', 'db']])],
    ['materia-na-tv', true, fanOut(7, 'cache', [['client', 'cdn'], ['cdn', 'lb'], ['cache', 'db']])],
    // Out of the career until the E-commerce company (#15); kept tuned for it.
    ['black-friday', false, fanOut(10, 'cache', [['client', 'lb'], ['cache', 'db']])],
    ['black-friday', true, fanOut(8, 'cache', [['client', 'cdn'], ['cdn', 'lb'], ['cache', 'db']])],
  ]
  it.each(cases)('%s: design passes = %s', (id, shouldPass, a) => {
    const { summary } = runLevel(a, byId(id))
    console.log(id, shouldPass, a.nodes.length, JSON.stringify(summary))
    expect(summary.passed.all).toBe(shouldPass)
  })
})
