import { describe, expect, it } from 'vitest'
import { BLACK_FRIDAY, LEVELS, STARTUP_LEGACY } from '../levels'
import { latencyPercentiles, mulberry32, retryOutcome, runLevel, simulateTick } from './engine'
import type { TickResult } from './engine'
import { PROTOCOLS, QUEUE_MAX_BACKLOG, REGION_RTT_MS, REPLICA_BASE_LAG_MS, LIMITER_HEADROOM, PER_CLIENT_LIMIT, SPECS, balanceOf, canConnect, canSetBalance, connectRefusal, instanceCapacity, protocolRefusal } from './model'
import type { ArchEdge, Architecture, CodeChallenge, Kind, Level, Protocol, Region, Spec } from './model'

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
    expect(summary.failed).toEqual({ overload: 0, down: 0, noRoute: 0, limited: 0, breaker: 0 })
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

describe('retries and circuit breakers', () => {
  // Five servers in front of one database (1.000 req/s): a 20-second rush of 1.200 reads, then calm.
  const rush: Level = {
    ...steady,
    durationS: 40,
    traffic: [
      { from: 0, rps: 600 },
      { from: 5, rps: 1200 },
      { from: 25, rps: 600 },
    ],
  }
  const withPolicy = (policy: Partial<ArchEdge>): Architecture => {
    const a = fanOut(5, 'db', [['client', 'lb']])
    return { ...a, edges: a.edges.map((e) => (e.target === 'db' ? { ...e, ...policy } : e)) }
  }
  const run = (policy: Partial<ArchEdge>) => runLevel(withPolicy(policy), rush)
  const secondsDown = (ticks: TickResult[]) => ticks.filter((t) => t.nodes.db.down).length
  /** Availability over the last ten seconds, well after the rush. */
  const lastAvailability = (ticks: TickResult[]) => {
    const tail = ticks.slice(-10)
    return tail.reduce((s, t) => s + t.served, 0) / tail.reduce((s, t) => s + t.rps, 0)
  }

  it('counts expected attempts and final success', () => {
    expect(retryOutcome(0.5, 3, false)).toEqual({ attempts: 1.875, success: 0.9375 })
    expect(retryOutcome(0.5, 3, true)).toEqual({ attempts: 1.5, success: 0.9375 })
    expect(retryOutcome(1, 3, false)).toEqual({ attempts: 1, success: 1 })
  })

  it('retries without backoff turn a slow database into a dead one', () => {
    const plain = run({})
    const storm = run({ retries: 3 })
    // Without retries the database sheds the excess and lives.
    expect(secondsDown(plain.ticks)).toBe(0)
    expect(lastAvailability(plain.ticks)).toBe(1)
    // Retries pile on, it crashes, and every time it comes back the backlog of retries takes it out again,
    // even after the rush is over.
    expect(secondsDown(storm.ticks)).toBeGreaterThan(20)
    expect(secondsDown(storm.ticks.slice(-10))).toBeGreaterThan(5)
    expect(lastAvailability(storm.ticks)).toBeLessThan(0.3)
    expect(storm.summary.availability).toBeLessThan(plain.summary.availability / 2)
  })

  it('with backoff, retries help instead', () => {
    const plain = run({})
    const backoff = run({ retries: 3, backoff: true })
    expect(secondsDown(backoff.ticks)).toBe(0)
    expect(backoff.summary.availability).toBeGreaterThan(plain.summary.availability)
  })

  it('a circuit breaker fails fast, lets the database recover and closes again', () => {
    const { ticks, summary } = run({ retries: 3, breaker: true })
    expect(summary.failed.breaker).toBeGreaterThan(0)
    expect(ticks.some((t) => Object.values(t.breakers).includes('open'))).toBe(true)
    expect(ticks.some((t) => Object.values(t.breakers).includes('half-open'))).toBe(true)
    // Back to normal once the rush ends: database up, breakers closed, everyone answered.
    expect(ticks.at(-1)!.nodes.db.down).toBe(false)
    expect(Object.keys(ticks.at(-1)!.breakers)).toEqual([])
    expect(lastAvailability(ticks)).toBe(1)
    expect(summary.availability).toBeGreaterThan(run({ retries: 3 }).summary.availability * 1.5)
  })

  it('links without a policy behave exactly as before', () => {
    const a = fanOut(5, 'db', [['client', 'lb']])
    expect(runLevel(withPolicy({ retries: 0, backoff: true, breaker: false }), rush).summary).toEqual(runLevel(a, rush).summary)
  })
})

