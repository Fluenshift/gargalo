// From what a submission's requests cost to how it holds up under the exercise's target load:
// the costs become the `work` of a server and a database in a synthetic engine level, and the run gives the stars.

import type { RunSummary } from '../sim/engine'
import type { Architecture, Level, RequestClass } from '../sim/model'
import type { Exercise, RequestMetrics, TestResult } from './exercise'

/** Rows one plain query may read before reading counts as another query's worth of database work. */
export const ROWS_PER_QUERY = 1000
/** What each query after the first adds to a request at the database: one more round trip. */
export const QUERY_ROUND_TRIP_MS = 2
export const MIN_AVAILABILITY = 0.999
/** Long enough for queues to settle, short enough to run on every submission. */
const DURATION_S = 30

/**
 * Cost per request over every request the tests made. Queries and rows read are the mean: the
 * target load is a mix of those requests and what a piece handles grows linearly with each one's
 * cost (a p95 would charge every request for the worst). Handler time is the median instead: it is
 * wall time, and one request slowed by a cold start or a busy machine would otherwise cost stars.
 */
export function requestCost(results: TestResult[]): RequestMetrics {
  const all = results.flatMap((r) => r.metrics ?? [])
  const mean = (k: keyof RequestMetrics) => (all.length ? all.reduce((s, m) => s + m[k], 0) / all.length : 0)
  const ms = all.map((m) => m.handlerMs).sort((a, b) => a - b)
  const median = ms.length ? (ms[(ms.length - 1) >> 1] + ms[ms.length >> 1]) / 2 : 0
  return { queries: mean('queries'), rowsRead: mean('rowsRead'), handlerMs: median }
}

export const OFICINA_ARCH: Architecture = {
  nodes: [
    { id: 'users', kind: 'client' },
    { id: 'server', kind: 'server' },
    { id: 'db', kind: 'db' },
  ],
  edges: [
    { source: 'users', target: 'server' },
    { source: 'server', target: 'db' },
  ],
}

/**
 * Users → server → database at the exercise's rps. The handler's time is added to each request on
 * the server; on the database, each query (and each ROWS_PER_QUERY rows read) weighs like one plain
 * request, and the queries after the first add a round trip each. A handler with no query never
 * reaches the database: its requests end at the server.
 */
export function loadLevel(exercise: Pick<Exercise, 'id' | 'load'>, cost: RequestMetrics): Level {
  const c: RequestClass = cost.queries > 0 ? 'read' : 'static'
  return {
    id: `oficina:${exercise.id}`,
    title: exercise.id,
    briefing: '',
    durationS: DURATION_S,
    mix: { static: c === 'static' ? 1 : 0, read: c === 'read' ? 1 : 0, write: 0 },
    traffic: [{ from: 0, rps: exercise.load.rps }],
    failures: [],
    work: [
      { kinds: ['server'], classes: [c], factor: 1, extraMs: cost.handlerMs },
      {
        kinds: ['db'],
        classes: [c],
        factor: Math.max(1, cost.queries + cost.rowsRead / ROWS_PER_QUERY),
        extraMs: Math.max(0, cost.queries - 1) * QUERY_ROUND_TRIP_MS,
      },
    ],
    goals: { minAvailability: MIN_AVAILABILITY, maxP99Ms: exercise.load.p99Ms, maxCost: Infinity },
  }
}

/** 0 unless every test passed; 1, plus one for holding the load (p99 and availability), plus one more for also keeping to the queries per request. */
export function oficinaStars(testsPassed: boolean, summary: RunSummary, load: Exercise['load'], cost: RequestMetrics): number {
  if (!testsPassed) return 0
  if (!(summary.passed.p99 && summary.passed.availability)) return 1
  return cost.queries <= load.queriesPerRequest ? 3 : 2
}
