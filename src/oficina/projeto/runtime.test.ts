import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { TestCase, TestResult } from '../exercise'
import { loadApp } from './modules'
import { PROJECTS_KEY, type Project, loadProject, loadProjectList, projectKey, removeProject, saveProject, saveProjectList, starter } from './project'
import { answer, executeProjectTests, migrationFiles, type ProjectCall, type RequestOutcome } from './runtime'

// Two real in-memory Postgres: the worker's test database and one project's dev database (IndexedDB in the browser).
let test: PGlite
let devPg: PGlite
beforeAll(async () => {
  ;[test, devPg] = await Promise.all([PGlite.create(), PGlite.create()])
}, 60_000)

const dropped: string[] = []
const dbs = { get test() { return test }, dev: async () => devPg, drop: async (id: string) => void dropped.push(id) }

async function call(c: ProjectCall): Promise<unknown> {
  const out = await answer(c, dbs)
  if ('failed' in out) throw new Error(out.failed)
  return out.reply
}

const send = (project: Project, path: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) =>
  call({ op: 'request', project, request: { path, ...init } }) as Promise<RequestOutcome>

const json = (outcome: RequestOutcome) => JSON.parse(outcome.response!.body) as unknown

async function runTests(project: Project, tests: TestCase[], seed?: string): Promise<TestResult[]> {
  const results: TestResult[] = []
  await executeProjectTests({ project, tests, seed }, test, ({ result }) => results.push(result))
  return results
}

const withFiles = (base: Project, files: Record<string, string>): Project => ({ ...base, files: { ...base.files, ...files } })

describe('loading a project', () => {
  it('answers on the Hono starter and on the fetch starter, both spread over several files', async () => {
    for (const framework of ['hono', 'fetch'] as const) {
      await call({ op: 'reset', project: starter('p', framework) })
      const outcome = await send(starter('p', framework), '/health')
      expect(outcome.response).toMatchObject({ status: 200, headers: { 'content-type': expect.stringContaining('application/json') } })
      expect(json(outcome)).toEqual({ status: 'ok' })
      expect(outcome.metrics.queries).toBe(1)
      expect(outcome.routes).toEqual(framework === 'hono' ? [{ method: 'GET', path: '/health' }] : undefined)
    }
    expect((await send(starter('p', 'fetch'), '/nada')).response?.status).toBe(404)
  })

  it('resolves ./ and ../, with or without .ts, and a folder through its index.ts', () => {
    const app = loadApp({
      'src/index.ts': `import { a } from './lib'\nimport { b } from './lib/b.ts'\nimport { c } from './lib/c.js'\nexport default { fetch: () => new Response(a + b + c) }`,
      'src/lib/index.ts': `export { a } from '../shared/a'`,
      'src/lib/b.ts': `export const b = 'b'`,
      'src/lib/c.ts': `export const c = 'c'`,
      'src/shared/a.ts': `export const a: string = 'a'`,
    })
    return expect(Promise.resolve(app.fetch(new Request('http://x/'), { db: undefined! })).then((r) => r.text())).resolves.toBe('abc')
  })

  it('blocks imports outside the project and the list, naming the import, the allowed packages, the file and the line', () => {
    const files = { 'src/index.ts': `import { Hono } from 'hono'\nimport fs from 'node:fs'\nexport default new Hono()` }
    expect(() => loadApp(files)).toThrow('import "node:fs" não é permitido (em src/index.ts). Pacotes permitidos: hono, hono/http-exception, zod')
    return expect(answer({ op: 'request', project: { id: 'p', framework: 'hono', files }, request: { path: '/' } }, dbs)).resolves.toMatchObject({
      reply: { error: { file: 'src/index.ts', line: 2 } },
    })
  })

  it('explains a missing file, a cycle, a syntax error and an entry without fetch', () => {
    expect(() => loadApp({})).toThrow('Falta o arquivo de entrada src/index.ts.')
    expect(() => loadApp({ 'src/index.ts': `import './nada'` })).toThrow('src/index.ts importa "./nada", mas esse arquivo não existe no projeto.')
    expect(() => loadApp({ 'src/index.ts': `import '../../fora'` })).toThrow('não existe')
    expect(() => loadApp({ 'src/index.ts': `import './a'`, 'src/a.ts': `import './b'`, 'src/b.ts': `import './a'` })).toThrow(
      'Import circular: src/a.ts → src/b.ts → src/a.ts',
    )
    expect(() => loadApp({ 'src/index.ts': `export default {}`, 'src/x.ts': '' })).toThrow('src/index.ts precisa de um export default com fetch(req, env)')
    try {
      loadApp({ 'src/index.ts': `import './a'`, 'src/a.ts': `\nconst x = ;` })
      expect.unreachable()
    } catch (err) {
      expect(err).toMatchObject({ file: 'src/a.ts', line: 2, message: expect.stringMatching(/^Erro de sintaxe em src\/a\.ts/) })
    }
  })

  it('reports an error thrown by a fetch project with its file and line, and logs Hono’s own 500', async () => {
    const thrown = await send(
      { id: 'p', framework: 'fetch', files: { 'src/index.ts': `import { go } from './go'\nexport default { fetch: go }`, 'src/go.ts': `export function go() {\n  throw new Error('quebrou')\n}` } },
      '/',
    )
    expect(thrown.error).toEqual({ message: 'Error: quebrou', file: 'src/go.ts', line: 2 })
    expect((await send({ id: 'p', framework: 'fetch', files: { 'src/index.ts': `export default { fetch: () => 42 }` } }, '/')).error?.message).toBe(
      'fetch(req, env) precisa devolver um Response.',
    )
    const hono = await send(withFiles(starter('p', 'hono'), { 'src/routes/health.ts': `import { Hono } from 'hono'\nexport const health = new Hono()\nhealth.get('/', () => {\n  throw new Error('quebrou')\n})` }), '/health')
    expect(hono.response?.status).toBe(500)
    expect(hono.logs).toEqual([{ level: 'error', text: 'Error: quebrou (src/routes/health.ts:4)' }])
  })

  it('captures console.log, warn and error per request, and puts console back after', async () => {
    const project: Project = {
      id: 'p',
      framework: 'fetch',
      files: { 'src/index.ts': `export default { async fetch(req: Request) {\n  console.log('pedido', req.method, { n: 1 })\n  console.warn('cuidado')\n  console.error(new Error('x'))\n  return new Response('ok')\n} }` },
    }
    const log = console.log
    const outcome = await send(project, '/', { method: 'POST', body: '{}' })
    expect(outcome.logs).toEqual([
      { level: 'log', text: 'pedido POST {"n":1}' },
      { level: 'warn', text: 'cuidado' },
      { level: 'error', text: 'Error: x (src/index.ts:4)' },
    ])
    expect(console.log).toBe(log)
    expect((await send(project, '/')).logs).toHaveLength(3)
  })
})