describe('partitioned database', () => {
  /** lb → `servers` servers, each to every partition. */
  const sharded = (servers: number, shards: number): Architecture => {
    const edges: [string, string][] = [['client', 'lb']]
    for (let i = 0; i < servers; i++) {
      edges.push(['lb', `server#${i}`])
      for (let s = 0; s < shards; s++) edges.push([`server#${i}`, `shard#${s}`])
    }
    return arch(edges)
  }
  // Writes a single database (1.000 req/s) cannot take.
  const writes = (hotKey?: number): Level => ({
    ...steady,
    mix: { static: 0, read: 0.4, write: 0.6 },
    traffic: [{ from: 0, rps: 2400 }],
    ...(hotKey === undefined ? {} : { hotKey }),
  })

  it('takes reads and writes, and each partition adds capacity', () => {
    expect(runLevel(fanOut(7, 'db', [['client', 'lb']]), writes()).summary.passed.availability).toBe(false)
    const { summary, ticks } = runLevel(sharded(7, 3), writes())
    expect(summary.passed.availability).toBe(true)
    for (let s = 0; s < 3; s++) expect(ticks[0].nodes[`shard#${s}`].load).toBeCloseTo(800)
  })

  it('a hot key takes down one partition while the others have room to spare', () => {
    const { summary, ticks } = runLevel(sharded(7, 3), writes(0.5))
    // The first partition gets the hot half plus its third of the rest: 1.600 req/s.
    expect(ticks[0].nodes['shard#0'].load).toBeCloseTo(1600)
    expect(ticks[0].nodes['shard#1'].load).toBeCloseTo(400)
    expect(ticks[0].nodes['shard#1'].utilization).toBeLessThan(0.5)
    expect(summary.passed.availability).toBe(false)
  })

  it('more partitions do not cool a hot key', () => {
    const three = runLevel(sharded(7, 3), writes(0.5)).ticks[0].nodes['shard#0'].load
    const four = runLevel(sharded(7, 4), writes(0.5)).ticks[0].nodes['shard#0'].load
    expect(four).toBeGreaterThan(1000)
    expect(three - four).toBeLessThan(250)
  })

  it('a partition that goes down loses its own keys only', () => {
    const level: Level = { ...writes(), failures: [{ kind: 'shard', index: 1, from: 0, to: 10 }] }
    const tick = runLevel(sharded(7, 3), level).ticks[0]
    expect(tick.failed.down).toBeCloseTo(800)
    expect(tick.served).toBeCloseTo(1600)
  })

  it('hangs below servers, caches and workers, never above them', () => {
    const a = arch([['client', 'server']], ['cache', 'worker', 'shard', 'db'])
    expect(canConnect(a, 'server', 'shard')).toBe(true)
    expect(canConnect(a, 'cache', 'shard')).toBe(true)
    expect(canConnect(a, 'worker', 'shard')).toBe(true)
    expect(canConnect(a, 'shard', 'db')).toBe(false)
    expect(canConnect(a, 'shard', 'server')).toBe(false)
  })
})

