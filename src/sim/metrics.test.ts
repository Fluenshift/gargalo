import { describe, expect, it } from 'vitest'
import type { NodeStats, TickResult } from './engine'
import { costPerMillion, mostSaturated, nodeSeries } from './metrics'
import type { Level } from './model'

const level = (traffic: Level['traffic'], durationS = 10): Level => ({
  id: 't',
  title: 't',
  briefing: '',
  durationS,
  mix: { static: 0, read: 1, write: 0 },
  traffic,
  failures: [],
  goals: { minAvailability: 0.99, maxP99Ms: 1000, maxCost: 10_000 },
})

const stats = (load: number, utilization: number, extra: Partial<NodeStats> = {}): NodeStats => ({
  load,
  utilization,
  dropRate: 0,
  down: false,
  latencyMs: 10,
  ...extra,
})

const tick = (nodes: Record<string, NodeStats>): TickResult => ({
  t: 0,
  rps: 0,
  botRps: 0,
  served: 0,
  duplicates: 0,
  failed: { overload: 0, down: 0, noRoute: 0, limited: 0, breaker: 0 },
  breakers: {},
  servedByClass: { static: 0, read: 0, write: 0, bot: 0 },
  stale: 0,
  async: { done: 0, lost: 0 },
  p50Ms: 0,
  p95Ms: 0,
  p99Ms: 0,
  nodes,
  edges: {},
  latencies: [],
})

describe('costPerMillion', () => {
  it('divides the monthly cost by a month of traffic at the average rps', () => {
    // 5 s at 100 rps and 5 s at 300 rps: 200 rps on average, 518.4 million requests a month.
    const l = level([{ from: 0, rps: 100 }, { from: 5, rps: 300 }])
    expect(costPerMillion(518.4, l)).toBeCloseTo(1)
  })

  it('is undefined without traffic', () => {
    expect(costPerMillion(100, level([]))).toBeUndefined()
  })
})

describe('mostSaturated', () => {
  it('picks the node with the highest utilization', () => {
    expect(mostSaturated(tick({ client: stats(900, 0), server: stats(300, 0.75), db: stats(300, 1.3) }))).toBe('db')
  })

  it('is undefined when nothing is loaded', () => {
    expect(mostSaturated(tick({ client: stats(0, 0) }))).toBeUndefined()
  })
})

describe('nodeSeries', () => {
  it('lists one piece per second and treats missing seconds as idle', () => {
    const ticks = [
      tick({ server: stats(200, 0.5, { latencyMs: 60 }) }),
      tick({ server: stats(600, 1.5, { dropRate: 1 / 3, latencyMs: 600 }) }),
      tick({}),
    ]
    expect(nodeSeries(ticks, 'server')).toEqual({
      load: [200, 600, 0],
      utilization: [0.5, 1.5, 0],
      dropRate: [0, 1 / 3, 0],
      latencyMs: [60, 600, 0],
      down: [false, false, false],
    })
  })
})