describe('Hono and zod in a project', () => {
  const routes = `import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'

const Produto = z.object({ nome: z.string().min(1), preco_centavos: z.number().int().nonnegative() })

export const produtos = new Hono<{ Bindings: { db: any } }>()

produtos.post('/', async (c) => {
  const parsed = Produto.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ campos: parsed.error.issues.map((i) => i.path.join('.')) }, 400)
  const [row] = await c.env.db.query('INSERT INTO produtos (nome, preco_centavos) VALUES ($1, $2) RETURNING id, nome', [parsed.data.nome, parsed.data.preco_centavos])
  return c.json(row, 201)
})

produtos.get('/:id', async (c) => {
  const [row] = await c.env.db.query('SELECT id, nome FROM produtos WHERE id = $1', [Number(c.req.param('id'))])
  if (!row) throw new HTTPException(404, { message: 'Produto não encontrado.' })
  return c.json(row)
})
`
  const project = withFiles(starter('loja', 'hono'), {
    'src/index.ts': `import { Hono } from 'hono'\nimport { produtos } from './routes/produtos'\nconst app = new Hono()\napp.route('/produtos', produtos)\nexport default app`,
    'src/routes/produtos.ts': routes,
  })

  it('queries c.env.db, validates with zod and throws HTTPException, against the dev database', async () => {
    await call({ op: 'reset', project })
    expect(await call({ op: 'migrate', project })).toEqual(['001_init.sql'])
    const created = await send(project, '/produtos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"nome":"Caneca","preco_centavos":3500}' })
    expect(created.response?.status).toBe(201)
    expect(json(created)).toEqual({ id: 1, nome: 'Caneca' })
    expect(json(await send(project, '/produtos/1'))).toEqual({ id: 1, nome: 'Caneca' })
    expect((await send(project, '/produtos/2')).response).toMatchObject({ status: 404, body: 'Produto não encontrado.' })
    const invalid = await send(project, '/produtos', { method: 'POST', body: '{"nome":"","preco_centavos":-1}' })
    expect(invalid.response?.status).toBe(400)
    expect(json(invalid)).toEqual({ campos: ['nome', 'preco_centavos'] })
  })

  it('runs acceptance tests on a fresh test database each time, while the dev database keeps its rows', async () => {
    const tests: TestCase[] = [
      {
        name: 'cria',
        requests: [{ request: { method: 'POST', path: '/produtos', body: { nome: 'Vela', preco_centavos: 900 } }, expect: { status: 201, body: { id: 1 } } }],
        db: { sql: 'SELECT count(*)::int AS n FROM produtos', rows: [{ n: 1 }] },
      },
      { name: 'banco novo de novo', requests: [{ request: { path: '/produtos/1' }, expect: { status: 404 } }] },
    ]
    await call({ op: 'reset', project })
    await call({ op: 'migrate', project })
    await send(project, '/produtos', { method: 'POST', body: '{"nome":"Caneca","preco_centavos":3500}' })
    for (let run = 0; run < 2; run++) expect((await runTests(project, tests)).map((r) => [r.name, r.passed, r.message])).toEqual([['cria', true, undefined], ['banco novo de novo', true, undefined]])
    // The seed runs after the migrations.
    expect((await runTests(project, [tests[1]], `INSERT INTO produtos (nome, preco_centavos) VALUES ('Lápis', 100);`))[0]).toMatchObject({ passed: false, expected: 404, received: 200 })
    expect(await call({ op: 'rows', project, table: 'produtos', limit: 10 })).toEqual({ columns: ['id', 'nome', 'preco_centavos'], rows: [{ id: 1, nome: 'Caneca', preco_centavos: 3500 }] })
  })

  it('fails every test with the reason when the project does not load', async () => {
    const results = await runTests(withFiles(project, { 'src/index.ts': `import x from 'express'` }), [{ name: 'a', requests: [] }])
    expect(results).toEqual([{ name: 'a', passed: false, message: expect.stringContaining('import "express" não é permitido'), file: 'src/index.ts', line: 1 }])
  })
})