describe('regions', () => {
  /** Puts the named nodes in `region`; the rest stay in the home region. */
  const placed = (a: Architecture, region: Region, ids: string[]): Architecture => ({
    ...a,
    nodes: a.nodes.map((n) => (ids.includes(n.id) ? { ...n, region } : n)),
  })
  /** One stack per region behind a geographic DNS: lb → 3 servers → cache; reads end on the primary in São Paulo or a local replica. */
  const twoRegions = (): Architecture => {
    const edges: [string, string][] = [['client', 'dns'], ['dns', 'lb#sa'], ['dns', 'lb#us'], ['cache#sa', 'db'], ['cache#us', 'replica#us'], ['db', 'replica#us']]
    for (const r of ['sa', 'us']) for (let i = 0; i < 3; i++) edges.push([`lb#${r}`, `server#${r}${i}`], [`server#${r}${i}`, `cache#${r}`])
    const a = arch(edges)
    const us = a.nodes.filter((n) => n.id.includes('#us')).map((n) => n.id)
    return placed(a, 'us', us)
  }
  const reads: Level = { ...steady, durationS: 30, traffic: [{ from: 0, rps: 800 }], users: { sa: 0.5, us: 0.5 } }

  it('a call across regions pays the round trip', () => {
    const local = runLevel(arch([['client', 'server'], ['server', 'db']]), steady).summary
    const far = runLevel(arch([['client', 'server'], ['server', 'db']]), { ...steady, users: { eu: 1 } }).summary
    expect(far.p50Ms - local.p50Ms).toBeCloseTo(REGION_RTT_MS.eu.sa, -1)
    const split = placed(arch([['client', 'server'], ['server', 'db']]), 'us', ['db'])
    expect(runLevel(split, steady).summary.p50Ms - local.p50Ms).toBeCloseTo(REGION_RTT_MS.sa.us, -1)
  })

  it('a geographic DNS sends each region its own users', () => {
    const tick = runLevel(twoRegions(), reads).ticks[0]
    expect(tick.nodes['lb#sa'].load).toBeCloseTo(400)
    expect(tick.nodes['lb#us'].load).toBeCloseTo(400)
    const oneRegion = placed(twoRegions(), 'sa', twoRegions().nodes.map((n) => n.id))
    expect(runLevel(twoRegions(), reads).summary.p99Ms).toBeLessThan(runLevel({ ...oneRegion, edges: oneRegion.edges }, { ...reads, users: { us: 1 } }).summary.p99Ms)
  })

  it('fails over when a whole region goes dark', () => {
    const outage: Level = { ...reads, regionOutages: [{ region: 'sa', from: 10, to: 20 }] }
    const { ticks, summary } = runLevel(twoRegions(), outage)
    expect(ticks[15].nodes['lb#sa'].down).toBe(true)
    expect(ticks[15].nodes['lb#us'].load).toBeCloseTo(800)
    expect(summary.passed.availability).toBe(true)
    // Everything in one region: the outage takes the whole site down.
    const single = fanOut(3, 'cache', [['client', 'lb'], ['cache', 'db']])
    expect(runLevel(single, outage).summary.passed.availability).toBe(false)
  })

  it('without a DNS, every user goes to the one place the users point at', () => {
    const outage: Level = { ...reads, regionOutages: [{ region: 'sa', from: 10, to: 20 }] }
    const a = { ...twoRegions(), edges: twoRegions().edges.map((e) => (e.source === 'client' ? { ...e, target: 'lb#sa' } : e)).filter((e) => e.source !== 'dns') }
    expect(runLevel(a, outage).summary.passed.availability).toBe(false)
  })
})

