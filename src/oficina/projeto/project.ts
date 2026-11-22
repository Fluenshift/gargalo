// A project: the player's files and the framework they chose. Plain data, so it crosses postMessage and fits in localStorage.

export type Framework = 'hono' | 'fetch'

export interface Project {
  id: string
  framework: Framework
  /** By path from the project root: `src/index.ts`, `src/routes/produtos.ts`, `migrations/001_init.sql`. */
  files: Record<string, string>
}

export const projectKey = (id: string) => `gargalo:oficina:projeto:${id}`

/** The saved project, or undefined when there is none, it is unreadable or storage is off. */
export function loadProject(id: string): Project | undefined {
  try {
    const saved = localStorage.getItem(projectKey(id))
    return saved ? (JSON.parse(saved) as Project) : undefined
  } catch {
    return undefined
  }
}

/** Keeps the project; returns false when the browser refuses (it still works this visit). */
export function saveProject(project: Project): boolean {
  try {
    localStorage.setItem(projectKey(project.id), JSON.stringify(project))
    return true
  } catch {
    return false
  }
}

const ENV = `export interface Env {
  db: {
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
    transaction<R>(fn: (tx: Env['db']) => Promise<R>): Promise<R>
  }
}
`

const INIT = `CREATE TABLE produtos (
  id serial PRIMARY KEY,
  nome text NOT NULL,
  preco_centavos int NOT NULL CHECK (preco_centavos >= 0)
);
`

const STARTERS: Record<Framework, Record<string, string>> = {
  hono: {
    'src/index.ts': `import { Hono } from 'hono'
import type { Env } from './env'
import { health } from './routes/health'

const app = new Hono<{ Bindings: Env }>()

app.route('/health', health)

export default app
`,
    'src/routes/health.ts': `import { Hono } from 'hono'
import type { Env } from '../env'

export const health = new Hono<{ Bindings: Env }>()

health.get('/', async (c) => {
  await c.env.db.query('SELECT 1')
  return c.json({ status: 'ok' })
})
`,
    'src/env.ts': ENV,
    'migrations/001_init.sql': INIT,
  },
  fetch: {
    'src/index.ts': `import type { Env } from './env'
import { health } from './routes/health'

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url)
    if (req.method === 'GET' && pathname === '/health') return health(env)
    return Response.json({ erro: 'Rota não encontrada.' }, { status: 404 })
  },
}
`,
    'src/routes/health.ts': `import type { Env } from '../env'

export async function health(env: Env): Promise<Response> {
  await env.db.query('SELECT 1')
  return Response.json({ status: 'ok' })
}
`,
    'src/env.ts': ENV,
    'migrations/001_init.sql': INIT,
  },
}

/** A new project with a health route and one migration. */
export const starter = (id: string, framework: Framework): Project => ({ id, framework, files: { ...STARTERS[framework] } })

/** What the Projetos list shows; the files live under each project's own key. */
export interface ProjectEntry {
  id: string
  name: string
  framework: Framework
}

export const PROJECTS_KEY = 'gargalo:oficina:projetos'

/** The player's projects, newest last; empty when there are none or storage is off. */
export function loadProjectList(): ProjectEntry[] {
  try {
    const saved = JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? '[]') as unknown
    return Array.isArray(saved) ? (saved as ProjectEntry[]) : []
  } catch {
    return []
  }
}

export function saveProjectList(list: ProjectEntry[]): boolean {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

/** Forgets a project's files (its list entry and dev database are the caller's). */
export function removeProject(id: string) {
  try {
    localStorage.removeItem(projectKey(id))
  } catch {
    // Storage off: nothing was kept.
  }
}
