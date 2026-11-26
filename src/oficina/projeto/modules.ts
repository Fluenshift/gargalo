// Loads a project's files as CommonJS modules: each one compiled by sucrase, relative imports between them, and a closed list of packages.

import * as hono from 'hono'
import * as honoHttpException from 'hono/http-exception'
import { transform } from 'sucrase'
import * as zod from 'zod'
import type { Db } from '../exercise'

/** The only packages a project can import, bundled into the Oficina worker. */
export const PACKAGES: Record<string, unknown> = { hono, 'hono/http-exception': honoHttpException, zod }

export const ENTRY = 'src/index.ts'
// Stack frames of project code read `projeto://<path>:<line>` (matched in locate), so errors point at the file and line.
const SOURCE_PREFIX = 'projeto://'

export interface Env {
  db: Db
}

export interface App {
  fetch(req: Request, env: Env): Response | Promise<Response>
}

/** An error in the player's code, with where it happened when known. */
export class ProjectError extends Error {
  file?: string
  line?: number
  constructor(message: string, file?: string, line?: number) {
    super(message)
    this.file = file
    this.line = line
  }
}

/** Where an error happened in the project: its own location, or the first project frame of its stack. */
export function locate(err: unknown): { file?: string; line?: number } {
  if (err instanceof ProjectError && err.file) return { file: err.file, line: err.line }
  const match = /projeto:\/\/([^\s:()]+):(\d+)/.exec(String((err as Error)?.stack))
  return match ? { file: match[1], line: Number(match[2]) } : {}
}

/** `./a`, `../b/c.ts` from `src/x/y.ts`; undefined when it climbs out of the project. */
function join(from: string, spec: string): string | undefined {
  const parts = from.split('/').slice(0, -1)
  for (const part of spec.split('/')) {
    if (part === '..') {
      if (!parts.length) return undefined
      parts.pop()
    } else if (part !== '.' && part !== '') parts.push(part)
  }
  return parts.join('/')
}

function resolve(files: Record<string, string>, from: string, spec: string): string | undefined {
  const path = join(from, spec)
  if (path === undefined) return undefined
  // TypeScript lets `./a.js` name `a.ts`.
  const candidates = [path, `${path}.ts`, `${path}/index.ts`, path.replace(/\.js$/, '.ts')]
  return candidates.find((p) => p.endsWith('.ts') && p in files)
}

/** Evaluates the project from `src/index.ts`; modules are cached for this load only, so each load starts clean. */
export function loadApp(files: Record<string, string>): App {
  if (!(ENTRY in files)) throw new ProjectError(`Falta o arquivo de entrada ${ENTRY}.`)
  const cache = new Map<string, { exports: Record<string, unknown> }>()
  const loading: string[] = []

  function load(path: string): Record<string, unknown> {
    const cached = cache.get(path)
    if (cached) return cached.exports
    if (loading.includes(path)) {
      throw new ProjectError(
        `Import circular: ${[...loading.slice(loading.indexOf(path)), path].join(' → ')}. Mova o que os dois usam para um terceiro arquivo.`,
        path,
      )
    }
    let js: string
    try {
      // Unused imports are kept, so a blocked one is reported even before it is used.
      js = transform(files[path], { transforms: ['typescript', 'imports'], filePath: path, keepUnusedImports: true }).code
    } catch (err) {
      const message = (err as Error).message
      throw new ProjectError(`Erro de sintaxe em ${path}: ${message}`, path, Number(/\((\d+):\d+\)$/.exec(message)?.[1]) || undefined)
    }
    const module = { exports: {} as Record<string, unknown> }
    const require = (spec: string) => {
      if (!spec.startsWith('./') && !spec.startsWith('../')) {
        if (spec in PACKAGES) return PACKAGES[spec]
        throw new ProjectError(
          `import "${spec}" não é permitido (em ${path}). Pacotes permitidos: ${Object.keys(PACKAGES).join(', ')}; arquivos do projeto com ./ ou ../.`,
        )
      }
      const target = resolve(files, path, spec)
      if (!target) throw new ProjectError(`${path} importa "${spec}", mas esse arquivo não existe no projeto.`)
      return load(target)
    }
    loading.push(path)
    try {
      // Same first line as the file, so line numbers in errors match the editor; sucrase keeps lines too.
      // oxlint-disable-next-line no-eval -- running the player's code is the point; it happens inside the Oficina worker.
      const factory = (0, eval)(`(function (exports, require, module) {${js}\n})\n//# sourceURL=${SOURCE_PREFIX}${path}`) as (
        e: unknown,
        r: unknown,
        m: unknown,
      ) => void
      factory(module.exports, require, module)
    } finally {
      loading.pop()
    }
    cache.set(path, module)
    return module.exports
  }

  const app = load(ENTRY).default as Partial<App> | undefined
  if (typeof app?.fetch !== 'function') {
    throw new ProjectError(
      `${ENTRY} precisa de um export default com fetch(req, env): export default app (Hono) ou export default { fetch(req, env) { … } }.`,
      ENTRY,
    )
  }
  return app as App
}