describe('protocols', () => {
  /** Sets the protocol of every link from a piece of kind `from` (e.g. 'lb'). */
  const speak = (a: Architecture, from: string, protocol: Protocol): Architecture => ({
    ...a,
    edges: a.edges.map((e) => (e.source.split('#')[0] === from ? { ...e, protocol } : e)),
  })
  const shop = fanOut(4, 'db', [['client', 'cdn'], ['cdn', 'lb']])
  const site: Level = { ...steady, mix: { static: 0.3, read: 0.6, write: 0.1 }, traffic: [{ from: 0, rps: 600 }] }

  it('REST is what every link speaks when none is set', () => {
    expect(runLevel(speak(shop, 'lb', 'rest'), site).summary).toEqual(runLevel(shop, site).summary)
  })

  it('gRPC between internal services cuts the latency without losing requests', () => {
    const rest = runLevel(shop, site).summary
    const grpc = runLevel(speak(shop, 'lb', 'grpc'), site).summary
    expect(grpc.availability).toBeCloseTo(rest.availability)
    expect(grpc.p50Ms).toBeLessThan(rest.p50Ms)
  })

  it('GraphQL from the browser keeps the CDN from caching API reads, so more reach the servers', () => {
    const load = (a: Architecture) => runLevel(a, site).ticks[5].edges['cdn->lb']
    const rest = load(shop)
    const graphql = load(speak(shop, 'client', 'graphql'))
    expect(graphql).toBeGreaterThan(rest)
    // Only the 10% of reads the CDN kept come back: static files are still cached.
    expect(graphql - rest).toBeCloseTo(600 * 0.6 * (SPECS.cdn.serves.read ?? 0), 0)
  })

  it('GraphQL answers reads in fewer round trips', () => {
    const direct = arch([['client', 'lb'], ['lb', 'server#0'], ['lb', 'server#1'], ['lb', 'server#2'], ['server#0', 'db'], ['server#1', 'db'], ['server#2', 'db']])
    const rest = runLevel(direct, site).summary
    const graphql = runLevel(speak(direct, 'client', 'graphql'), site).summary
    expect(graphql.p50Ms).toBeLessThan(rest.p50Ms)
  })

  it('a browser cannot speak gRPC, and only API pieces take a protocol', () => {
    expect(protocolRefusal('client', 'cdn', 'grpc')).toMatch(/navegador não fala gRPC/)
    expect(protocolRefusal('client', 'cdn', 'graphql')).toBeNull()
    expect(protocolRefusal('lb', 'server', 'grpc')).toBeNull()
    expect(protocolRefusal('server', 'db', 'rest')).toMatch(/não recebe chamadas de API/)
    expect(Object.keys(PROTOCOLS)).toEqual(['rest', 'graphql', 'grpc'])
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
      'Não dá para ligar Usuários a Banco de dados. Daqui só se chega a DNS geográfico, CDN, Rate limiter, API Gateway, Load Balancer ou Servidor.',
    )
  })

  it('explains duplicates', () => {
    expect(connectRefusal(a, 'client', 'lb')).toBe('Essas duas peças já estão ligadas.')
  })
})

/** `start` plus `edges` (new pieces named `kind#n`), minus the `drop` edges. */
function extend(
  start: Architecture,
  edges: [string, string, Partial<ArchEdge>?][],
  drop: [string, string][] = [],
  dropNodes: string[] = [],
): Architecture {
  const nodes = start.nodes.filter((n) => !dropNodes.includes(n.id))
  for (const [a, b] of edges)
    for (const id of [a, b]) if (!nodes.some((n) => n.id === id)) nodes.push({ id, kind: id.split('#')[0] as Kind })
  return {
    nodes,
    edges: [
      ...start.edges.filter(
        (e) => !drop.some(([s, t]) => s === e.source && t === e.target) && !dropNodes.includes(e.source) && !dropNodes.includes(e.target),
      ),
      ...edges.map(([source, target, p]) => ({ source, target, ...p })),
    ],
  }
}
/** `n` new servers behind the load balancer, each connected to `to`. */
const servers = (n: number, to = ['cache'], lb = 'lb', tag = ''): [string, string][] =>
  Array.from({ length: n }, (_, i) => [[lb, `server#${tag}${i}`] as [string, string], ...to.map((t) => [`server#${tag}${i}`, t] as [string, string])]).flat()
/** Moves the nodes whose id matches into `region`. */
const inRegion = (a: Architecture, region: Region, match: (id: string) => boolean): Architecture => ({
  ...a,
  nodes: a.nodes.map((n) => (match(n.id) ? { ...n, region } : n)),
})
/** Four more servers and `n` partitions in place of the database. */
const ledger = (n: number) =>
  extend(STARTUP_LEGACY, [...servers(4), ...Array.from({ length: n }, (_, i) => ['cache', `shard#${i}`] as [string, string])], [], ['db'])
