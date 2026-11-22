import { describe, expect, it } from 'vitest'
import type { Db, TestCase, TestResult } from './exercise'
import { compile, executeTests, matches } from './execute'

/** In-memory stand-in for ctx.db until Postgres arrives (#83): one account balance, a few known statements. */
function accountDb(balance: number): Db {
  const db: Db = {
    async query(sql, params = []) {
      if (sql.startsWith('SELECT saldo')) return [{ saldo: balance }] as never
      if (sql.startsWith('UPDATE contas SET saldo = $1')) balance = params[0] as number
      if (sql.startsWith('UPDATE contas SET saldo = saldo - $1')) {
        if (balance < (params[0] as number)) return []
        balance -= params[0] as number
        return [{ saldo: balance }] as never
      }
      return []
    },
    transaction: (fn) => fn(db),
  }
  return db
}

async function run(code: string, tests: TestCase[]): Promise<TestResult[]> {
  const results: TestResult[] = []
  await executeTests({ code, schema: '', seed: '', tests }, async () => accountDb(100), ({ result }) => results.push(result))
  return results
}

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
    expect(await run(code, [created])).toEqual([{ name: 'cria usuário', passed: true }])
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
    expect(await run(naive, [oneSucceeds])).toEqual([
      { name: 'dois saques ao mesmo tempo', passed: false, message: 'Requisição 2: Status diferente do esperado.', expected: 409, received: 200 },
    ])

    const conditional = `export default async function handler(req: Request, ctx: Ctx) {
  const { valor } = await req.json()
  const rows = await ctx.db.transaction((tx) => tx.query('UPDATE contas SET saldo = saldo - $1 WHERE saldo >= $1 RETURNING saldo', [valor]))
  return rows.length ? new Response('ok') : new Response('sem saldo', { status: 409 })
}`
    expect(await run(conditional, [oneSucceeds])).toEqual([{ name: 'dois saques ao mesmo tempo', passed: true }])
  })

  it('checks the database state after the requests and gives the test clock to ctx.now', async () => {
    const test: TestCase = { name: 'relógio', now: 1234, requests: [{ request: { path: '/' }, expect: { status: 200, body: { agora: 1234 } } }], db: { sql: 'SELECT saldo', rows: [{ saldo: 100 }] } }
    const code = `export default async (req: Request, ctx: Ctx) => Response.json({ agora: ctx.now() })`
    expect(await run(code, [test])).toEqual([{ name: 'relógio', passed: true }])
    const [wrong] = await run(code, [{ ...test, db: { sql: 'SELECT saldo', rows: [{ saldo: 0 }] } }])
    expect(wrong).toMatchObject({ passed: false, message: 'Estado do banco diferente do esperado.', expected: [{ saldo: 0 }], received: [{ saldo: 100 }] })
  })
})

describe('compile', () => {
  it('returns the default export', () => {
    expect(typeof compile('export default async function handler() { return new Response() }')).toBe('function')
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
