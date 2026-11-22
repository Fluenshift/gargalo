import { Worker } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import type { Exercise, TestCase } from './exercise'
import { LOAD_TIMEOUT_MESSAGE, LOAD_TIMEOUT_MS, TIMEOUT_MESSAGE, runTests, type StartWorker } from './runner'

// A real thread, so a loop that never ends is cut off the same way the browser worker is.
const startNodeWorker: StartWorker = (onMessage, onError) => {
  const worker = new Worker(new URL('./testWorker.mjs', import.meta.url))
  worker.on('message', onMessage)
  worker.on('error', (err) => onError(err.message))
  return { postMessage: (input) => worker.postMessage(input), terminate: () => void worker.terminate() }
}

const test = (name: string, path: string): TestCase => ({ name, requests: [{ request: { path }, expect: { status: 200 } }] })

const exercise: Exercise = {
  id: 'teste',
  schema: '',
  seed: '',
  visible: [test('rápido', '/'), test('loop', '/loop')],
  hidden: [test('escondido', '/')],
  hints: [],
  reference: '',
  naive: '',
  load: { rps: 100, p99Ms: 100, queriesPerRequest: 1 },
}

const code = `export default async function handler(req: Request) {
  if (req.url.endsWith('/loop')) while (true) {}
  return new Response('ok')
}`

describe('runTests', () => {
  it('cuts off a loop that never ends and runs the remaining tests in a new worker', async () => {
    const results = await runTests(code, exercise, 'all', startNodeWorker)
    expect(results.map(({ name, passed, message }) => ({ name, passed, message }))).toEqual([
      { name: 'rápido', passed: true },
      { name: 'loop', passed: false, message: TIMEOUT_MESSAGE },
      { name: 'escondido', passed: true },
    ])
    expect(results[0].metrics).toMatchObject([{ queries: 0, rowsRead: 0 }])
  })

  it('runs only the visible tests when asked', async () => {
    const results = await runTests(`export default async () => new Response('ok')`, exercise, 'visible', startNodeWorker)
    expect(results.map((r) => r.name)).toEqual(['rápido', 'loop'])
  })

  it('fails the current test when the worker breaks', async () => {
    const broken: StartWorker = (_, onError) => ({ postMessage: () => onError(''), terminate: () => {} })
    const results = await runTests(code, { ...exercise, visible: [test('a', '/')] }, 'visible', broken)
    expect(results).toEqual([{ name: 'a', passed: false, message: 'O código parou o executor.' }])
  })

  it('gives the database its own clock to load, apart from the tests', async () => {
    vi.useFakeTimers()
    try {
      const ok = { name: 'a', passed: true }
      // Ready late, then answers at once: the 2 s per test only start counting at ready.
      const slowLoad: StartWorker = (onMessage) => ({
        postMessage: () => setTimeout(() => {
          onMessage({ ready: true })
          onMessage({ index: 0, result: ok })
        }, LOAD_TIMEOUT_MS - 1),
        terminate: () => {},
      })
      const loaded = runTests(code, { ...exercise, visible: [test('a', '/')] }, 'visible', slowLoad)
      await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS)
      expect(await loaded).toEqual([ok])

      const neverLoads: StartWorker = () => ({ postMessage: () => {}, terminate: () => {} })
      const stuck = runTests(code, exercise, 'all', neverLoads)
      await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS)
      expect(await stuck).toEqual(['rápido', 'loop', 'escondido'].map((name) => ({ name, passed: false, message: LOAD_TIMEOUT_MESSAGE })))
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails every test when the database does not load', async () => {
    const broken: StartWorker = (onMessage) => ({ postMessage: () => onMessage({ ready: false, message: 'sem wasm' }), terminate: () => {} })
    expect(await runTests(code, exercise, 'visible', broken)).toEqual([
      { name: 'rápido', passed: false, message: 'sem wasm' },
      { name: 'loop', passed: false, message: 'sem wasm' },
    ])
  })
})
