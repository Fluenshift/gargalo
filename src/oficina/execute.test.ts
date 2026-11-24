import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { pgliteDb } from './db'
import { fill, findKey, pick, type ExpectedResponse, type TestCase, type TestResult } from './exercise'
import { compile, executeTests, matches } from './execute'

// One real Postgres for the file, reset before each test like the worker does.
let pg: PGlite
beforeAll(async () => {
  pg = await PGlite.create()
}, 60_000)

const ACCOUNTS = { schema: 'CREATE TABLE contas (id int PRIMARY KEY, saldo int NOT NULL);', seed: 'INSERT INTO contas VALUES (1, 100);' }

async function run(code: string, tests: TestCase[], { schema, seed } = ACCOUNTS): Promise<TestResult[]> {
  const results: TestResult[] = []
  await executeTests({ code, schema, seed, tests }, pgliteDb(pg), ({ result }) => results.push(result))
  return results
}

/** The results without the timings, which change from run to run. */
const stable = (results: TestResult[]) => results.map(({ metrics, ...r }) => ({ ...r, ...(metrics && { metrics: metrics.map(({ queries, rowsRead }) => ({ queries, rowsRead })) }) }))

const created: TestCase = {
  name: 'cria usuário',
  requests: [{ request: { method: 'POST', path: '/usuarios', body: { nome: 'Ana' } }, expect: { status: 201, headers: { location: '/usuarios/1' }, body: { nome: 'Ana' } } }],
}

