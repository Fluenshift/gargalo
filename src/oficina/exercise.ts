// What an Oficina exercise is made of, and the contract the player's handler is written against.
// The types are plain data so they cross postMessage into the worker; the helpers at the end read them on either side and import nothing.

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
  /** Keys the body must not have at any depth, arrays included (`senha_hash`), in any case. */
  absent?: string[]
  /** The most queries the request may make (what `RequestMetrics.queries` counts): an N+1 goes over it. */
  maxQueries?: number
}

/** One request of a test. In a sequential test, `save` keeps values of its response for the next steps. */
export interface TestStep {
  request: RequestSpec
  expect?: ExpectedResponse
  /**
   * Sequential tests only: variable name to where its value is in the response, `status`, `header.<name>` or `body.<path>`
   * (`body.id`, `body.itens.0.id`). Later steps use it as `{{name}}` in any string of their request, expect or the test's db params;
   * a string that is only `{{name}}` takes the value with its type (a number stays a number).
   */
  save?: Record<string, string>
}

export interface TestCase {
  name: string
  /** More than one request runs concurrently, interleaving at the handler's awaits, unless `sequential`. */
  requests: TestStep[]
  /** One request after the other, each checked before the next starts, so a step can use what an earlier one saved. */
  sequential?: boolean
  /** Also return the responses and the db rows in the result, for checks that judge them in code. */
  capture?: boolean
  /** Database state after the requests: the rows `sql` returns (only captured when `rows` is absent). */
  db?: { sql: string; params?: unknown[]; rows?: unknown[] }
  now?: number
}

/** A response as a test saw it; the body is parsed JSON, or the text when it isn't JSON. */
export interface CapturedResponse {
  status: number
  headers: Record<string, string>
  body: unknown
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
  /** With `capture`: the responses so far, in order (a request that returned no Response has none). */
  responses?: (CapturedResponse | undefined)[]
  /** With `capture` and a `db` query: the rows it returned. */
  rows?: unknown[]
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

// --- Read by the worker's tests and by the page's "Testar agora", which replays a step's requests on the dev database. ---

const VAR = /\{\{(\w+)\}\}/g

/** `value` with each `{{name}}` replaced by what a step saved; a string that is only `{{name}}` takes the value as is. */
export function fill<T>(value: T, vars: Record<string, unknown>): T {
  if (typeof value === 'string') {
    const whole = /^\{\{(\w+)\}\}$/.exec(value)
    if (whole && whole[1] in vars) return vars[whole[1]] as T
    return value.replace(VAR, (m, name: string) => (name in vars ? String(vars[name]) : m)) as T
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, vars)) as T
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, vars)])) as T
  return value
}

/** The value at `status`, `header.<name>` or `body.<path>` of a response; undefined when it isn't there. */
export function pick(res: CapturedResponse | undefined, from: string): unknown {
  if (!res) return undefined
  if (from === 'status') return res.status
  if (from.startsWith('header.')) return res.headers[from.slice('header.'.length).toLowerCase()]
  if (from !== 'body' && !from.startsWith('body.')) return undefined
  return from
    .split('.')
    .slice(1)
    .reduce<unknown>((v, key) => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined), res.body)
}

/** The first key of `value` that is one of `keys` (in any case), at any depth, arrays included; undefined when there is none. */
export function findKey(value: unknown, keys: string[]): string | undefined {
  const wanted = new Set(keys.map((k) => k.toLowerCase()))
  const find = (v: unknown): string | undefined => {
    if (Array.isArray(v)) return v.map(find).find(Boolean)
    if (v === null || typeof v !== 'object') return undefined
    for (const [k, inner] of Object.entries(v)) {
      if (wanted.has(k.toLowerCase())) return k
      const deep = find(inner)
      if (deep) return deep
    }
    return undefined
  }
  return find(value)
}