/** A geographic DNS and a second stack in Frankfurt reading from a local replica; writes cross to the primary. */
const europe = () =>
  inRegion(
    extend(
      STARTUP_LEGACY,
      [
        ['client', 'dns'], ['dns', 'cdn'], ['dns', 'cdn#eu'], ['cdn#eu', 'lb#eu'], ...servers(3, ['cache#eu'], 'lb#eu', 'eu'),
        ['cache#eu', 'replica#eu'], ['cache#eu', 'db'], ['db', 'replica#eu'],
      ],
      [['client', 'cdn']],
    ),
    'eu',
    (id) => id.includes('#eu'),
  )
/** Two stacks behind a geographic DNS, `us` servers in Virginia, and the primary database in `primary`. */
const monthEnd = (primary: Region, us: number) =>
  inRegion(
    inRegion(
      extend(
        STARTUP_LEGACY,
        [
          ['client', 'dns'], ['dns', 'cdn'], ['dns', 'cdn#us'], ['cdn#us', 'lb#us'], ...servers(us, ['cache#us'], 'lb#us', 'us'),
          ['cache#us', 'db'], ...servers(2, ['cache'], 'lb', 'sa'), ['cache', 'replica#sa'], ['db', 'replica#sa'],
        ],
        [['client', 'cdn']],
      ),
      'us',
      (id) => id.includes('#us'),
    ),
    primary,
    (id) => id === 'db',
  )
const legacyTo = (target: string): [string, string][] =>
  STARTUP_LEGACY.nodes.filter((n) => n.kind === 'server').map((n) => [n.id, target])
const workers = (n: number): [string, string][] =>
  Array.from({ length: n }, (_, i) => [['queue', `worker#${i}`], [`worker#${i}`, 'db']] as [string, string][]).flat()
const replicas = (n: number): [string, string][] =>
  Array.from({ length: n }, (_, i) => [['cache', `replica#${i}`], ['db', `replica#${i}`]] as [string, string][]).flat()
const paymentPolicy = (a: Architecture, policy: Partial<ArchEdge>): Architecture => ({
  ...a,
  edges: a.edges.map((e) => (e.target === 'payment' ? { source: e.source, target: e.target, ...policy } : e)),
})
/** Six more servers, three replicas and one retry with backoff to the payment API, with or without a rate limiter. */
function blackFriday(limiter: boolean): Architecture {
  const policy = { retries: 1, backoff: true }
  const add: [string, string, Partial<ArchEdge>?][] = [
    ...servers(6),
    ...Array.from({ length: 6 }, (_, i) => [`server#${i}`, 'payment', policy] as [string, string, Partial<ArchEdge>]),
    ...replicas(3),
  ]
  if (limiter) add.push(['cdn', 'limiter'], ['limiter', 'lb'])
  return extend(paymentPolicy(BLACK_FRIDAY.start!, policy), add, limiter ? [['cdn', 'lb']] : [])
}

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
    // E-commerce, all starting from what the Startup left.
    // Orders waiting on the database: more servers do not help, a queue with workers does.
    ['checkout-travando', false, extend(STARTUP_LEGACY, servers(4))],
    ['checkout-travando', true, extend(STARTUP_LEGACY, [...servers(1, ['cache', 'queue']), ...legacyTo('queue'), ...workers(3)])],
    // The cache rarely hits: reads go to replicas; one alone lags behind.
    ['catalogo-gigante', false, extend(STARTUP_LEGACY, servers(2))],
    ['catalogo-gigante', false, extend(STARTUP_LEGACY, [...servers(2), ...replicas(1)])],
    ['catalogo-gigante', true, extend(STARTUP_LEGACY, [...servers(2), ...replicas(2)])],
    // The bot: servers cannot outgrow it, a per-client limit stops it.
    ['bot-de-precos', false, extend(STARTUP_LEGACY, servers(4))],
    ['bot-de-precos', true, extend(STARTUP_LEGACY, [['cdn', 'limiter'], ['limiter', 'lb']], [['cdn', 'lb']])],
    // The legacy three retries without backoff turn each payment outage into a storm.
    ['pagamento-instavel', false, byId('pagamento-instavel').start!],
    ['pagamento-instavel', true, paymentPolicy(byId('pagamento-instavel').start!, { retries: 1 })],
    // Black Friday: no limiter drowns the servers; the full design holds.
    ['black-friday', false, BLACK_FRIDAY.start!],
    ['black-friday', false, blackFriday(false)],
    ['black-friday', true, blackFriday(true)],
    // Fintech, all starting from a team like the Startup's.
    // Retries hide the flaky partner API but pay some transfers twice; an idempotency key stops that.
    ['transferencia-duplicada', false, byId('transferencia-duplicada').start!],
    ['transferencia-duplicada', false, paymentPolicy(byId('transferencia-duplicada').start!, { retries: 0 })],
    ['transferencia-duplicada', true, paymentPolicy(byId('transferencia-duplicada').start!, { retries: 2, idempotent: true })],
    // Writes outgrow one database; replicas only add reads, and the hot account needs a fourth partition.
    ['livro-razao', false, extend(STARTUP_LEGACY, [...servers(4), ...replicas(2)])],
    ['livro-razao', false, ledger(3)],
    ['livro-razao', true, ledger(4)],
    // Everything in São Paulo is 200 ms away from Frankfurt.
    ['clientes-na-europa', false, STARTUP_LEGACY],
    ['clientes-na-europa', true, europe()],
    // The primary in the region that falls stops the transfers; too few servers in Virginia drown in the failover.
    ['fechamento-do-mes', false, extend(STARTUP_LEGACY, servers(4))],
    ['fechamento-do-mes', false, monthEnd('sa', 8)],
    ['fechamento-do-mes', false, monthEnd('us', 5)],
    ['fechamento-do-mes', true, monthEnd('us', 8)],
  ]
  it.each(cases)('%s: design passes = %s', (id, shouldPass, a) => {
    const { summary } = runLevel(a, byId(id))
    console.log(id, shouldPass, a.nodes.length, JSON.stringify(summary))
    expect(summary.passed.all).toBe(shouldPass)
  })
})