describe('executeTests', () => {
  it('passes a handler that answers what the test expects', async () => {
    const code = `export default async function handler(req: Request, ctx: Ctx): Promise<Response> {
  const { nome } = (await req.json()) as { nome: string }
  return Response.json({ id: 1, nome }, { status: 201, headers: { location: '/usuarios/1' } })
}`
    expect(stable(await run(code, [created]))).toEqual([{ name: 'cria usuário', passed: true, metrics: [{ queries: 0, rowsRead: 0 }] }])
  })

  it('shows expected against received when an assertion fails', async () => {
    const [status] = await run(`export default async () => new Response('', { status: 400 })`, [created])
    expect(status).toMatchObject({ passed: false, message: 'Status diferente do esperado.', expected: 201, received: 400 })
    const [header] = await run(`export default async () => Response.json({ nome: 'Ana' }, { status: 201 })`, [created])
    expect(header).toMatchObject({ passed: false, expected: '/usuarios/1', received: null })
    const [body] = await run(`export default async () => new Response('oi', { status: 201, headers: { location: '/usuarios/1' } })`, [created])
    expect(body).toMatchObject({ passed: false, message: 'Corpo da resposta diferente do esperado.', expected: { nome: 'Ana' }, received: 'oi' })
    const [notResponse] = await run(`export default async () => 42`, [created])
    expect(notResponse).toMatchObject({ passed: false, message: 'O handler precisa devolver um Response.' })
  })

  it('reports an error thrown by the handler with its line', async () => {
    const code = `export default async function handler(req: Request): Promise<Response> {
  const user: { name?: string } = {}
  throw new Error('quebrou: ' + user.name)
}`
    expect(await run(code, [created])).toEqual([{ name: 'cria usuário', passed: false, message: 'Error: quebrou: undefined', line: 3 }])
  })

  it('reports syntax errors and a missing default export', async () => {
    const [syntax] = await run(`export default async function handler( {\n}`, [created])
    expect(syntax.message).toMatch(/^Erro de sintaxe/)
    expect(syntax.line).toBeTypeOf('number')
    const [missing] = await run(`const handler = 1`, [created])
    expect(missing.message).toMatch(/Falta o export default/)
  })

  it.each([
    ['import', `import pg from 'pg'\nexport default async () => new Response()`, /^import não é permitido/, 1],
    ['dynamic import', `export default async () => {\n  await import('pg')\n  return new Response()\n}`, /^import não é permitido/, 2],
    ['named export', `export const x = 1\nexport default async () => new Response()`, /^Só o export default/, 1],
    ['fetch', `export default async () => {\n\n  return fetch('https://example.com')\n}`, /^fetch não é permitido/, 3],
    ['importScripts', `export default async () => {\n  importScripts('x.js')\n  return new Response()\n}`, /^fetch não é permitido/, 2],
  ])('blocks %s with a clear message', async (_, code, message, line) => {
    const results = await run(code, [created, { ...created, name: 'outro' }])
    expect(results).toHaveLength(2)
    for (const r of results) expect(r).toMatchObject({ passed: false, message: expect.stringMatching(message), line })
  })

  it('interleaves concurrent requests at their awaits, exposing a read-then-write race', async () => {
    const oneSucceeds: TestCase = {
      name: 'dois saques ao mesmo tempo',
      requests: [200, 409].map((status) => ({ request: { method: 'POST', path: '/saques', body: { valor: 60 } }, expect: { status } })),
      db: { sql: 'SELECT saldo FROM contas', rows: [{ saldo: 40 }] },
    }
    // Both read 100 before either writes, so both withdrawals go through.
    const naive = `export default async function handler(req: Request, ctx: Ctx) {
  const { valor } = await req.json()
  const [{ saldo }] = await ctx.db.query<{ saldo: number }>('SELECT saldo FROM contas')
  if (saldo < valor) return new Response('sem saldo', { status: 409 })
  await ctx.db.query('UPDATE contas SET saldo = $1', [saldo - valor])
  return new Response('ok')
}`
    // Each request's queries are counted on its own: a read and a write each.
    expect(stable(await run(naive, [oneSucceeds]))).toEqual([
      { name: 'dois saques ao mesmo tempo', passed: false, message: 'Requisição 2 (POST /saques): Status diferente do esperado.', expected: 409, received: 200, metrics: [{ queries: 2, rowsRead: 2 }, { queries: 2, rowsRead: 2 }] },
    ])

    const conditional = `export default async function handler(req: Request, ctx: Ctx) {
  const { valor } = await req.json()
  const rows = await ctx.db.transaction((tx) => tx.query('UPDATE contas SET saldo = saldo - $1 WHERE saldo >= $1 RETURNING saldo', [valor]))
  return rows.length ? new Response('ok') : new Response('sem saldo', { status: 409 })
}`
    // The explain inside the transaction is rolled back: the balance is 40, not -20.
    expect(stable(await run(conditional, [oneSucceeds]))).toEqual([{ name: 'dois saques ao mesmo tempo', passed: true, metrics: [{ queries: 1, rowsRead: 1 }, { queries: 1, rowsRead: 1 }] }])
  })

  it('checks the database state after the requests and gives the test clock to ctx.now', async () => {
    const test: TestCase = { name: 'relógio', now: 1234, requests: [{ request: { path: '/' }, expect: { status: 200, body: { agora: 1234 } } }], db: { sql: 'SELECT saldo FROM contas', rows: [{ saldo: 100 }] } }
    const code = `export default async (req: Request, ctx: Ctx) => Response.json({ agora: ctx.now() })`
    expect(await run(code, [test])).toMatchObject([{ name: 'relógio', passed: true }])
    const [wrong] = await run(code, [{ ...test, db: { sql: 'SELECT saldo FROM contas', rows: [{ saldo: 0 }] } }])
    expect(wrong).toMatchObject({ passed: false, message: 'Estado do banco diferente do esperado.', expected: [{ saldo: 0 }], received: [{ saldo: 100 }] })
  })

  it('runs a sequential test step by step, carrying saved values into the next request, expect and db params', async () => {
    const code = `export default async function handler(req: Request, ctx: Ctx): Promise<Response> {
  const { pathname } = new URL(req.url)
  if (req.method === 'POST') {
    const [row] = await ctx.db.query<{ id: number }>('INSERT INTO contas (id, saldo) VALUES (7, 5) RETURNING id')
    return Response.json({ id: row.id }, { status: 201, headers: { location: '/contas/' + row.id } })
  }
  const id = Number(pathname.split('/')[2])
  const [conta] = await ctx.db.query('SELECT id, saldo FROM contas WHERE id = $1', [id])
  return conta ? Response.json(conta) : new Response('', { status: 404 })
}`
    const test: TestCase = {
      name: 'cria e lê',
      sequential: true,
      capture: true,
      requests: [
        { request: { method: 'POST', path: '/contas' }, expect: { status: 201 }, save: { id: 'body.id', onde: 'header.Location' } },
        { request: { path: '{{onde}}' }, expect: { status: 200, body: { id: '{{id}}', saldo: 5 } } },
      ],
      db: { sql: 'SELECT saldo FROM contas WHERE id = $1', params: ['{{id}}'] },
    }
    const [ok] = await run(code, [test])
    expect(ok).toMatchObject({ passed: true, rows: [{ saldo: 5 }], responses: [{ status: 201, body: { id: 7 } }, { status: 200, body: { id: 7, saldo: 5 } }] })
    const [missing] = await run(code, [{ ...test, requests: [{ ...test.requests[0], save: { x: 'body.nada' } }] }])
    expect(missing).toMatchObject({ passed: false, message: 'a resposta não tem body.nada (para {{x}}).', responses: [{ status: 201 }] })
    const [stops] = await run(code, [{ ...test, requests: [{ ...test.requests[0], expect: { status: 200 } }, test.requests[1]] }])
    expect(stops).toMatchObject({ passed: false, message: 'Requisição 1 (POST /contas): Status diferente do esperado.' })
    expect(stops.responses).toHaveLength(1)
    // The request is named as it was sent, with the saved values in it.
    const [later] = await run(code, [{ ...test, requests: [test.requests[0], { ...test.requests[1], expect: { status: 404 } }] }])
    expect(later).toMatchObject({ passed: false, message: 'Requisição 2 (GET /contas/7): Status diferente do esperado.' })
  })

  it('refuses a key the body must not have, at any depth and in any case, and a request over its queries', async () => {
    // One query for the accounts, then one per account: an N+1.
    const code = `export default async function handler(req: Request, ctx: Ctx) {
  const contas = await ctx.db.query<{ id: number }>('SELECT id FROM contas')
  for (const c of contas) Object.assign(c, (await ctx.db.query('SELECT saldo FROM contas WHERE id = $1', [c.id]))[0])
  return Response.json({ contas: contas.map((c) => ({ ...c, dono: { Senha_Hash: 'h1' } })) })
}`
    const test = (expect: ExpectedResponse): TestCase => ({ name: 'contas', requests: [{ request: { path: '/contas' }, expect }] })
    const [leak] = await run(code, [test({ status: 200, absent: ['senha_hash'] })])
    expect(leak).toMatchObject({ passed: false, message: 'A resposta traz o campo Senha_Hash, que não pode sair.' })
    expect(leak).not.toHaveProperty('expected')
    expect(await run(code, [test({ status: 200, maxQueries: 1 })])).toMatchObject([{ passed: false, message: 'A requisição fez 2 consultas ao banco; o máximo é 1.' }])
    expect(await run(`export default async (req: Request, ctx: Ctx) => Response.json(await ctx.db.query('SELECT 1 AS um'))`, [test({ status: 200, maxQueries: 0 })])).toMatchObject([
      { passed: false, message: 'A requisição fez 1 consulta ao banco; o máximo é 0.' },
    ])
    // A wrong body is said first; within the limits, the test passes.
    expect(await run(code, [test({ status: 200, body: { contas: [] }, absent: ['senha_hash'] })])).toMatchObject([{ passed: false, message: 'Corpo da resposta diferente do esperado.' }])
    expect(await run(code, [test({ status: 200, absent: ['senha'], maxQueries: 2 })])).toMatchObject([{ passed: true }])
  })
})

