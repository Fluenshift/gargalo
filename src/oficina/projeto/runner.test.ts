import { Worker } from 'node:worker_threads'
import { afterAll, describe, expect, it } from 'vitest'
import type { WorkerMessage, StartWorker } from '../runner'
import { TIMEOUT_MESSAGE } from '../runner'
import { starter, type Project } from './project'
import { applyMigrations, dropDev, listTables, prewarm, request, resetDev, runTests, tableRows } from './runner'

// A real thread, so a loop that never ends is cut off the same way the browser worker is.
const startNodeWorker: StartWorker = (onMessage, onError) => {
  const worker = new Worker(new URL('../testWorker.mjs', import.meta.url))
  worker.on('message', onMessage)
  worker.on('error', (err) => onError(err.message))
  return { postMessage: (input) => worker.postMessage(input), terminate: () => void worker.terminate() }
}

/** A worker that is ready at once and answers each message with `reply`. */
const fake =
  (reply: (input: WorkerMessage) => unknown[], posted: WorkerMessage[] = []): StartWorker =>
  (onMessage) => {
    queueMicrotask(() => onMessage({ ready: true }))
    return {
      postMessage: (input) => {
        posted.push(input)
        for (const out of reply(input)) queueMicrotask(() => onMessage(out as never))
      },
      terminate: () => {},
    }
  }

afterAll(async () => {
  await prewarm(fake(() => []))
})

const project = (index: string): Project => ({ id: 'p', framework: 'fetch', files: { 'src/index.ts': index } })

describe('project runner', () => {
  it('answers a request on the worker, cuts off one that never ends and answers again on a new worker', async () => {
    const ok = project(
      `export default { async fetch(req: Request) {\n  console.log('oi')\n  return new Response(req.method + ' ' + new URL(req.url).pathname + ' ' + (await req.text()))\n} }`,
    )
    const outcome = await request(ok, { method: 'POST', path: '/a', body: 'corpo' }, startNodeWorker)
    expect(outcome).toMatchObject({ response: { status: 200, body: 'POST /a corpo' }, logs: [{ level: 'log', text: 'oi' }] })
    expect(outcome.ms).toBeGreaterThanOrEqual(0)

    const stuck = await request(project(`export default { fetch() { while (true) {} } }`), { path: '/' }, startNodeWorker)
    expect(stuck).toMatchObject({ error: { message: TIMEOUT_MESSAGE }, logs: [] })
    expect((await request(ok, { path: '/b' }, startNodeWorker)).response?.body).toBe('GET /b ')
  })

  it('sends the database calls and gives back their replies', async () => {
    const posted: WorkerMessage[] = []
    const start = fake((input) => ('call' in input ? [{ reply: input.call.op }] : []), posted)
    const p = starter('p', 'hono')
    expect(await applyMigrations(p, start)).toBe('migrate')
    expect(await resetDev(p, start)).toBe('reset')
    expect(await dropDev(p, start)).toBe('drop')
    expect(await listTables(p, start)).toBe('tables')
    expect(await tableRows(p, 'produtos', undefined, start)).toBe('rows')
    expect(posted.at(-1)).toEqual({ call: { op: 'rows', project: p, table: 'produtos', limit: 100 } })
  })

  it('rejects with the worker’s message when a call fails, and when the worker never loads', async () => {
    await expect(
      applyMigrations(
        starter('p', 'hono'),
        fake(() => [{ failed: 'A migração migrations/001_init.sql falhou: x' }]),
      ),
    ).rejects.toThrow('A migração')
    const notLoaded: StartWorker = (onMessage) => ({ postMessage: () => onMessage({ ready: false, message: 'sem wasm' }), terminate: () => {} })
    await expect(listTables(starter('p', 'hono'), notLoaded)).rejects.toThrow('sem wasm')
    const broken: StartWorker = (_, onError) => ({ postMessage: () => onError(''), terminate: () => {} })
    expect((await request(starter('p', 'hono'), { path: '/' }, broken)).error?.message).toBe('O código parou o executor.')
  })

  it('runs a project’s tests through the worker, one result per test', async () => {
    const tests = [
      { name: 'a', requests: [] },
      { name: 'b', requests: [] },
    ]
    const posted: WorkerMessage[] = []
    const start = fake((input) => ('tests' in input ? input.tests.map((t, index) => ({ index, result: { name: t.name, passed: true } })) : []), posted)
    expect(await runTests(starter('p', 'hono'), tests, 'SELECT 1', start)).toEqual([
      { name: 'a', passed: true },
      { name: 'b', passed: true },
    ])
    expect(posted).toEqual([{ project: starter('p', 'hono'), seed: 'SELECT 1', tests }])
  })
})
