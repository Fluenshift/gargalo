// ctx.db on PGlite (Postgres in WASM), and the meter that counts what each request costs.

import type { PGlite, Transaction } from '@electric-sql/pglite'
import type { Db, RequestMetrics } from './exercise'
import type { OpenDb } from './execute'

/** One PGlite per worker (creating one takes seconds); each test gets the exercise's schema and data back from scratch. */
export function pgliteDb(pg: PGlite): OpenDb {
  const db: Db = {
    query: async (sql, params) => (await pg.query<never>(sql, params)).rows,
    transaction: (fn) => pg.transaction((tx) => fn(inTransaction(tx))),
  }
  return async (schema, seed) => {
    // The worker lives across runs: undo what the last handler left on the session (an open transaction, SET) before the schema reset.
    await pg.exec('ROLLBACK;\nRESET ALL')
    // Newlines so a trailing `-- comment` in the exercise's SQL doesn't swallow what follows; ANALYZE so the planner sees the seed.
    await pg.exec(`DROP SCHEMA public CASCADE;\nCREATE SCHEMA public;\n${schema}\n;\n${seed}\n;\nANALYZE;`)
    return db
  }
}

let savepoints = 0

function inTransaction(tx: Transaction): Db {
  const db: Db = {
    query: async (sql, params) => (await tx.query<never>(sql, params)).rows,
    // A transaction inside a transaction is a savepoint: a throw undoes only the inner part.
    async transaction(fn) {
      const name = `oficina_${++savepoints}`
      await tx.query(`SAVEPOINT ${name}`)
      try {
        const result = await fn(db)
        await tx.query(`RELEASE SAVEPOINT ${name}`)
        return result
      } catch (err) {
        await tx.query(`ROLLBACK TO SAVEPOINT ${name}`)
        throw err
      }
    },
  }
  return db
}

interface PlanNode {
  'Node Type': string
  'Relation Name'?: string
  'Actual Rows': number
  'Actual Loops': number
  'Rows Removed by Filter'?: number
  'Rows Removed by Index Recheck'?: number
  Plans?: PlanNode[]
}

/** Rows the scans touched: the ones they returned plus the ones their filter threw away, per loop. */
export function rowsRead(node: PlanNode): number {
  const own = node['Relation Name'] && node['Node Type'] !== 'ModifyTable'
    ? (node['Actual Rows'] + (node['Rows Removed by Filter'] ?? 0) + (node['Rows Removed by Index Recheck'] ?? 0)) * node['Actual Loops']
    : 0
  return own + (node.Plans ?? []).reduce((sum, child) => sum + rowsRead(child), 0)
}

// EXPLAIN ANALYZE runs the statement, so it runs first inside a savepoint that is rolled back, then the real one runs once.
// Sequences ignore rollbacks: explaining an INSERT would burn an id and the real one would get the next. Those are not explained.
// shortcut: INSERT ... SELECT and nextval() count as 0 rows read; explain them some other way if an exercise needs it.
const NOT_EXPLAINED = /\b(insert|nextval|setval)\b/i

async function explainThenRun<T>(tx: Db, sql: string, params: unknown[] | undefined, m: RequestMetrics): Promise<T[]> {
  if (!NOT_EXPLAINED.test(sql)) {
    const start = performance.now()
    await tx.query('SAVEPOINT oficina_explain')
    try {
      const [row] = await tx.query<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, params)
      m.rowsRead += Math.round(rowsRead(row['QUERY PLAN'][0].Plan))
    } catch {
      // Not explainable (CREATE INDEX, a syntax error...): the real run below gives the player the real error.
    }
    await tx.query('ROLLBACK TO SAVEPOINT oficina_explain')
    // Measuring is not the handler's time.
    m.handlerMs -= performance.now() - start
  }
  return tx.query<T>(sql, params)
}

/** The db one request sees: same data, but every query is counted on `m`. */
export function measured(db: Db, m: RequestMetrics, inTx = false): Db {
  return {
    query<T>(sql: string, params?: unknown[]) {
      m.queries++
      if (inTx) return explainThenRun<T>(db, sql, params, m)
      if (NOT_EXPLAINED.test(sql)) return db.query<T>(sql, params)
      // One statement on its own is already its own transaction; this keeps the explain and the real run together.
      return db.transaction((tx) => explainThenRun<T>(tx, sql, params, m))
    },
    transaction: (fn) => db.transaction((tx) => fn(measured(tx, m, true))),
  }
}