describe('ctx.db on Postgres', () => {
  const SHOP = {
    schema: `CREATE TABLE produtos (id serial PRIMARY KEY, nome text NOT NULL);
CREATE TABLE itens (pedido_id int NOT NULL, produto_id int NOT NULL REFERENCES produtos);`,
    seed: `INSERT INTO produtos (nome) SELECT 'produto ' || g FROM generate_series(1, 5000) g;
INSERT INTO itens VALUES (1, 10), (1, 20), (1, 30), (2, 40);`,
  }
  const order: TestCase = {
    name: 'pedido com itens',
    requests: [{ request: { path: '/pedidos/1' }, expect: { status: 200, body: ['produto 10', 'produto 20', 'produto 30'] } }],
  }

  it('counts one query per item in an N+1 handler and one with a JOIN', async () => {
    const nPlusOne = `export default async (req: Request, ctx: Ctx) => {
  const itens = await ctx.db.query<{ produto_id: number }>('SELECT produto_id FROM itens WHERE pedido_id = $1 ORDER BY produto_id', [1])
  const nomes = []
  for (const item of itens) {
    const [p] = await ctx.db.query<{ nome: string }>('SELECT nome FROM produtos WHERE id = $1', [item.produto_id])
    nomes.push(p.nome)
  }
  return Response.json(nomes)
}`
    const join = `export default async (req: Request, ctx: Ctx) => {
  const rows = await ctx.db.query<{ nome: string }>('SELECT p.nome FROM itens i JOIN produtos p ON p.id = i.produto_id WHERE i.pedido_id = $1 ORDER BY p.id', [1])
  return Response.json(rows.map((r) => r.nome))
}`
    const [slow] = await run(nPlusOne, [order], SHOP)
    const [fast] = await run(join, [order], SHOP)
    expect(slow).toMatchObject({ passed: true, metrics: [{ queries: 4 }] })
    expect(fast).toMatchObject({ passed: true, metrics: [{ queries: 1 }] })
    expect(slow.metrics?.[0].handlerMs).toBeGreaterThanOrEqual(0)
  })

  it('reads fewer rows once the searched column has an index', async () => {
    const search: TestCase = { name: 'busca', requests: [{ request: { path: '/produtos?busca=produto%2042' }, expect: { status: 200, body: [{ id: 42 }] } }] }
    const code = `export default async (req: Request, ctx: Ctx) => {
  const busca = new URL(req.url).searchParams.get('busca')
  return Response.json(await ctx.db.query('SELECT id, nome FROM produtos WHERE nome = $1', [busca]))
}`
    const [scan] = await run(code, [search], SHOP)
    const [indexed] = await run(code, [search], { ...SHOP, schema: `${SHOP.schema}\nCREATE INDEX ON produtos (nome);` })
    expect(scan).toMatchObject({ passed: true, metrics: [{ queries: 1, rowsRead: 5000 }] })
    expect(indexed).toMatchObject({ passed: true, metrics: [{ queries: 1, rowsRead: 1 }] })
  })

  it('does not burn ids on INSERTs, and each test starts from the seed', async () => {
    const schema = 'CREATE TABLE usuarios (id serial PRIMARY KEY, nome text NOT NULL);'
    const code = `export default async (req: Request, ctx: Ctx) => {
  const { nome } = await req.json()
  const [u] = await ctx.db.query<{ id: number }>('INSERT INTO usuarios (nome) VALUES ($1) RETURNING id', [nome])
  return Response.json({ id: u.id, nome }, { status: 201, headers: { location: '/usuarios/' + u.id } })
}`
    const withState: TestCase = { ...created, db: { sql: 'SELECT id, nome FROM usuarios', rows: [{ id: 1, nome: 'Ana' }] } }
    const results = await run(code, [withState, { ...withState, name: 'de novo' }], { schema, seed: '' })
    expect(stable(results)).toEqual([
      { name: 'cria usuário', passed: true, metrics: [{ queries: 1, rowsRead: 0 }] },
      { name: 'de novo', passed: true, metrics: [{ queries: 1, rowsRead: 0 }] },
    ])
    const [wrong] = await run(code, [{ ...withState, db: { sql: 'SELECT nome FROM usuarios', rows: [] } }], { schema, seed: '' })
    expect(wrong).toMatchObject({ passed: false, message: 'Estado do banco diferente do esperado.', received: [{ nome: 'Ana' }] })
  })

  it('rolls a transaction back when it throws, and a nested one back to its savepoint', async () => {
    const test: TestCase = { name: 'rollback', requests: [{ request: { path: '/' }, expect: { status: 500 } }], db: { sql: 'SELECT id, saldo FROM contas ORDER BY id', rows: [{ id: 1, saldo: 100 }, { id: 2, saldo: 7 }] } }
    const code = `export default async (req: Request, ctx: Ctx) => {
  await ctx.db.transaction(async (tx) => {
    await tx.query('INSERT INTO contas VALUES (2, 7)')
    await tx.transaction(async (inner) => {
      await inner.query('UPDATE contas SET saldo = 0')
      throw new Error('desfaz só o de dentro')
    }).catch(() => {})
    await tx.transaction((inner) => inner.query('SELECT 1'))
  })
  try {
    await ctx.db.transaction(async (tx) => {
      await tx.query('UPDATE contas SET saldo = 0')
      throw new Error('desfaz tudo')
    })
  } catch {
    return new Response('erro', { status: 500 })
  }
  return new Response('ok')
}`
    expect(await run(code, [test])).toMatchObject([{ passed: true, metrics: [{ queries: 4 }] }])
  })

  it('runs statements EXPLAIN cannot take, and gives SQL errors back as they are', async () => {
    const test: TestCase = { name: 'sql', requests: [{ request: { path: '/' }, expect: { status: 200 } }] }
    const ddl = `export default async (req: Request, ctx: Ctx) => {
  await ctx.db.query('CREATE INDEX ON contas (saldo)')
  return new Response('ok')
}`
    expect(await run(ddl, [test])).toMatchObject([{ passed: true, metrics: [{ queries: 1, rowsRead: 0 }] }])
    const typo = `export default async (req: Request, ctx: Ctx) => {
  await ctx.db.query('SELEC saldo FROM contas')
  return new Response('ok')
}`
    const [failed] = await run(typo, [test])
    expect(failed).toMatchObject({ passed: false, message: expect.stringMatching(/syntax error/) })
  })
})

