import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { TIMEOUT_MESSAGE } from '../runner'
import { explain, explainMessage, explainNotFound } from './explain'
import { loadApp } from './modules'
import { describeError, migrate, type RequestOutcome } from './runtime'

let pg: PGlite
beforeAll(async () => {
  pg = await PGlite.create()
  await pg.exec(`CREATE TABLE produtos (id serial PRIMARY KEY, nome text NOT NULL UNIQUE);
CREATE TABLE itens (produto_id int NOT NULL REFERENCES produtos);
INSERT INTO produtos (nome) VALUES ('a');`)
}, 60_000)

/** The message the runtime would report for this failing SQL. */
const pgError = (sql: string) => pg.query(sql).then(() => '', (err) => describeError(err).message)

/** The message the runtime would report for these project files. */
const loadError = (files: Record<string, string>) => {
  try {
    loadApp(files)
    return ''
  } catch (err) {
    return describeError(err).message
  }
}

const outcome = (rest: Partial<RequestOutcome>): RequestOutcome => ({ logs: [], ms: 1, metrics: { queries: 0, rowsRead: 0, handlerMs: 0 }, ...rest })

describe('explainMessage', () => {
  it('explains Postgres errors by what they say', async () => {
    expect(explainMessage(await pgError('SELECT preco FROM produtos'))).toMatchObject({ title: 'Coluna não existe', detail: expect.stringContaining('preco') })
    expect(explainMessage(await pgError('INSERT INTO produtos (nome, preco) VALUES (1, 2)')).detail).toContain('preco na tabela produtos')
    expect(explainMessage(await pgError('SELECT 1 FROM pedidos'))).toMatchObject({ title: 'Tabela não existe', detail: expect.stringContaining('pedidos') })
    expect(explainMessage(await pgError("INSERT INTO produtos (nome) VALUES ('a')"))).toMatchObject({ title: 'Valor repetido', next: expect.stringContaining('409') })
    expect(explainMessage(await pgError('INSERT INTO produtos (nome) VALUES (NULL)'))).toMatchObject({ title: 'Campo obrigatório vazio', detail: expect.stringContaining('nome de produtos') })
    expect(explainMessage(await pgError('INSERT INTO itens VALUES (999)'))).toMatchObject({ title: 'Referência inválida' })
  })

  it('explains what the runtime reports about the project', async () => {
    expect(explainMessage(loadError({ 'src/index.ts': "import x from 'express'" }))).toMatchObject({ title: 'Import bloqueado', detail: expect.stringContaining('"express"') })
    expect(explainMessage(loadError({ 'src/index.ts': "import { x } from './nada'" }))).toMatchObject({ title: 'Arquivo importado não existe', detail: expect.stringContaining('src/index.ts importa "./nada"') })
    expect(explainMessage(loadError({ 'src/index.ts': 'export const a = 1' }))).toMatchObject({ title: 'Falta o export default' })
    expect(explainMessage(loadError({}))).toMatchObject({ title: 'Falta o export default' })
    expect(explainMessage(loadError({ 'src/index.ts': 'const = ' }))).toMatchObject({ title: 'Erro de sintaxe' })
    expect(explainMessage('fetch(req, env) precisa devolver um Response.')).toMatchObject({ title: 'Faltou devolver a resposta' })
    expect(explainMessage(TIMEOUT_MESSAGE)).toMatchObject({ title: 'Tempo esgotado' })
    const migration = await migrate(pg, { 'migrations/001_x.sql': 'CREATE TABLE produtos ();' }).then(() => '', (err) => describeError(err).message)
    expect(explainMessage(migration)).toMatchObject({ title: 'A migração falhou', detail: expect.stringContaining('migrations/001_x.sql: ') })
  })

  it('explains an invalid JSON body, and anything else as a plain error with where it happened', async () => {
    const json = await Promise.resolve()
      .then(() => JSON.parse('{nome:'))
      .catch((err) => String(err))
    expect(explainMessage(json)).toMatchObject({ title: 'JSON inválido no corpo' })
    expect(explainMessage('Malformed JSON in request body').title).toBe('JSON inválido no corpo')
    expect(explainMessage('TypeError: x is undefined', { file: 'src/a.ts', line: 3 })).toEqual({
      title: 'Erro no código',
      detail: 'TypeError: x is undefined (src/a.ts:3)',
      next: expect.stringContaining('console.log'),
    })
    expect(explainMessage('Erro', { file: 'src/a.ts' }).detail).toBe('Erro (src/a.ts)')
  })
})

