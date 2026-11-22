// Runs the player's code in a fresh worker per run, so a loop that never ends can be cut off without freezing the page.

import type { Exercise, TestResult } from './exercise'
import type { WorkerInput, WorkerOutput, WorkerReady } from './execute'

export const TEST_TIMEOUT_MS = 2000
export const TIMEOUT_MESSAGE = 'Passou de 2 s: confira se há um loop que nunca termina.'
/** Loading Postgres (a few MB of WASM) has its own clock, so it never eats into a test's 2 s. */
export const LOAD_TIMEOUT_MS = 60_000
export const LOAD_TIMEOUT_MESSAGE = 'O Postgres do navegador não carregou em 60 s. Confira a conexão e tente de novo.'

export interface WorkerHandle {
  postMessage(input: WorkerInput): void
  terminate(): void
}

/** Starts a worker that posts `WorkerReady` once, then runs `executeTests` on what it is posted and posts back each `WorkerOutput`. */
export type StartWorker = (onMessage: (out: WorkerOutput | WorkerReady) => void, onError: (message: string) => void) => WorkerHandle

const startBrowserWorker: StartWorker = (onMessage, onError) => {
  const worker = new Worker(new URL('./oficinaWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<WorkerOutput | WorkerReady>) => onMessage(e.data)
  worker.onerror = (e) => {
    e.preventDefault()
    onError(e.message)
  }
  return worker
}

/** Runs the tests in one worker; stops at the first test that times out or crashes the worker. */
function runBatch(start: StartWorker, input: WorkerInput): Promise<TestResult[]> {
  const results: TestResult[] = []
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    // `all`: the database never loaded, so no remaining test can run and a new worker wouldn't help.
    const finish = (failure?: string, all = false) => {
      clearTimeout(timer)
      worker.terminate()
      while (failure !== undefined && results.length < input.tests.length) {
        results.push({ name: input.tests[results.length].name, passed: false, message: failure })
        if (!all) break
      }
      resolve(results)
    }
    const arm = (ms = TEST_TIMEOUT_MS, message = TIMEOUT_MESSAGE, all = false) => {
      clearTimeout(timer)
      timer = setTimeout(() => finish(message, all), ms)
    }
    const worker = start(
      (out) => {
        if ('ready' in out) {
          if (out.ready) arm()
          else finish(out.message, true)
          return
        }
        results.push(out.result)
        if (results.length === input.tests.length) finish()
        else arm()
      },
      (message) => finish(message || 'O código parou o executor.'),
    )
    arm(LOAD_TIMEOUT_MS, LOAD_TIMEOUT_MESSAGE, true)
    worker.postMessage(input)
  })
}

/** Runs the visible tests, or all of them, and gives one result per test in order. */
export async function runTests(code: string, exercise: Exercise, which: 'visible' | 'all', start: StartWorker = startBrowserWorker): Promise<TestResult[]> {
  const tests = which === 'visible' ? exercise.visible : [...exercise.visible, ...exercise.hidden]
  const results: TestResult[] = []
  // A test that times out takes its worker down with it; the rest get a new one.
  while (results.length < tests.length) {
    results.push(...(await runBatch(start, { code, schema: exercise.schema, seed: exercise.seed, tests: tests.slice(results.length) })))
  }
  return results
}
