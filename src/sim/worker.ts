// Runs a level off the page's thread, so the page keeps answering while the engine works.

import { runLevel } from './engine'
import type { RunRequest } from './runner'

const scope = self as unknown as { postMessage: (message: unknown) => void }

self.addEventListener('message', (e: MessageEvent<RunRequest>) => {
  const { id, arch, level, seed } = e.data
  scope.postMessage({ id, run: runLevel(arch, level, seed) })
})