describe('code challenges', () => {
  it('a bug multiplies the load a request puts on a piece and adds its time there', () => {
    const level: Level = {
      ...steady,
      code: [
        {
          id: 'bug',
          class: 'read',
          title: '',
          code: '',
          bug: [{ kinds: ['db'], classes: ['read'], factor: 3, extraMs: 50 }],
          options: [{ id: 'fix', label: '', code: '', fixes: true, explanation: '', work: [] }],
        },
      ],
    }
    const a = fanOut(3, 'db', [['client', 'lb']])
    const buggy = simulateTick(a, { ...level, traffic: [{ from: 0, rps: 300 }] }, 0, mulberry32(1))
    const fixed = simulateTick({ ...a, fixes: { bug: 'fix' } }, { ...level, traffic: [{ from: 0, rps: 300 }] }, 0, mulberry32(1))
    expect(buggy.nodes.db.load).toBeCloseTo(900)
    expect(fixed.nodes.db.load).toBeCloseTo(300)
    expect(buggy.p50Ms - fixed.p50Ms).toBeGreaterThan(40)
  })

  // The drawing as the level opens: only the code decides. Every right option passes, every wrong one fails.
  // Challenges that lock links or open a setting need a redrawn design, tested on their own below.
  for (const level of LEVELS.filter((l) => l.code?.every((ch) => !ch.locks && ch.options.every((o) => !o.settings)))) {
    const start = level.start ?? STARTUP_LEGACY
    for (const ch of level.code!) {
      it(`${level.id}: the bug fails on every seed`, () => {
        for (let seed = 1; seed <= 20; seed++) expect(runLevel(start, level, seed).summary.passed.all, `seed ${seed}`).toBe(false)
      })
      for (const option of ch.options) {
        it(`${level.id}: ${option.id} ${option.fixes ? 'passes' : 'fails'} on every seed`, () => {
          for (let seed = 1; seed <= 20; seed++) {
            const { summary } = runLevel({ ...start, fixes: { [ch.id]: option.id } }, level, seed)
            expect(summary.passed.all, `seed ${seed}`).toBe(option.fixes)
          }
        })
      }
    }
  }
})

