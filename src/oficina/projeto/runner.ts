// The page's side of a project: each call goes to the Oficina worker (the same one the exercises use), in turn, with a time limit.

import type { TestCase, TestResult } from '../exercise'
import { LOAD_TIMEOUT_MESSAGE, LOAD_TIMEOUT_MS, TEST_TIMEOUT_MS, TIMEOUT_MESSAGE, callWorker, enqueue, runTestBatches, type StartWorker } from '../runner'
import type { Project } from './project'
import type { ProjectCall, ProjectRequest, RequestOutcome, TableRows } from './runtime'

export { prewarm } from '../runner'

// Opening a project's database from IndexedDB, migrating or reading tables is not the player's code: the load clock, not the 2 s.
const call = (c: ProjectCall, start?: StartWorker, ms = LOAD_TIMEOUT_MS, message = LOAD_TIMEOUT_MESSAGE) => callWorker({ call: c }, ms, message, start)

/** Sends a request to the project, against its dev database. Never rejects: a timeout or a crash comes back as `error`. */
export function request(project: Project, req: ProjectRequest, start?: StartWorker): Promise<RequestOutcome> {
  return enqueue(async () => {
    const began = performance.now()
    try {
      await call({ op: 'open', project }, start)
      return (await call({ op: 'request', project, request: req }, start, TEST_TIMEOUT_MS, TIMEOUT_MESSAGE)) as RequestOutcome
    } catch (err) {
      return { error: { message: (err as Error).message }, logs: [], ms: performance.now() - began, metrics: { queries: 0, rowsRead: 0, handlerMs: 0 } }
    }
  })
}

/** Applies the dev database's pending migrations, in order; resolves with the ones applied (e.g. `002_pedidos.sql`). */
export const applyMigrations = (project: Project, start?: StartWorker) => enqueue(() => call({ op: 'migrate', project }, start)) as Promise<string[]>

/** Empties the dev database, `_migrations` included. */
export const resetDev = (project: Project, start?: StartWorker) => enqueue(() => call({ op: 'reset', project }, start)) as Promise<void>

/** Deletes the project's dev database (when the project is deleted). */
export const dropDev = (project: Pick<Project, 'id'>, start?: StartWorker) => enqueue(() => call({ op: 'drop', project }, start)) as Promise<void>

/** The dev database's tables, by name. */
export const listTables = (project: Project, start?: StartWorker) => enqueue(() => call({ op: 'tables', project }, start)) as Promise<string[]>

/** The first `limit` rows of a dev table. */
export const tableRows = (project: Project, table: string, limit = 100, start?: StartWorker) =>
  enqueue(() => call({ op: 'rows', project, table, limit }, start)) as Promise<TableRows>

/** Runs the tests on a fresh test database (all migrations, then `seed`) per test; one result per test, in order. */
export const runTests = (project: Project, tests: TestCase[], seed?: string, start?: StartWorker): Promise<TestResult[]> =>
  enqueue(() => runTestBatches(tests, (batch) => ({ project, seed, tests: batch }), start))
