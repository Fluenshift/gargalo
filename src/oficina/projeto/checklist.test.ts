import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import type { TestResult } from '../exercise'
import { CATALOGUE, checkTests, evaluateChecklist, info, scan, type CheckOutcome, type CheckRef } from './checklist'
import { executeProjectTests } from './runtime'

let pg: PGlite
beforeAll(async () => {
  pg = await PGlite.create()
}, 60_000)

type Files = Record<string, string>

/** Runs the item's tests (if any) on a fresh test database, then judges it. */
async function check(ref: CheckRef, files: Files, seed?: string): Promise<CheckOutcome> {
  const results: TestResult[] = []
  await executeProjectTests({ project: { id: 'p', framework: 'fetch', files }, tests: checkTests([ref]), seed }, pg, ({ result }) => results.push(result))
  return evaluateChecklist([ref], files, results)[0]
}

/** A fetch puro app whose handler body is `body`, with `sql` as its one migration. */
const app = (body: string, sql = 'CREATE TABLE t (id serial PRIMARY KEY);', extra: Files = {}): Files => ({
  'src/index.ts': `export default { async fetch(req: Request, env: any): Promise<Response> {
  const { pathname, searchParams } = new URL(req.url)
  const db = env.db
${body}
} }`,
  'migrations/001_init.sql': sql,
  ...extra,
})

const repo = (src: string): Files => ({ 'src/index.ts': 'export default { fetch: () => new Response() }', 'src/db/repo.ts': src })

describe('scan', () => {
  it('finds strings and templates, blanks them and comments, and follows ${} into nested templates', () => {
    const src = "const a = 'x' // 'nao'\n/* `nem` */ const b = `um ${f(`dois ${3}`, \"tr\\\"es\")} fim`"
    const { literals, code } = scan(src)
    expect(literals.map((l) => [l.text, l.interpolated])).toEqual([
      ['x', false],
      ['um ? fim', true],
      ['dois ?', true],
      ['tr"es', false],
    ])
    expect(code).not.toMatch(/nao|nem|um|dois/)
    expect(code.split('\n')).toHaveLength(2)
  })
  it('stops at an unclosed comment or string', () => {
    expect(scan('a /* sem fim').literals).toEqual([])
    expect(scan("a 'sem fim").literals[0].text).toBe('sem fim')
  })
})

describe('static items', () => {
  it('sql-parametrizado: flags ${} and + in SQL, not params', async () => {
    const ok = await check({ id: 'sql-parametrizado' }, repo("export const f = (db, id) => db.query('SELECT nome FROM t WHERE id = $1', [id])\nconst msg = `Produto ${1} não existe`"))
    expect(ok).toMatchObject({ passed: true, kind: 'static' })
    const template = await check({ id: 'sql-parametrizado' }, repo('export const f = (db, id) =>\n  db.query(`SELECT nome FROM t WHERE id = ${id}`)'))
    expect(template).toMatchObject({ passed: false, message: 'src/db/repo.ts:2: SQL montado com ${…}.' })
    const plus = await check({ id: 'sql-parametrizado' }, repo("export const f = (db, nome) => db.query(\"SELECT id FROM t WHERE nome = '\" + nome + \"'\")"))
    expect(plus.passed).toBe(false)
    const piece = await check({ id: 'sql-parametrizado' }, repo('let sql = "SELECT id FROM t"\nsql += ` WHERE nome = ${nome}`'))
    expect(piece.message).toBe('src/db/repo.ts:2: SQL montado com ${…}.')
  })

  it('camadas: routes and the entry must not query, other modules may', async () => {
    const files = { 'src/index.ts': 'export default { fetch: (req, env) => listar(env) }', 'src/db/produtos.ts': "export const listar = (db) => db.query('SELECT 1')" }
    expect(await check({ id: 'camadas' }, files)).toMatchObject({ passed: true })
    // c.req.query is Hono's query string, not SQL.
    expect(await check({ id: 'camadas' }, { ...files, 'src/routes/p.ts': "r.get('/', (c) => listar(c.env.db, c.req.query('q')))" })).toMatchObject({ passed: true })
    const bad = await check({ id: 'camadas' }, { ...files, 'src/routes/p.ts': "r.get('/', async (c) => {\n  return c.json(await c.env.db.query('SELECT 1'))\n})" })
    expect(bad).toMatchObject({ passed: false, message: 'src/routes/p.ts:2: a rota chama o banco direto.' })
  })

  it('sem-select-estrela: flags SELECT * and t.*, not count(*)', async () => {
    expect(await check({ id: 'sem-select-estrela' }, repo("db.query('SELECT count(*) FROM t'); db.query('SELECT id, nome FROM t')"))).toMatchObject({ passed: true })
    expect(await check({ id: 'sem-select-estrela' }, repo("db.query('select p.* from t p')"))).toMatchObject({ passed: false, message: 'src/db/repo.ts:1: SELECT *.' })
  })

  it('transacao: a file writing two tables needs db.transaction', async () => {
    const writes = "await tx.query('INSERT INTO pedidos (cliente) VALUES ($1)', [c])\nawait tx.query('UPDATE estoque SET qtd = qtd - 1 WHERE id = $1', [p])"
    expect(await check({ id: 'transacao' }, repo(`await db.transaction(async (tx) => {\n${writes}\n})`))).toMatchObject({ passed: true })
    expect(await check({ id: 'transacao' }, repo("await db.query('INSERT INTO pedidos DEFAULT VALUES')"))).toMatchObject({ passed: true })
    expect(await check({ id: 'transacao' }, repo(writes.replaceAll('tx.', 'db.')))).toMatchObject({ passed: false, message: 'src/db/repo.ts: escreve em pedidos, estoque sem db.transaction.' })
  })
})

