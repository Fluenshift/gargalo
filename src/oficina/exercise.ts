// What an Oficina exercise is made of, and the contract the player's handler is written against.
// Everything here is plain data so it crosses postMessage into the worker.

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  transaction<R>(fn: (tx: Db) => Promise<R>): Promise<R>
}

export interface Ctx {
  db: Db
  /** Clock set by the test, so handlers that use time are deterministic. */
  now(): number
}

export interface RequestSpec {
  method?: string
  /** Path and query, e.g. `/usuarios?cursor=abc`. */
  path: string
  headers?: Record<string, string>
  /** Sent as JSON. */
  body?: unknown
}

/** Objects match when every expected key matches (extra keys in the response are fine); arrays and values match exactly. */
export interface ExpectedResponse {
  status: number
  headers?: Record<string, string>
  body?: unknown
}

export interface TestCase {
  name: string
  /** More than one request runs concurrently, interleaving at the handler's awaits. */
  requests: { request: RequestSpec; expect?: ExpectedResponse }[]
  /** Database state after the requests: the rows `sql` returns. */
  db?: { sql: string; params?: unknown[]; rows: unknown[] }
  now?: number
}

export interface Exercise {
  id: string
  schema: string
  seed: string
  visible: TestCase[]
  hidden: TestCase[]
  /** In order: one unlocked per failed submission. */
  hints: string[]
  /** Passes every test. */
  reference: string
  /** A plausible first attempt that must fail, on tests or on stars. */
  naive: string
  /** Target load and the goals for the stars. */
  load: { rps: number; p99Ms: number; queriesPerRequest: number }
}

export interface TestResult {
  name: string
  passed: boolean
  message?: string
  expected?: unknown
  received?: unknown
  /** Line in the player's code where the error happened. */
  line?: number
  /** In a project, the file that line is in. */
  file?: string
  /** What each request cost, in the order of `TestCase.requests`; absent when the handler didn't run to the end. */
  metrics?: RequestMetrics[]
}

/** The cost of one request, measured in the worker. */
export interface RequestMetrics {
  /** Calls to ctx.db.query, including those inside transactions. */
  queries: number
  /** Rows the scans touched (returned plus filtered out), summed from EXPLAIN ANALYZE. INSERTs count 0. */
  rowsRead: number
  /** Handler wall time in ms, without the time spent measuring. Concurrent requests include waiting for each other. */
  handlerMs: number
}
