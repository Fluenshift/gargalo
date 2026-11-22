// What the Oficina worker does with a project: answer requests against the dev database, migrate, show tables, run tests on a fresh one.
// Plain functions: the worker wraps them, unit tests call them directly.

import type { PGlite } from '@electric-sql/pglite'
// With the extensions: testWorker.mjs loads this file in a plain Node thread, which resolves no extensionless paths.
import { measured, pgliteDb, toDb } from '../db.ts'
import { buildRequest, runTest, type WorkerOutput } from '../execute.ts'
import type { RequestMetrics, TestCase, TestResult } from '../exercise'
import { ProjectError, loadApp, locate } from './modules.ts'
import type { Project } from './project'

/** What the HTTP client sends; the body is already text. */
export interface ProjectRequest {
  method?: string
  /** Path and query, e.g. `/produtos?limite=10`. */
  path: string
  headers?: Record<string, string>
  body?: string
}

export interface LogLine {
  level: 'log' | 'warn' | 'error'
  text: string
}

export interface CodeError {
  message: string
  file?: string
  line?: number
}

/** One request against the dev database: the response, or the error that stopped the code, plus what it logged and cost. */
export interface RequestOutcome {
  response?: { status: number; headers: Record<string, string>; body: string }
  error?: CodeError
  logs: LogLine[]
  /** Wall time, loading the project's modules included. */
  ms: number
  metrics: RequestMetrics
}

export interface TableRows {
  columns: string[]
  rows: Record<string, unknown>[]
}

/** The dev database is per project and persists; the test one is the worker's in-memory Postgres, reset for each test. */
export interface Databases {
  test: PGlite
  dev(projectId: string): Promise<PGlite>
  /** Closes the project's dev database and deletes it from IndexedDB. */
  drop(projectId: string): Promise<void>
}

export type ProjectCall =
  | { op: 'open' | 'migrate' | 'reset' | 'tables'; project: Project }
  | { op: 'drop'; project: Pick<Project, 'id'> }
  | { op: 'request'; project: Project; request: ProjectRequest }
  | { op: 'rows'; project: Project; table: string; limit: number }

export interface CallInput {
  call: ProjectCall
}

export type CallOutput = { reply: unknown } | { failed: string }

export interface ProjectTestsInput {
  project: Project
  /** SQL run after the migrations, before each test. */
  seed?: string
  tests: TestCase[]
}

export const describeError = (err: unknown): CodeError => ({ message: err instanceof ProjectError ? err.message : String(err), ...locate(err) })

const MIGRATION = /^migrations\/(\d+)_[^/]*\.sql$/

/** The project's migrations by number: `migrations/002_x.sql` before `migrations/010_y.sql`. */
export const migrationFiles = (files: Record<string, string>) =>
  Object.keys(files)
    .filter((p) => MIGRATION.test(p))
    .sort((a, b) => Number(MIGRATION.exec(a)![1]) - Number(MIGRATION.exec(b)![1]) || a.localeCompare(b))

/** Applies the migrations not yet in `_migrations`, each in its own transaction; returns the ones it applied. */
export async function migrate(pg: PGlite, files: Record<string, string>): Promise<string[]> {
  await pg.exec('CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
  const done = new Set((await pg.query<{ name: string }>('SELECT name FROM _migrations')).rows.map((r) => r.name))
  const applied: string[] = []
  for (const path of migrationFiles(files)) {
    const name = path.slice('migrations/'.length)
    if (done.has(name)) continue
    try {
      await pg.transaction(async (tx) => {
        await tx.exec(files[path])
        await tx.query('INSERT INTO _migrations (name) VALUES ($1)', [name])
      })
    } catch (err) {
      throw new ProjectError(`A migração ${path} falhou: ${(err as Error).message}`, path)
    }
    applied.push(name)
  }
  return applied
}

function format(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) {
    const { file, line } = locate(arg)
    return file ? `${String(arg)} (${file}:${line})` : String(arg)
  }
  try {
    return JSON.stringify(arg) ?? String(arg)
  } catch {
    return String(arg)
  }
}