describe('behaviour items', () => {
  const PRODUTOS = 'CREATE TABLE produtos (id serial PRIMARY KEY, nome text NOT NULL, custo int NOT NULL DEFAULT 0);'
  const create = { method: 'POST', path: '/produtos', body: { nome: 'Caneta' } }

  it('criado-201-location: 201, a Location and a GET that finds it', async () => {
    const ref: CheckRef = { id: 'criado-201-location', request: create }
    const handler = (status: number, location: string) => `if (req.method === 'POST') {
    const [p] = await db.query('INSERT INTO produtos (nome) VALUES ($1) RETURNING id, nome', [(await req.json()).nome])
    return Response.json(p, { status: ${status}, headers: ${location} })
  }
  const [p] = await db.query('SELECT id, nome FROM produtos WHERE id = $1', [Number(pathname.split('/')[2])])
  return p ? Response.json(p) : new Response(null, { status: 404 })`
    expect(await check(ref, app(handler(201, '{ Location: `/produtos/${p.id}` }'), PRODUTOS))).toMatchObject({ passed: true, message: '201 com Location: /produtos/1.' })
    expect(await check(ref, app(handler(200, '{}'), PRODUTOS))).toMatchObject({ passed: false, message: 'POST /produtos respondeu 200, esperado 201.' })
    expect(await check(ref, app(handler(201, '{}'), PRODUTOS))).toMatchObject({ passed: false, message: 'Faltou o cabeçalho Location.' })
    expect(await check(ref, app(handler(201, "{ Location: '/outro/9' }"), PRODUTOS))).toMatchObject({ passed: false, message: 'GET /outro/9 respondeu 404, esperado 200.' })
  })

  it('problem-json: content type and type, title, status; also with Hono', async () => {
    const ref: CheckRef = { id: 'problem-json', request: { path: '/produtos/99' } }
    const hono = {
      'src/index.ts': `import { Hono } from 'hono'
const app = new Hono()
app.get('/produtos/:id', (c) => c.json({ type: 'about:blank', title: 'Não encontrado', status: 404 }, 404, { 'Content-Type': 'application/problem+json' }))
export default app`,
    }
    expect(await check(ref, hono)).toMatchObject({ passed: true, kind: 'behaviour' })
    expect(await check(ref, app("return Response.json({ erro: 'não achei' }, { status: 404 })"))).toMatchObject({ passed: false, message: 'Content-Type foi application/json, esperado application/problem+json.' })
    const wrongBody = app("return Response.json({ title: 'x', status: 400 }, { status: 404, headers: { 'Content-Type': 'application/problem+json' } })")
    expect(await check(ref, wrongBody)).toMatchObject({ passed: false, message: 'O corpo não tem type, status (status deve repetir o da resposta).' })
    expect(await check(ref, app('return new Response()'))).toMatchObject({ passed: false, message: 'GET /produtos/99 respondeu 200; esperado um erro.' })
  })

  it('validacao-400: 400 naming every invalid field', async () => {
    const ref: CheckRef = { id: 'validacao-400', request: { method: 'POST', path: '/produtos', body: { nome: '', preco: -1 } }, fields: ['nome', 'preco'] }
    expect(await check(ref, app("return Response.json({ campos: { nome: 'vazio', preco: 'negativo' } }, { status: 400 })"))).toMatchObject({ passed: true })
    expect(await check(ref, app("return Response.json({ campos: { nome: 'vazio' } }, { status: 400 })"))).toMatchObject({ passed: false, message: 'A resposta não cita: preco.' })
    expect(await check(ref, app("return new Response('erro', { status: 500 })"))).toMatchObject({ passed: false, message: 'POST /produtos respondeu 500, esperado 400.' })
  })

  it('paginacao-cursor: capped list with a cursor', async () => {
    const ref: CheckRef = { id: 'paginacao-cursor', path: '/produtos?limite=1000', max: 50 }
    const seed = "INSERT INTO produtos (nome) SELECT 'p' || g FROM generate_series(1, 120) g;"
    const list = (limit: string, shape: string) => app(`const limite = ${limit}
  const itens = await db.query('SELECT id, nome FROM produtos ORDER BY id LIMIT $1', [limite])
  return Response.json(${shape})`, PRODUTOS)
    const capped = 'Math.min(Number(searchParams.get("limite") ?? 20), 50)'
    expect(await check(ref, list(capped, '{ itens, proximoCursor: itens.at(-1)?.id }'), seed)).toMatchObject({ passed: true })
    expect(await check(ref, list('Number(searchParams.get("limite"))', '{ itens, proximoCursor: 1 }'), seed)).toMatchObject({ passed: false, message: 'Vieram 120 itens; o máximo é 50.' })
    expect(await check(ref, list(capped, '{ itens }'), seed)).toMatchObject({ passed: false, message: 'Faltou o cursor da próxima página (por exemplo proximoCursor).' })
    expect(await check(ref, list(capped, 'itens'), seed)).toMatchObject({ passed: false })
    expect(await check(ref, list(capped, '{ total: 1 }'), seed)).toMatchObject({ passed: false, message: 'Não achei a lista de itens na resposta.' })
  })

  it('sem-vazar-campos: no response carries a listed key, however deep', async () => {
    const ref: CheckRef = { id: 'sem-vazar-campos', requests: [{ path: '/usuarios' }, { path: '/usuarios/1' }], fields: ['senha_hash'] }
    expect(await check(ref, app("return Response.json(pathname === '/usuarios' ? { itens: [{ id: 1, nome: 'Ana' }] } : { id: 1 })"))).toMatchObject({ passed: true })
    const leaks = app("return Response.json(pathname === '/usuarios' ? { itens: [{ id: 1 }] } : { id: 1, SENHA_HASH: 'x' })")
    expect(await check(ref, leaks)).toMatchObject({ passed: false, message: 'GET /usuarios/1 devolve o campo SENHA_HASH.' })
  })

  it('idempotencia: same key twice, same answer, one row', async () => {
    const PAGAMENTOS = 'CREATE TABLE pagamentos (id serial PRIMARY KEY, chave text UNIQUE, valor int NOT NULL);'
    const ref: CheckRef = { id: 'idempotencia', request: { method: 'POST', path: '/pagamentos', headers: { 'Idempotency-Key': 'k1' }, body: { valor: 10 } }, sql: 'SELECT id FROM pagamentos' }
    const ok = app(`const chave = req.headers.get('Idempotency-Key')
  const [ja] = await db.query('SELECT id, valor FROM pagamentos WHERE chave = $1', [chave])
  if (ja) return Response.json(ja, { status: 201 })
  const [p] = await db.query('INSERT INTO pagamentos (chave, valor) VALUES ($1, $2) RETURNING id, valor', [chave, (await req.json()).valor])
  return Response.json(p, { status: 201 })`, PAGAMENTOS)
    expect(await check(ref, ok)).toMatchObject({ passed: true })
    const twice = app(`const [p] = await db.query('INSERT INTO pagamentos (valor) VALUES ($1) RETURNING id', [(await req.json()).valor])
  return Response.json({ ok: true }, { status: 201 })`, PAGAMENTOS)
    expect(await check(ref, twice)).toMatchObject({ passed: false, message: 'Depois das duas, o banco tem 2 linhas; esperado 1.' })
    const conflict = app(`try {
    const [p] = await db.query('INSERT INTO pagamentos (chave, valor) VALUES ($1, 1) RETURNING id', [req.headers.get('Idempotency-Key')])
    return Response.json(p, { status: 201 })
  } catch { return new Response(null, { status: 409 }) }`, PAGAMENTOS)
    expect(await check(ref, conflict)).toMatchObject({ passed: false, message: 'A segunda vez respondeu diferente da primeira.' })
    expect(await check(ref, app('return new Response(null, { status: 500 })', PAGAMENTOS))).toMatchObject({ passed: false, message: 'A primeira vez respondeu 500.' })
  })

  it('senha-hash: hashed in code and not stored as sent', async () => {
    const USERS = 'CREATE TABLE usuarios (id serial PRIMARY KEY, email text NOT NULL, senha text NOT NULL);'
    const ref: CheckRef = { id: 'senha-hash', request: { method: 'POST', path: '/usuarios', body: { email: 'a@b.c', senha: 'segredo123' } }, password: 'segredo123', sql: 'SELECT email, senha FROM usuarios' }
    const hashed = app(`const { email, senha } = await req.json()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-256' }, key, 256)
  const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
  await db.query('INSERT INTO usuarios (email, senha) VALUES ($1, $2)', [email, hex(salt) + ':' + hex(bits)])
  return new Response(null, { status: 201 })`, USERS)
    expect(await check(ref, hashed)).toMatchObject({ passed: true, kind: 'both' })
    const plain = app(`const { email, senha } = await req.json()
  await db.query('INSERT INTO usuarios (email, senha) VALUES ($1, $2)', [email, senha])
  return new Response(null, { status: 201 })`, USERS)
    expect(await check(ref, plain)).toMatchObject({ passed: false, message: 'Não achei hash de senha no código (crypto.subtle, PBKDF2, scrypt…).' })
    // A hash function exists, but the password is still stored as sent.
    expect(await check(ref, { ...plain, 'src/hash.ts': 'export const hash = (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))' })).toMatchObject({ passed: false, message: 'A senha está gravada como veio.' })
    expect(await check(ref, { ...app('return new Response(null, { status: 201 })', USERS), 'src/hash.ts': 'const x = "pbkdf2"' })).toMatchObject({ passed: false, message: 'O usuário não foi gravado.' })
    expect(await check(ref, { ...app('return new Response(null, { status: 400 })', USERS), 'src/hash.ts': 'const x = "pbkdf2"' })).toMatchObject({ passed: false, message: 'POST /usuarios respondeu 400.' })
  })

  it('auth-401-403: 401 without credentials, 403 without permission, after a login step that saves the token', async () => {
    const ref: CheckRef = {
      id: 'auth-401-403',
      before: [{ request: { method: 'POST', path: '/login', body: { usuario: 'ana' } }, expect: { status: 200 }, save: { token: 'body.token' } }],
      anonymous: { path: '/admin' },
      forbidden: { path: '/admin', headers: { Authorization: 'Bearer {{token}}' } },
    }
    const auth = (missing: number, denied: number) =>
      app(`if (pathname === '/login') return Response.json({ token: 'tk-' + (await req.json()).usuario })
  const auth = req.headers.get('Authorization')
  if (auth !== 'Bearer tk-ana') return new Response(null, { status: ${missing} })
  return new Response(null, { status: ${denied} })`)
    expect(await check(ref, auth(401, 403))).toMatchObject({ passed: true })
    expect(await check(ref, auth(403, 403))).toMatchObject({ passed: false, message: 'Sem credencial, GET /admin respondeu 403; esperado 401.' })
    expect(await check(ref, auth(401, 401))).toMatchObject({ passed: false, message: 'Sem permissão, GET /admin respondeu 401; esperado 403.' })
    // The login step fails: nothing to judge, the test's own message says why.
    expect(await check(ref, app('return new Response(null, { status: 404 })'))).toMatchObject({ passed: false, message: 'Requisição 1: Status diferente do esperado.' })
  })

  it('reports a crash and a missing result instead of judging', async () => {
    const ref: CheckRef = { id: 'problem-json', request: { path: '/x' } }
    expect(await check(ref, { 'src/index.ts': 'export default {}' })).toMatchObject({ passed: false, message: expect.stringContaining('export default') })
    expect(evaluateChecklist([ref], {}, [])[0]).toMatchObject({ passed: false, message: 'O teste não rodou.' })
    expect(await check(ref, app('return 42 as any'))).toMatchObject({ passed: false, message: 'GET /x não respondeu.' })
  })
})

describe('the catalogue', () => {
  it('describes every item in Portuguese with its kind, and only behaviour items make tests', () => {
    expect(CATALOGUE.map((c) => [c.id, c.kind])).toEqual([
      ['sql-parametrizado', 'static'],
      ['camadas', 'static'],
      ['sem-select-estrela', 'static'],
      ['transacao', 'static'],
      ['criado-201-location', 'behaviour'],
      ['problem-json', 'behaviour'],
      ['validacao-400', 'behaviour'],
      ['paginacao-cursor', 'behaviour'],
      ['sem-vazar-campos', 'behaviour'],
      ['idempotencia', 'behaviour'],
      ['senha-hash', 'both'],
      ['auth-401-403', 'behaviour'],
    ])
    for (const c of CATALOGUE) for (const text of [c.title, c.why, c.how, c.fix]) expect(text.length).toBeGreaterThan(5)
    expect(info('camadas').title).toBe('Rotas sem SQL')
    expect(checkTests([{ id: 'camadas' }, { id: 'problem-json', request: { path: '/x' } }])).toEqual([
      { name: 'checklist:problem-json', sequential: true, capture: true, requests: [{ request: { path: '/x' } }] },
    ])
  })
})
