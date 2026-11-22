// The Oficina's own worker (separate from the simulation's): runs the player's code off the page's thread.

import type { Db } from './exercise'
import { BLOCKED_NETWORK, executeTests, type OpenDb, type WorkerInput } from './execute'

// The code is checked for these before it runs; this catches the ways around that check.
for (const name of ['fetch', 'importScripts', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
  Object.defineProperty(self, name, {
    value: () => {
      throw new Error(BLOCKED_NETWORK)
    },
  })
}

// shortcut: no database yet, every query fails; Postgres (PGlite) replaces this in Oficina 2/5 (#83).
const openDb: OpenDb = async () => {
  const db: Db = {
    query: () => Promise.reject(new Error('ctx.db ainda não está disponível.')),
    transaction: (fn) => fn(db),
  }
  return db
}

const scope = self as unknown as { postMessage: (message: unknown) => void }

self.addEventListener('message', (e: MessageEvent<WorkerInput>) => {
  void executeTests(e.data, openDb, (out) => scope.postMessage(out))
})
