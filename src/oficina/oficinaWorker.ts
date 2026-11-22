// The Oficina's own worker (separate from the simulation's): runs the player's code off the page's thread.

import { PGlite } from '@electric-sql/pglite'
import { pgliteDb } from './db'
import { BLOCKED_NETWORK, executeTests, type WorkerInput, type WorkerReady } from './execute'

const scope = self as unknown as { postMessage: (message: unknown) => void }

// The code is checked for these before it runs; this catches the ways around that check.
// Only after Postgres has loaded: PGlite fetches its own WASM and data files while it starts.
function blockNetwork() {
  for (const name of ['fetch', 'importScripts', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
    Object.defineProperty(self, name, {
      value: () => {
        throw new Error(BLOCKED_NETWORK)
      },
    })
  }
}

// Starts loading right away; the runner holds the tests' clock until this reports ready.
const pg = PGlite.create().finally(blockNetwork)
pg.then(
  () => scope.postMessage({ ready: true } satisfies WorkerReady),
  (err: unknown) => scope.postMessage({ ready: false, message: `Não foi possível carregar o Postgres do navegador: ${String(err)}` } satisfies WorkerReady),
)

self.addEventListener('message', (e: MessageEvent<WorkerInput>) => {
  // The player's code (even its top level) only runs once the network is blocked.
  void pg.then((db) => executeTests(e.data, pgliteDb(db), (out) => scope.postMessage(out)))
})