describe('code that locks links', () => {
  const level = LEVELS.find((l) => l.id === 'replica-parada')!
  const ch = level.code![0]
  const servers = Array.from({ length: 8 }, (_, i) => `s${i}`)

  /** Eight servers behind a load balancer, reading through `reads` and writing to the primary. */
  function design(fix: string | undefined, reads: 'cache' | 'replica', replicas: number): Architecture {
    const rs = Array.from({ length: replicas }, (_, i) => `r${i}`)
    const nodes: Architecture['nodes'] = [
      { id: 'client', kind: 'client' },
      { id: 'lb', kind: 'lb' },
      { id: 'cache', kind: 'cache' },
      { id: 'db', kind: 'db' },
      ...servers.map((id) => ({ id, kind: 'server' as const })),
      ...rs.map((id) => ({ id, kind: 'replica' as const })),
    ]
    const edges: ArchEdge[] = [{ source: 'client', target: 'lb' }, ...rs.map((r) => ({ source: 'db', target: r }))]
    for (const s of servers) {
      edges.push({ source: 'lb', target: s })
      if (reads === 'cache') edges.push({ source: s, target: 'cache' })
      else edges.push({ source: s, target: 'db' }, ...rs.map((r) => ({ source: s, target: r })))
    }
    if (reads === 'cache') edges.push({ source: 'cache', target: 'db' }, ...rs.map((r) => ({ source: 'cache', target: r })))
    return { nodes, edges, ...(fix ? { fixes: { [ch.id]: fix } } : {}) }
  }

  it('refuses Servidor → Réplica with the reason until the code takes the dependency', () => {
    const a = design(undefined, 'cache', 1)
    expect(connectRefusal(a, 's0', 'r0', level)).toBe(ch.locks!.reason)
    expect(canConnect(a, 's0', 'r0', level)).toBe(false)
    expect(connectRefusal({ ...a, fixes: { [ch.id]: 'singleton' } }, 's0', 'r0', level)).toBe(ch.locks!.reason)
    expect(connectRefusal({ ...a, fixes: { [ch.id]: 'injecao' } }, 's0', 'r0', level)).toBeNull()
    // The if opens the replica but not the cache.
    expect(connectRefusal({ ...a, fixes: { [ch.id]: 'if-leitura' } }, 's0', 'r0', level)).toBeNull()
    expect(connectRefusal({ ...a, fixes: { [ch.id]: 'if-leitura' } }, 's0', 'cache', level)).toBe(ch.locks!.reason)
    // Other levels have no such lock.
    expect(connectRefusal(a, 's0', 'r0')).toBeNull()
  })

  it('every wrong option says why it does not solve it', () => {
    for (const option of ch.options.filter((o) => !o.fixes)) expect(option.explanation.length).toBeGreaterThan(40)
  })

  const cases: [string, () => Architecture, boolean][] = [
    ['injection with a cache and two replicas', () => design('injecao', 'cache', 2), true],
    ['the drawing as the level opens', () => level.start!, false],
    ['injection with the cache and no replica', () => design('injecao', 'cache', 0), false],
    ['the if with one replica', () => design('if-leitura', 'replica', 1), false],
    ['the if with two replicas', () => design('if-leitura', 'replica', 2), false],
    ['the if with three replicas', () => design('if-leitura', 'replica', 3), false],
    // A locked link on the drawing carries nothing.
    ['the if with the cache drawn anyway', () => design('if-leitura', 'cache', 2), false],
    ['the singleton with the cache drawn anyway', () => design('singleton', 'cache', 2), false],
  ]
  for (const [name, build, passes] of cases) {
    it(`${name} ${passes ? 'passes' : 'fails'} on every seed`, () => {
      for (let seed = 1; seed <= 20; seed++) expect(runLevel(build(), level, seed).summary.passed.all, `seed ${seed}`).toBe(passes)
    })
  }
})

