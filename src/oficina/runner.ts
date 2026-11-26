// Runs the player's code in one long-lived worker (its Postgres stays loaded), so a loop that never ends can be cut off without freezing the page.

import type { Exercise, TestCase, TestResult } from './exercise'
import type { WorkerInput, WorkerOutput, WorkerReady } from './execute'
import type { CallInput, CallOutput, ProjectTestsInput } from './projeto/runtime'

export const TEST_TIMEOUT_MS = 2000
export const TIMEOUT_MESSAGE = 'Passou de 2 s: confira se há um loop que nunca termina.'
/** Loading Postgres (a few MB of WASM) has its own clock, so it never eats into a test's 2 s. */
export const LOAD_TIMEOUT_MS = 60_000
export const LOAD_TIMEOUT_MESSAGE = 'O Postgres do navegador não carregou em 60 s. Confira a conexão e tente de novo.'

/** What the worker is posted: an exercise's tests, a project's tests, or one call on a project. */
export type WorkerMessage = WorkerInput | ProjectTestsInput | CallInput
type FromWorker = WorkerOutput | WorkerReady | CallOutput

export interface WorkerHandle {
  postMessage(input: WorkerMessage): void
  terminate(): void
}

/** Starts a worker that posts `WorkerReady` once, then posts back each `WorkerOutput` of the tests it is posted, or a `CallOutput` per call. */
export type StartWorker = (onMessage: (out: FromWorker) => void, onError: (message: string) => void) => WorkerHandle

const startBrowserWorker: StartWorker = (onMessage, onError) => {
  const worker = new Worker(new URL('./oficinaWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<FromWorker>) => onMessage(e.data)
  worker.onerror = (e) => {
    e.preventDefault()
    onError(e.message)
  }
  return worker
}

/** The one worker kept between runs, with the Postgres it loaded; `ready` is set once it reports (it never reports twice). */
interface Session {
  start: StartWorker
  worker: WorkerHandle
  ready?: WorkerReady
  /** Whoever waits on the worker right now: the run in flight and/or `prewarm`. */
  listeners: Set<(out: FromWorker | { error: string }) => void>
}

let session: Session | undefined

function drop(s: Session) {
  s.worker.terminate()
  if (session === s) session = undefined
}

function getSession(start: StartWorker): Session {
  if (session?.start === start) return session
  if (session) drop(session)
  const s: Session = {
    start,
    listeners: new Set(),
    worker: start(
      (out) => {
        if ('ready' in out) s.ready = out
        s.listeners.forEach((l) => l(out))
      },
      (message) => {
        drop(s)
        s.listeners.forEach((l) => l({ error: message }))
      },
    ),
  }
  return (session = s)
}

/** Starts loading the worker and its Postgres now, so the first run doesn't wait for it. Resolves when ready; rejects with the reason if it can't be. */
export function prewarm(start: StartWorker = startBrowserWorker): Promise<void> {
  const s = getSession(start)
  return new Promise((resolve, reject) => {
    const settle = (message?: string) => {
      clearTimeout(timer)
      s.listeners.delete(listener)
      if (message === undefined) return resolve()
      drop(s)
      reject(new Error(message))
    }
    const listener = (out: FromWorker | { error: string }) => {
      if ('error' in out) settle(out.error || 'O código parou o executor.')
      else if ('ready' in out) settle(out.ready ? undefined : out.message)
    }
    const timer = setTimeout(() => settle(LOAD_TIMEOUT_MESSAGE), LOAD_TIMEOUT_MS)
    if (s.ready) listener(s.ready)
    else s.listeners.add(listener)
  })
}

/** Runs the tests in the session's worker; stops at the first test that times out or crashes the worker, which is then dropped. */
function runBatch(start: StartWorker, input: WorkerInput | ProjectTestsInput): Promise<TestResult[]> {
  const results: TestResult[] = []
  const s = getSession(start)
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    // `all`: the database never loaded, so no remaining test can run and a new worker wouldn't help.
    const finish = (failure?: string, all = false) => {
      clearTimeout(timer)
      s.listeners.delete(listener)
      if (failure !== undefined) drop(s)
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
    const onReady = (r: WorkerReady) => (r.ready ? arm() : finish(r.message, true))
    const listener = (out: FromWorker | { error: string }) => {
      if ('error' in out) return finish(out.error || 'O código parou o executor.')
      if ('ready' in out) return onReady(out)
      if (!('index' in out)) return
      results.push(out.result)
      if (results.length === input.tests.length) finish()
      else arm()
    }
    s.listeners.add(listener)
    // Already loaded (prewarmed or a previous run): the tests' clock starts now.
    if (s.ready) onReady(s.ready)
    else arm(LOAD_TIMEOUT_MS, LOAD_TIMEOUT_MESSAGE, true)
    s.worker.postMessage(input)
  })
}

/** Runs every test, one batch per worker: a test that times out takes its worker down; the rest get a new one. */
export async function runTestBatches(
  tests: TestCase[],
  input: (tests: TestCase[]) => WorkerInput | ProjectTestsInput,
  start: StartWorker = startBrowserWorker,
): Promise<TestResult[]> {
  const results: TestResult[] = []
  while (results.length < tests.length) results.push(...(await runBatch(start, input(tests.slice(results.length)))))
  return results
}

/** Posts one call and resolves with its reply. Rejects with the worker's message when the call fails, or with `timeoutMessage`
 * after `ms` (the worker, which may be stuck in the player's code, is then dropped). Loading Postgres has its own clock. */
export function callWorker(input: CallInput, ms: number, timeoutMessage: string, start: StartWorker = startBrowserWorker): Promise<unknown> {
  const s = getSession(start)
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const settle = (done: () => void, failure?: string) => {
      clearTimeout(timer)
      s.listeners.delete(listener)
      if (failure !== undefined) drop(s)
      done()
    }
    const arm = (after: number, message: string) => {
      clearTimeout(timer)
      timer = setTimeout(() => settle(() => reject(new Error(message)), message), after)
    }
    const onReady = (r: WorkerReady) => (r.ready ? arm(ms, timeoutMessage) : settle(() => reject(new Error(r.message)), r.message))
    const listener = (out: FromWorker | { error: string }) => {
      if ('error' in out) {
        const message = out.error || 'O código parou o executor.'
        return settle(() => reject(new Error(message)), message)
      }
      if ('ready' in out) return onReady(out)
      if ('reply' in out) return settle(() => resolve(out.reply))
      if ('failed' in out) return settle(() => reject(new Error(out.failed)))
    }
    s.listeners.add(listener)
    if (s.ready) onReady(s.ready)
    else arm(LOAD_TIMEOUT_MS, LOAD_TIMEOUT_MESSAGE)
    s.worker.postMessage(input)
  })
}

// Runs never overlap on the one worker: a run asked for while another is in flight waits its turn.
let queue: Promise<unknown> = Promise.resolve()

/** Runs `job` when every earlier job on the worker has finished. */
export function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const result = queue.then(job)
  queue = result.catch(() => {})
  return result
}

/** Runs the visible tests, or all of them, and gives one result per test in order. */
export function runTests(code: string, exercise: Exercise, which: 'visible' | 'all', start: StartWorker = startBrowserWorker): Promise<TestResult[]> {
  const tests = which === 'visible' ? exercise.visible : [...exercise.visible, ...exercise.hidden]
  return enqueue(() => runTestBatches(tests, (batch) => ({ code, schema: exercise.schema, seed: exercise.seed, tests: batch }), start))
}
