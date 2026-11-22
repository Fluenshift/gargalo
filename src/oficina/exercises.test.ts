// Like the levels in engine.test.ts: every exercise's reference passes with 3 stars, its naive code fails a test or loses
// stars, and its starter fails. All through the real path: executeTests on a real Postgres, then the load run.

import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { runLevel } from '../sim/engine'
import { pgliteDb } from './db'
import type { RequestMetrics, TestResult } from './exercise'
import { compile, executeTests } from './execute'
import { EXERCISES, type OficinaExercise } from './exercises'
import { OFICINA_ARCH, loadLevel, oficinaStars, requestCost } from './load'
import { allPassed } from './progress'

let pg: PGlite
beforeAll(async () => {
  pg = await PGlite.create()
}, 60_000)

/** Handler wall time is the one noisy measure; a fixed, realistic value keeps the stars down to queries and rows read. */
const HANDLER_MS = 5

async function submit(code: string, exercise: OficinaExercise) {
  const results: TestResult[] = []
  const { schema, seed } = exercise
  await executeTests({ code, schema, seed, tests: [...exercise.visible, ...exercise.hidden] }, pgliteDb(pg), ({ result }) => results.push(result))
  const passed = allPassed(results)
  const cost: RequestMetrics = { ...requestCost(results), handlerMs: HANDLER_MS }
  const { summary } = runLevel(OFICINA_ARCH, loadLevel(exercise, cost), 1)
  return { results, passed, cost, summary, stars: oficinaStars(passed, summary, exercise.load, cost) }
}

const failures = (results: TestResult[]) => results.filter((r) => !r.passed).map((r) => `${r.name}: ${r.message}`)

describe('exercises', () => {
  it('have unique ids and the parts the screen shows', () => {
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length)
    for (const e of EXERCISES) {
      expect(e.hints.length, e.id).toBeGreaterThan(0)
      expect(e.visible.length, e.id).toBeGreaterThan(0)
      expect(e.hidden.length, e.id).toBeGreaterThan(0)
    }
  })

  for (const exercise of EXERCISES) {
    describe(exercise.id, () => {
      it('the reference passes every test with 3 stars', async () => {
        const run = await submit(exercise.reference, exercise)
        expect(failures(run.results)).toEqual([])
        expect({ stars: run.stars, p99Ms: Math.round(run.summary.p99Ms), cost: run.cost }).toMatchObject({ stars: 3 })
      })

      it('the naive code fails a test or loses stars', async () => {
        const run = await submit(exercise.naive, exercise)
        expect(run.stars).toBeLessThan(3)
      })

      it('the starter fails', async () => {
        expect((await submit(exercise.starter, exercise)).passed).toBe(false)
      })
    })
  }
})

describe('what each naive code gets wrong', () => {
  const byId = (id: string) => EXERCISES.find((e) => e.id === id)!
  const naive = (id: string) => submit(byId(id).naive, byId(id))
  const failed = (results: TestResult[]) => results.filter((r) => !r.passed).map((r) => r.name)

  it('cadastro: checking the e-mail before inserting breaks with two sign-ups at once', async () => {
    expect(failed((await naive('cadastro')).results)).toEqual(['dois cadastros iguais ao mesmo tempo'])
  })

  it('paginacao: OFFSET gives the same pages but reads every row before them, and misses p99', async () => {
    const run = await naive('paginacao')
    expect(run.passed).toBe(true)
    expect(run.cost.rowsRead).toBeGreaterThan(5000)
    expect(run.stars).toBe(1)
  })

  it('pedido: N+1 gives the same order with a query per item, and misses p99 and the queries goal', async () => {
    const run = await naive('pedido')
    expect(run.passed).toBe(true)
    expect(run.cost.queries).toBeGreaterThan(byId('pedido').load.queriesPerRequest)
    expect(run.stars).toBe(1)
  })

  it('busca: without the index the same search reads the whole table, and misses p99', async () => {
    const run = await naive('busca')
    expect(run.passed).toBe(true)
    expect(run.cost.rowsRead).toBeGreaterThan(10_000)
    expect(run.stars).toBe(1)
  })

  it('busca: with the migration, EXPLAIN shows the index instead of a sequential scan', async () => {
    const exercise = byId('busca')
    const db = await pgliteDb(pg)(exercise.schema, exercise.seed, compile(exercise.reference).migration)
    const plan = async () =>
      JSON.stringify(await db.query("EXPLAIN SELECT id FROM produtos WHERE lower(nome) LIKE 'tecl%' ORDER BY lower(nome) LIMIT 20"))
    expect(await plan()).toMatch(/Index Scan using produtos_nome_idx/)
    await pgliteDb(pg)(exercise.schema, exercise.seed)
    expect(await plan()).toMatch(/Seq Scan on produtos/)
  })

  it('pagamento: looking the key up first breaks with the same payment twice at once', async () => {
    expect(failed((await naive('pagamento')).results)).toEqual(['a mesma chave duas vezes ao mesmo tempo cobra uma vez'])
  })

  it('transferencia: reading the balance and writing it back lets two transfers spend the same money', async () => {
    expect(failed((await naive('transferencia')).results)).toEqual(['duas transferências ao mesmo tempo', 'três ao mesmo tempo'])
  })
})
