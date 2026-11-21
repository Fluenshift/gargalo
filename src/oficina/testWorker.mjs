// Node stand-in for oficinaWorker.ts, so tests can run the executor on a real thread and cut it off.
import { parentPort } from 'node:worker_threads'
import { executeTests } from './execute.ts'

const db = { query: () => Promise.reject(new Error('sem banco')), transaction: (fn) => fn(db) }
parentPort.on('message', (input) => executeTests(input, async () => db, (out) => parentPort.postMessage(out)))