describe('balancing strategy', () => {
  // Four servers, the first one an old machine that takes half.
  const challenge: CodeChallenge = {
    id: 'lb',
    class: 'read',
    title: '',
    code: '',
    bug: [],
    options: [
      { id: 'strategy', label: '', code: '', fixes: true, explanation: '', work: [], settings: ['balance'] },
      { id: 'other', label: '', code: '', fixes: false, explanation: '', work: [] },
    ],
  }
  const old: Level = { ...steady, traffic: [{ from: 0, rps: 1000 }], nodeTweaks: [{ id: 'server#0', capacity: 200 }], code: [challenge] }
  const a = fanOut(4, 'db', [['client', 'lb']])
  const leastConn = (fix: string): Architecture => ({
    nodes: a.nodes.map((n) => (n.kind === 'lb' ? { ...n, balance: 'least-conn' } : n)),
    edges: a.edges,
    fixes: { lb: fix },
  })

  it('round robin drowns a server with half the capacity; least connections does not', () => {
    const rr = simulateTick(a, old, 0, mulberry32(1))
    expect(rr.nodes['server#0'].load).toBeCloseTo(250)
    expect(rr.nodes['server#0'].dropRate).toBeGreaterThan(0.1)
    const lc = simulateTick(leastConn('strategy'), old, 0, mulberry32(1))
    expect(lc.nodes['server#0'].load).toBeCloseTo(1000 * (200 / 1400))
    expect(lc.nodes['server#0'].dropRate).toBeCloseTo(0)
    expect(lc.nodes['server#1'].utilization).toBeCloseTo(lc.nodes['server#0'].utilization)
  })

  it('ignores the setting until the code lets the player choose', () => {
    const locked = simulateTick(leastConn('other'), old, 0, mulberry32(1))
    expect(locked.nodes['server#0'].load).toBeCloseTo(250)
    expect(balanceOf(leastConn('other').nodes.find((n) => n.kind === 'lb')!, old, { lb: 'other' })).toBe('round-robin')
    expect(canSetBalance(old, { lb: 'strategy' })).toBe(true)
    expect(canSetBalance(old, undefined)).toBe(false)
  })

  it('a tweak follows the piece by id: deleting the old server takes it away', () => {
    expect(instanceCapacity(old, { id: 'server#0', kind: 'server' })).toBe(200)
    expect(instanceCapacity(old, { id: 'server#1', kind: 'server' })).toBe(SPECS.server.capacity)
  })

  const level = LEVELS.find((l) => l.id === 'servidor-velho')!
  const start = level.start!
  const fixed = (fix: string, balance?: 'least-conn' | 'hash'): Architecture => ({
    nodes: start.nodes.map((n) => (n.kind === 'lb' && balance ? { ...n, balance } : n)),
    edges: start.edges,
    fixes: { [level.code![0].id]: fix },
  })
  const cases: [string, () => Architecture, boolean][] = [
    ['Strategy with least connections', () => fixed('strategy', 'least-conn'), true],
    ['the drawing as the level opens', () => start, false],
    ['Strategy left on round robin', () => fixed('strategy'), false],
    ['Strategy with hashing', () => fixed('strategy', 'hash'), false],
    ['the random draw', () => fixed('aleatorio'), false],
    // Works today, and the challenge says why it is still a poor change.
    ['the if for the old server', () => fixed('if-velho'), true],
    [
      'deleting the old server',
      () => ({ nodes: start.nodes.filter((n) => n.id !== 'server-1'), edges: start.edges.filter((e) => e.source !== 'server-1' && e.target !== 'server-1') }),
      false,
    ],
  ]
  for (const [name, build, passes] of cases) {
    it(`servidor-velho: ${name} ${passes ? 'passes' : 'fails'} on every seed`, () => {
      for (let seed = 1; seed <= 20; seed++) expect(runLevel(build(), level, seed).summary.passed.all, `seed ${seed}`).toBe(passes)
    })
  }

  it('the option that passes without scaling says so', () => {
    const option = level.code![0].options.find((o) => o.id === 'if-velho')!
    expect(option.fixes).toBe(true)
    expect(option.caveat).toBeTruthy()
  })
})
