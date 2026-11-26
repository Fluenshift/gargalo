import { describe, expect, it } from 'vitest'
import { runLevel } from '../sim/engine'
import type { RunSummary } from '../sim/engine'
import type { RequestMetrics, TestResult } from './exercise'
import { OFICINA_ARCH, loadLevel, requestCost, oficinaStars } from './load'

// A list of 20 orders with their customers: one JOIN, or one query for the list plus one per order.
const load = { rps: 40, p99Ms: 80, queriesPerRequest: 1 }
const join: RequestMetrics = { queries: 1, rowsRead: 200, handlerMs: 2 }
const nPlusOne: RequestMetrics = { queries: 21, rowsRead: 220, handlerMs: 8 }
const run = (cost: RequestMetrics, l = load) => runLevel(OFICINA_ARCH, loadLevel({ id: 'pedidos', load: l }, cost), 1).summary

describe('requestCost', () => {
  it('averages queries and rows over every request, takes the median handler time, and ignores tests that measured nothing', () => {
    const results: TestResult[] = [
      {
        name: 'a',
        passed: true,
        metrics: [
          { queries: 1, rowsRead: 10, handlerMs: 1 },
          { queries: 3, rowsRead: 30, handlerMs: 3 },
        ],
      },
      { name: 'b', passed: true, metrics: [{ queries: 2, rowsRead: 20, handlerMs: 2 }] },
      { name: 'c', passed: true },
    ]
    expect(requestCost(results)).toEqual({ queries: 2, rowsRead: 20, handlerMs: 2 })
    // A cold start in one request does not move the handler time.
    expect(requestCost([...results, { name: 'd', passed: true, metrics: [{ queries: 2, rowsRead: 20, handlerMs: 300 }] }]).handlerMs).toBe(2.5)
    expect(requestCost([])).toEqual({ queries: 0, rowsRead: 0, handlerMs: 0 })
  })
})

describe('the synthetic level', () => {
  it('turns the cost into work on the server and the database, at the target load', () => {
    const level = loadLevel({ id: 'pedidos', load }, nPlusOne)
    expect(level.id).toBe('oficina:pedidos')
    expect(level.traffic).toEqual([{ from: 0, rps: 40 }])
    expect(level.mix.read).toBe(1)
    expect(level.work).toEqual([
      { kinds: ['server'], classes: ['read'], factor: 1, extraMs: 8 },
      { kinds: ['db'], classes: ['read'], factor: 21.22, extraMs: 40 },
    ])
  })

  it('sends a handler without queries no further than the server', () => {
    expect(loadLevel({ id: 'ola', load }, { queries: 0, rowsRead: 0, handlerMs: 1 }).mix).toEqual({ static: 1, read: 0, write: 0 })
  })

  it('the same exercise with N+1 has a worse p99 and fewer stars than with a JOIN', () => {
    const fast = run(join)
    const slow = run(nPlusOne)
    expect(fast.p99Ms).toBeLessThan(load.p99Ms)
    expect(slow.p99Ms).toBeGreaterThan(load.p99Ms)
    expect(oficinaStars(true, fast, load, join)).toBe(3)
    expect(oficinaStars(true, slow, load, nPlusOne)).toBe(1)
  })

  it('a light endpoint meets its goals with a quick handler and misses p99 with a slow loop', () => {
    const ola = { load: { rps: 100, p99Ms: 100, queriesPerRequest: 0 } }
    const quick = { queries: 0, rowsRead: 0, handlerMs: 0.1 }
    const slow = { queries: 0, rowsRead: 0, handlerMs: 100 }
    expect(oficinaStars(true, run(quick, ola.load), ola.load, quick)).toBe(3)
    expect(oficinaStars(true, run(slow, ola.load), ola.load, slow)).toBe(1)
  })
})

describe('stars', () => {
  const summary = (p99: boolean, availability = true) => ({ passed: { p99, availability } }) as RunSummary
  it('need every test, then p99 and availability, then the queries per request', () => {
    expect(oficinaStars(false, summary(true), load, join)).toBe(0)
    expect(oficinaStars(true, summary(false), load, join)).toBe(1)
    expect(oficinaStars(true, summary(true, false), load, join)).toBe(1)
    expect(oficinaStars(true, summary(true), load, { ...join, queries: 2 })).toBe(2)
    expect(oficinaStars(true, summary(true), load, { ...join, queries: 1 })).toBe(3)
  })
})
