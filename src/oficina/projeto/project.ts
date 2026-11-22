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
const isFramework = (f: unknown): f is Framework => f === 'hono' || f === 'fetch'

export const isProject = (v: unknown): v is Project => {
  const p = v as Project
  return !!p && typeof p.id === 'string' && isFramework(p.framework) && !!p.files && typeof p.files === 'object' && Object.values(p.files).every((c) => typeof c === 'string')
}

/**
 * The saved project, or undefined when there is none or it can't be read. An unreadable one is first copied to
 * `<key>:bak` (once), so the starter that replaces it never destroys the only copy.
 */
export function loadProject(id: string): Project | undefined {
  try {
    const saved = localStorage.getItem(projectKey(id))
    if (!saved) return undefined
    let parsed: unknown
    try {
      parsed = JSON.parse(saved)
    } catch {
      parsed = undefined
    }
    if (isProject(parsed)) return parsed
    if (localStorage.getItem(`${projectKey(id)}:bak`) === null) localStorage.setItem(`${projectKey(id)}:bak`, saved)
    return undefined
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
import { bancoResponde } from '../db/saude'
import type { Env } from '../env'

export const health = new Hono<{ Bindings: Env }>()

health.get('/', async (c) => {
  await bancoResponde(c.env.db)
  return c.json({ status: 'ok' })
})
`,
    'src/db/saude.ts': `import type { Env } from '../env'

/** The route never talks SQL itself: database access lives under src/db/. */
export async function bancoResponde(db: Env['db']): Promise<void> {
  await db.query('SELECT 1')
}
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
    'src/routes/health.ts': `import { bancoResponde } from '../db/saude'
import type { Env } from '../env'

export async function health(env: Env): Promise<Response> {
  await bancoResponde(env.db)
  return Response.json({ status: 'ok' })
}
`,
    'src/db/saude.ts': `import type { Env } from '../env'

/** The route never talks SQL itself: database access lives under src/db/. */
export async function bancoResponde(db: Env['db']): Promise<void> {
  await db.query('SELECT 1')
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
  /** Id of the course it follows; missing in projects saved before the choice (they follow `ecommerce`). */
  course?: string
}

export const PROJECTS_KEY = 'gargalo:oficina:projetos'

/** The player's projects, newest last; empty when there are none or storage is off. */
export function loadProjectList(): ProjectEntry[] {
  try {
    const saved = JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? '[]') as unknown
    // A broken entry is dropped, not allowed to take the whole list down.
    return Array.isArray(saved) ? saved.filter((e): e is ProjectEntry => !!e && typeof e.id === 'string' && typeof e.name === 'string' && isFramework(e.framework)) : []
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
