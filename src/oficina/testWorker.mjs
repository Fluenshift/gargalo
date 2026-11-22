// Node stand-in for oficinaWorker.ts, so tests can run the executor on a real thread and cut it off.
// No Postgres here (it takes seconds to start per thread); the executor's tests use a real one.
import { parentPort } from 'node:worker_threads'
import { executeTests } from './execute.ts'
import { answer } from './projeto/runtime.ts'

const db = { query: () => Promise.reject(new Error('sem banco')), transaction: (fn) => fn(db) }
parentPort.postMessage({ ready: true })
parentPort.on('message', async (input) => {
  if ('call' in input) parentPort.postMessage(await answer(input.call, { test: null, dev: async () => ({ syncToFs: async () => {} }) }))
  else executeTests(input, async () => db, (out) => parentPort.postMessage(out))
})
