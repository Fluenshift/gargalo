// Runs the player's code in a fresh worker per run, so a loop that never ends can be cut off without freezing the page.

import type { Exercise, TestResult } from './exercise'
import type { WorkerInput, WorkerOutput } from './execute'

export const TEST_TIMEOUT_MS = 2000
export const TIMEOUT_MESSAGE = 'Passou de 2 s: confira se há um loop que nunca termina.'

export interface WorkerHandle {
  postMessage(input: WorkerInput): void
  terminate(): void
}

/** Starts a worker that runs `executeTests` on what it is posted and posts back each `WorkerOutput`. */
export type StartWorker = (onMessage: (out: WorkerOutput) => void, onError: (message: string) => void) => WorkerHandle

const startBrowserWorker: StartWorker = (onMessage, onError) => {
  const worker = new Worker(new URL('./oficinaWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<WorkerOutput>) => onMessage(e.data)
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
    const finish = (failure?: string) => {
      clearTimeout(timer)
      worker.terminate()
      if (failure !== undefined && results.length < input.tests.length) results.push({ name: input.tests[results.length].name, passed: false, message: failure })
      resolve(results)
    }
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => finish(TIMEOUT_MESSAGE), TEST_TIMEOUT_MS)
    }
    const worker = start(
      ({ result }) => {
        results.push(result)
        if (results.length === input.tests.length) finish()
        else arm()
      },
      (message) => finish(message || 'O código parou o executor.'),
    )
    arm()
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
