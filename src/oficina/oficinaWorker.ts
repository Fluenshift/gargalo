// The Oficina's own worker (separate from the simulation's): runs the player's code off the page's thread.

import { PGlite } from '@electric-sql/pglite'
import { pgliteDb } from './db'
import { BLOCKED_NETWORK, executeTests, type WorkerReady } from './execute'
import { answer, executeProjectTests } from './projeto/runtime'
import type { WorkerMessage } from './runner'

const scope = self as unknown as { postMessage: (message: unknown) => void }

// PGlite fetches its WASM and data files each time one is created. Projects' databases open after the network is blocked,
// so they get the copies the first one fetched; nothing else can be fetched.
const realFetch = self.fetch.bind(self)
const assets = new Map<string, Promise<Response>>()
const urlOf = (input: RequestInfo | URL) => (input instanceof Request ? input.url : String(input))
function cachedFetch(input: RequestInfo | URL): Promise<Response> {
  const url = urlOf(input)
  if (!assets.has(url)) assets.set(url, realFetch(input))
  return assets.get(url)!.then((res) => res.clone())
}
self.fetch = cachedFetch

// The code is checked for these before it runs; this catches the ways around that check.
// Only after Postgres has loaded: PGlite fetches its own WASM and data files while it starts.
function blockNetwork() {
  const blocked = () => {
    throw new Error(BLOCKED_NETWORK)
  }
  Object.defineProperty(self, 'fetch', { value: (input: RequestInfo | URL) => (assets.has(urlOf(input)) ? cachedFetch(input) : blocked()) })
  for (const name of ['importScripts', 'XMLHttpRequest', 'WebSocket', 'EventSource']) Object.defineProperty(self, name, { value: blocked })
}

// Starts loading right away; the runner holds the tests' clock until this reports ready.
const pg = PGlite.create().finally(blockNetwork)
pg.then(
  () => scope.postMessage({ ready: true } satisfies WorkerReady),
  (err: unknown) => scope.postMessage({ ready: false, message: `Não foi possível carregar o Postgres do navegador: ${String(err)}` } satisfies WorkerReady),
)

// One project's dev database open at a time, kept in IndexedDB.
let dev: { id: string; pg: Promise<PGlite> } | undefined
function openDev(id: string): Promise<PGlite> {
  if (dev?.id !== id) {
    void dev?.pg.then((db) => db.close()).catch(() => {})
    const opening: Promise<PGlite> = PGlite.create(`idb://gargalo-projeto-${id}`).catch((err: unknown) => {
      if (dev?.pg === opening) dev = undefined
      throw new Error(`Não foi possível abrir o banco do projeto: ${String(err)}`, { cause: err })
    })
    dev = { id, pg: opening }
  }
  return dev.pg
}

// PGlite's idb:// keeps each database in IndexedDB under /pglite/<name>.
async function dropDev(id: string): Promise<void> {
  if (dev?.id === id) {
    const open = dev.pg
    dev = undefined
    await open.then((db) => db.close()).catch(() => {})
  }
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(`/pglite/gargalo-projeto-${id}`)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error ?? new Error('Não foi possível apagar o banco do projeto.'))
    req.onblocked = () => reject(new Error('Outra aba está com o banco deste projeto aberto. Feche-a e apague de novo.'))
  })
}

const post = (out: unknown) => scope.postMessage(out)

self.addEventListener('message', (e: MessageEvent<WorkerMessage>) => {
  // The player's code (even its top level) only runs once the network is blocked.
  void pg.then(async (db) => {
    const input = e.data
    if ('call' in input) post(await answer(input.call, { test: db, dev: openDev, drop: dropDev }))
    else if ('project' in input) await executeProjectTests(input, db, post)
    else await executeTests(input, pgliteDb(db), post)
  })
})