describe('compile', () => {
  it('returns the default export and the migration, if any', () => {
    expect(typeof compile('export default async function handler() { return new Response() }').handler).toBe('function')
    expect(compile('export const migration = "CREATE INDEX x ON t (a)"\nexport default async () => new Response()').migration).toBe('CREATE INDEX x ON t (a)')
    expect(() => compile('export const migration = 1\nexport default async () => new Response()')).toThrow(/A migration precisa ser um texto/)
  })

  it('runs the migration after the data, and says when it fails', async () => {
    const code = (sql: string) => `export const migration = ${JSON.stringify(sql)}
export default async (req: Request, ctx: Ctx) => Response.json(await ctx.db.query("SELECT indexname FROM pg_indexes WHERE indexname = 'contas_saldo'"))`
    const test: TestCase = { name: 'índice', requests: [{ request: { path: '/' }, expect: { status: 200, body: [{ indexname: 'contas_saldo' }] } }] }
    expect(await run(code('CREATE INDEX contas_saldo ON contas (saldo)'), [test])).toMatchObject([{ passed: true }])
    expect(await run(code('CREATE INDEX contas_saldo ON nada (saldo)'), [test])).toMatchObject([{ passed: false, message: expect.stringMatching(/A migration falhou: .*nada/) }])
  })
})

