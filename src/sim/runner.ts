// Where a run happens: in a worker when the browser has one, on the page otherwise. Same run either way.

import { runLevel } from './engine'
import type { Architecture, Level } from './model'

export type Run = ReturnType<typeof runLevel>

export interface RunRequest {
  id: number
  arch: Architecture
  level: Level
  seed: number
}

let worker: Worker | null | undefined
let nextId = 0
const waiting = new Map<number, { request: RunRequest; resolve: (run: Run) => void }>()

function startWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (e: MessageEvent<{ id: number; run: Run }>) => {
      waiting.get(e.data.id)?.resolve(e.data.run)
      waiting.delete(e.data.id)
    })
    // A worker that cannot start or breaks hands what it held back to the page.
    worker.addEventListener('error', () => {
      worker = null
      for (const { request, resolve } of waiting.values()) resolve(runLevel(request.arch, request.level, request.seed))
      waiting.clear()
    })
  } catch {
    worker = null
  }
  return worker
}

/** Runs the level for this design and seed without holding up the page when it can. */
export function runInBackground(arch: Architecture, level: Level, seed: number): Promise<Run> {
  const w = startWorker()
  if (!w) return Promise.resolve(runLevel(arch, level, seed))
  return new Promise((resolve) => {
    const request = { id: nextId++, arch, level, seed }
    waiting.set(request.id, { request, resolve })
    w.postMessage(request)
  })
}