describe('explainNotFound', () => {
  const routes = [
    { method: 'ALL', path: '/*' },
    { method: 'GET', path: '/produtos' },
    { method: 'GET', path: '/produtos/:id{[0-9]+}' },
    { method: 'DELETE', path: '/produtos/:id' },
  ]
  it('compares the request with the routes the app registered', () => {
    expect(explainNotFound(404, '', { request: { path: '/pedidos' }, routes })).toMatchObject({ title: 'Rota não registrada', detail: expect.stringContaining('GET /produtos, GET /produtos/:id{[0-9]+}, DELETE') })
    expect(explainNotFound(404, '', { request: { method: 'post', path: '/produtos?x=1' }, routes })).toMatchObject({ title: 'Método errado', detail: '/produtos existe para GET, mas não para POST.', next: expect.stringContaining("app.post('/produtos'") })
    expect(explainNotFound(404, '', { request: { method: 'PUT', path: '/produtos/3' }, routes })?.detail).toBe('/produtos/3 existe para GET, DELETE, mas não para PUT.')
    // The route exists: the 404 is the app's own answer (the product isn't there).
    expect(explainNotFound(404, '', { request: { path: '/produtos/3' }, routes })).toBeUndefined()
    expect(explainNotFound(404, '', { request: { path: '/x' }, routes: [] })?.detail).toContain('Rotas do app: nenhuma.')
  })
  it('falls back on the status and Hono’s default body when the routes are unknown', () => {
    expect(explainNotFound(405, '', { request: { method: 'PUT', path: '/a' } })).toMatchObject({ title: 'Método errado', detail: expect.stringContaining('PUT /a') })
    expect(explainNotFound(404, '404 Not Found')).toMatchObject({ title: 'Rota não registrada', detail: 'Nenhuma rota atende essa requisição.' })
    expect(explainNotFound(404, { erro: 'x' }, { request: { path: '/a' } })).toMatchObject({ title: 'Não encontrado (404)', detail: expect.stringContaining('GET /a') })
  })
})

describe('explain', () => {
  it('takes a code error, a request outcome or a failed test', () => {
    expect(explain({ message: TIMEOUT_MESSAGE })?.title).toBe('Tempo esgotado')
    expect(explain(outcome({ error: { message: 'boom', file: 'src/a.ts', line: 2 } }))?.detail).toBe('boom (src/a.ts:2)')
    expect(explain(outcome({ response: { status: 200, headers: {}, body: '' } }))).toBeUndefined()
    expect(explain(outcome({}))).toBeUndefined()
    const notFound = outcome({ response: { status: 404, headers: {}, body: '404 Not Found' }, routes: [{ method: 'GET', path: '/health' }] })
    expect(explain(notFound, { request: { path: '/nada' } })?.detail).toBe('Nenhuma rota atende GET /nada. Rotas do app: GET /health.')
  })

  it('explains a 500 by the error Hono logged', () => {
    const logged = outcome({ response: { status: 500, headers: {}, body: 'Internal Server Error' }, logs: [{ level: 'log', text: 'oi' }, { level: 'error', text: 'error: relation "pedidos" does not exist' }] })
    expect(explain(logged)).toMatchObject({ title: 'Erro interno (500): tabela não existe', detail: expect.stringContaining('pedidos') })
    expect(explain(outcome({ response: { status: 500, headers: {}, body: '' } }))?.title).toBe('Erro interno (500)')
  })

  it('explains a failed test by its status, its difference or its error', () => {
    expect(explain({ name: 't', passed: true })).toBeUndefined()
    expect(explain({ name: 't', passed: false, message: 'Requisição 2: Status diferente do esperado.', expected: 200, received: 404 })?.title).toBe('Não encontrado (404)')
    expect(explain({ name: 't', passed: false, message: 'Status diferente do esperado.', expected: 201, received: 500 })?.title).toBe('Erro interno (500)')
    expect(explain({ name: 't', passed: false, message: 'Status diferente do esperado.', expected: 201, received: 200 })).toMatchObject({ title: 'Status diferente do esperado.', detail: 'Esperado: 201. Recebido: 200.' })
    expect(explain({ name: 't', passed: false, message: 'Corpo da resposta diferente do esperado.', expected: { a: 1 }, received: 'oi' })?.detail).toBe('Esperado: {"a":1}. Recebido: oi.')
    expect(explain({ name: 't', passed: false, message: 'error: column "x" does not exist', file: 'src/db.ts', line: 4 })?.title).toBe('Coluna não existe')
    expect(explain({ name: 't', passed: false })?.title).toBe('Erro no código')
  })
})