/** Sends console.log/warn/error to `logs` (Hono's own error log included) until the returned function is called. */
function captureConsole(logs: LogLine[]): () => void {
  const saved = { log: console.log, warn: console.warn, error: console.error }
  for (const level of ['log', 'warn', 'error'] as const) console[level] = (...args: unknown[]) => void logs.push({ level, text: args.map(format).join(' ') })
  return () => Object.assign(console, saved)
}

async function request(pg: PGlite, project: Project, spec: ProjectRequest): Promise<RequestOutcome> {
  const metrics: RequestMetrics = { queries: 0, rowsRead: 0, handlerMs: 0 }
  const logs: LogLine[] = []
  const start = performance.now()
  const restore = captureConsole(logs)
  const done = (rest: Pick<RequestOutcome, 'response' | 'error'>): RequestOutcome => {
    const ms = performance.now() - start
    metrics.handlerMs = Math.max(0, metrics.handlerMs + ms)
    return { ...rest, logs, ms, metrics }
  }
  try {
    const res: unknown = await loadApp(project.files).fetch(buildRequest(spec), { db: measured(toDb(pg), metrics) })
    if (!(res instanceof Response)) return done({ error: { message: 'fetch(req, env) precisa devolver um Response.' } })
    return done({ response: { status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() } })
  } catch (err) {
    return done({ error: describeError(err) })
  } finally {
    restore()
  }
}

async function tableRows(pg: PGlite, table: string, limit: number): Promise<TableRows> {
  const { rows, fields } = await pg.query<Record<string, unknown>>(`SELECT * FROM "${table.replaceAll('"', '""')}" LIMIT $1`, [limit])
  return { columns: fields.map((f) => f.name), rows }
}

async function run(call: ProjectCall, dbs: Databases): Promise<unknown> {
  const pg = await dbs.dev(call.project.id)
  switch (call.op) {
    case 'open':
    case 'drop':
      return undefined
    case 'request':
      return request(pg, call.project, call.request)
    case 'migrate':
      return migrate(pg, call.project.files)
    case 'reset':
      // The same reset the exercises' database gets between tests: an empty public schema, so _migrations goes too.
      await pgliteDb(pg)('', '')
      return undefined
    case 'tables':
      return (await pg.query<{ name: string }>(`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`)).rows.map((r) => r.name)
    case 'rows':
      return tableRows(pg, call.table, call.limit)
  }
}

/** Runs one call; a failure becomes its message, so the host can show it. */
export async function answer(call: ProjectCall, dbs: Databases): Promise<CallOutput> {
  try {
    // Dropping must not open the database it deletes.
    if (call.op === 'drop') return { reply: await dbs.drop(call.project.id) }
    const reply = await run(call, dbs)
    // PGlite doesn't write a transaction's COMMIT through to IndexedDB (migrations and measured queries run in one),
    // so the dev database is flushed before answering; otherwise closing the tab right after loses the last writes.
    await (await dbs.dev(call.project.id)).syncToFs()
    return { reply }
  } catch (err) {
    return { failed: err instanceof ProjectError ? err.message : String(err) }
  }
}

/** Runs the tests in order on the test database, rebuilt from the migrations (and seed) for each one; reports each result as soon as it is known. */
export async function executeProjectTests(input: ProjectTestsInput, pg: PGlite, report: (out: WorkerOutput) => void): Promise<void> {
  for (const [index, test] of input.tests.entries()) {
    let result: TestResult
    try {
      const db = await pgliteDb(pg)('', '')
      await migrate(pg, input.project.files)
      if (input.seed) await pg.exec(input.seed)
      await pg.exec('ANALYZE')
      const app = loadApp(input.project.files)
      result = await runTest(async (req, ctx) => app.fetch(req, { db: ctx.db }), test, db)
    } catch (err) {
      result = { name: test.name, passed: false, ...describeError(err) }
    }
    report({ index, result })
  }
}