describe('matches', () => {
  it('matches objects by the expected keys, arrays and values exactly', () => {
    expect(matches({ a: 1 }, { a: 1, b: 2 })).toBe(true)
    expect(matches({ a: 1 }, null)).toBe(false)
    expect(matches([1, 2], [1, 2])).toBe(true)
    expect(matches([1], [1, 2])).toBe(false)
    expect(matches([1], 'x')).toBe(false)
    expect(matches(null, null)).toBe(true)
  })
})

describe('session state between tests', () => {
  const show = (what: string) => `export default async (req: Request, ctx: Ctx) => Response.json((await ctx.db.query('SHOW ${what}'))[0])`
  const probe = (name: string, key: string, value: unknown): TestCase => ({ name, requests: [{ request: { path: '/' }, expect: { status: 200, body: { [key]: value } } }] })

  it('undoes SET and an open transaction the handler left behind', async () => {
    await run(`export default async (req: Request, ctx: Ctx) => { await ctx.db.query("SET application_name = 'vazou'"); return new Response('ok') }`, [
      { name: 'sujo', requests: [{ request: { path: '/' }, expect: { status: 200 } }] },
    ])
    expect(await run(show('application_name'), [probe('limpo', 'application_name', '')])).toMatchObject([{ passed: true }])

    // A transaction the handler could not close (a driver-level BEGIN) must not carry into the next test.
    await pg.exec('BEGIN ISOLATION LEVEL SERIALIZABLE')
    expect(await run(show('transaction_isolation'), [probe('limpo', 'transaction_isolation', 'read committed')])).toMatchObject([{ passed: true }])
  })
})

describe('fill and pick', () => {
  it('replaces {{name}} deep inside values, keeping the type when the string is only the variable', () => {
    expect(fill({ a: '{{n}}', b: ['x-{{n}}-{{s}}', '{{nada}}'], c: 1, d: null }, { n: 3, s: 'oi' })).toEqual({ a: 3, b: ['x-3-oi', '{{nada}}'], c: 1, d: null })
  })
  it('reads status, headers and body paths, and nothing else', () => {
    const res = { status: 201, headers: { location: '/a/1' }, body: { itens: [{ id: 9 }] } }
    expect([pick(res, 'status'), pick(res, 'header.Location'), pick(res, 'body.itens.0.id'), pick(res, 'body.x.y'), pick(res, 'outra'), pick(undefined, 'status')]).toEqual([201, '/a/1', 9, undefined, undefined, undefined])
  })
  it('finds the first forbidden key at any depth, in arrays too, ignoring case', () => {
    expect(findKey([{ id: 1, dono: { nome: 'Ana', SENHA_HASH: 'h' } }], ['senha', 'senha_hash'])).toBe('SENHA_HASH')
    expect(findKey({ itens: [1, 'x', null, [{ senha: 's' }]] }, ['Senha'])).toBe('senha')
    expect([findKey({ senhas: 1 }, ['senha']), findKey('senha', ['senha']), findKey(null, ['senha'])]).toEqual([undefined, undefined, undefined])
  })
})
