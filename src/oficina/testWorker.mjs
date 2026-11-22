// Node stand-in for oficinaWorker.ts, so tests can run the executor on a real thread and cut it off.
// No Postgres here (it takes seconds to start per thread); the executor's tests use a real one.
import { parentPort } from 'node:worker_threads'
import { executeTests } from './execute.ts'

const db = { query: () => Promise.reject(new Error('sem banco')), transaction: (fn) => fn(db) }
parentPort.postMessage({ ready: true })
parentPort.on('message', (input) => executeTests(input, async () => db, (out) => parentPort.postMessage(out)))