describe('migrations', () => {
  const project: Project = {
    id: 'm',
    framework: 'fetch',
    files: {
      'src/index.ts': `export default { fetch: () => new Response('') }`,
      'migrations/010_c.sql': `ALTER TABLE a ADD COLUMN c int;`,
      'migrations/002_b.sql': `ALTER TABLE a ADD COLUMN b int;`,
      'migrations/001_a.sql': `CREATE TABLE a (id int);`,
      'migrations/leia-me.md': '',
    },
  }

  it('orders by number, applies only the pending ones and records them in _migrations', async () => {
    expect(migrationFiles(project.files)).toEqual(['migrations/001_a.sql', 'migrations/002_b.sql', 'migrations/010_c.sql'])
    await call({ op: 'reset', project })
    expect(await call({ op: 'migrate', project })).toEqual(['001_a.sql', '002_b.sql', '010_c.sql'])
    expect(await call({ op: 'migrate', project })).toEqual([])
    expect(await call({ op: 'tables', project })).toEqual(['_migrations', 'a'])
    expect((await devPg.query('SELECT name FROM _migrations ORDER BY applied_at, name')).rows).toEqual([{ name: '001_a.sql' }, { name: '002_b.sql' }, { name: '010_c.sql' }])
    const more = withFiles(project, { 'migrations/011_d.sql': `ALTER TABLE a ADD COLUMN d int;` })
    expect(await call({ op: 'migrate', project: more })).toEqual(['011_d.sql'])
  })

  it('names the migration that failed and leaves nothing of it behind', async () => {
    await call({ op: 'reset', project })
    const broken = withFiles(project, { 'migrations/002_b.sql': `ALTER TABLE a ADD COLUMN b int;\nALTER TABLE nada ADD COLUMN x int;` })
    expect(await answer({ op: 'migrate', project: broken }, dbs)).toEqual({ failed: expect.stringContaining('A migração migrations/002_b.sql falhou:') })
    expect(await call({ op: 'rows', project, table: 'a', limit: 1 })).toEqual({ columns: ['id'], rows: [] })
    expect(await call({ op: 'rows', project, table: '_migrations', limit: 5 })).toMatchObject({ rows: [{ name: '001_a.sql' }] })
    // Every call flushes the dev database to IndexedDB before answering.
    const sync = vi.spyOn(devPg, 'syncToFs')
    expect(await call({ op: 'open', project })).toBeUndefined()
    expect(sync).toHaveBeenCalledOnce()
  })

  it('drops a project’s dev database without opening it', async () => {
    const dev = vi.spyOn(dbs, 'dev')
    expect(await answer({ op: 'drop', project: { id: 'm' } }, dbs)).toEqual({ reply: undefined })
    expect(dropped).toEqual(['m'])
    expect(dev).not.toHaveBeenCalled()
    dev.mockRestore()
  })
})

describe('saved projects', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps a project in localStorage and survives storage being off', () => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) })
    expect(loadProject('x')).toBeUndefined()
    expect(saveProject(starter('x', 'hono'))).toBe(true)
    expect(data.has(projectKey('x'))).toBe(true)
    expect(loadProject('x')).toEqual(starter('x', 'hono'))
    const fail = () => {
      throw new Error('off')
    }
    vi.stubGlobal('localStorage', { getItem: fail, setItem: fail })
    expect(saveProject(starter('x', 'hono'))).toBe(false)
    expect(loadProject('x')).toBeUndefined()
  })

  it('keeps the list of projects, forgets a removed one and survives storage being off', () => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) })
    expect(loadProjectList()).toEqual([])
    const list = [{ id: 'x', name: 'Loja', framework: 'hono' as const }]
    expect(saveProjectList(list)).toBe(true)
    expect(loadProjectList()).toEqual(list)
    data.set(PROJECTS_KEY, '{}')
    expect(loadProjectList()).toEqual([])
    saveProject(starter('x', 'hono'))
    removeProject('x')
    expect(loadProject('x')).toBeUndefined()
    const fail = () => {
      throw new Error('off')
    }
    vi.stubGlobal('localStorage', { getItem: fail, setItem: fail, removeItem: fail })
    expect(saveProjectList(list)).toBe(false)
    expect(loadProjectList()).toEqual([])
    expect(() => removeProject('x')).not.toThrow()
  })
})
