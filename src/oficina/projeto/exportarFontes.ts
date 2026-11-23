// Source text of the files "Baixar projeto" adds to the player's: the Postgres adapter, migrations, server and test support.
// They are code for the exported Node project (not run by the game), kept as plain strings; exportar.test.ts runs the adapter and migrations.

export const BANCO = String.raw`// The same db contract the Oficina gives your code, { query(sql, params), transaction(fn) }, over Postgres.
// DATABASE_URL set: pg against that server (docker compose up -d). Not set: PGlite, Postgres in WASM, saved in ./.dados.
import type { PGlite, Transaction } from '@electric-sql/pglite'

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  transaction<R>(fn: (tx: Db) => Promise<R>): Promise<R>
  /** Several statements at once, no parameters: what migrations are. */
  exec(sql: string): Promise<void>
}

export interface Banco extends Db {
  close(): Promise<void>
}

/** What this file needs from pg's Pool and its clients. */
export interface PgClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>
  release?(): void
}
export interface PgPool extends PgClient {
  connect(): Promise<PgClient>
  end(): Promise<void>
}

let savepoints = 0

/** A transaction inside a transaction is a savepoint: a throw undoes only the inner part. */
function emTransacao(client: PgClient): Db {
  const db: Db = {
    query: async <T>(sql: string, params?: unknown[]) => (await client.query(sql, params)).rows as T[],
    exec: async (sql) => void (await client.query(sql)),
    async transaction(fn) {
      const name = 'sp_' + ++savepoints
      await client.query('SAVEPOINT ' + name)
      try {
        const result = await fn(db)
        await client.query('RELEASE SAVEPOINT ' + name)
        return result
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT ' + name)
        throw err
      }
    },
  }
  return db
}

export function pgBanco(pool: PgPool): Banco {
  return {
    query: async <T>(sql: string, params?: unknown[]) => (await pool.query(sql, params)).rows as T[],
    exec: async (sql) => void (await pool.query(sql)),
    async transaction(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await fn(emTransacao(client))
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw err
      } finally {
        client.release?.()
      }
    },
    close: () => pool.end(),
  }
}

function pgliteTx(tx: Transaction): Db {
  const db: Db = {
    query: async <T>(sql: string, params?: unknown[]) => (await tx.query<T>(sql, params)).rows,
    exec: async (sql) => void (await tx.exec(sql)),
    async transaction(fn) {
      const name = 'sp_' + ++savepoints
      await tx.query('SAVEPOINT ' + name)
      try {
        const result = await fn(db)
        await tx.query('RELEASE SAVEPOINT ' + name)
        return result
      } catch (err) {
        await tx.query('ROLLBACK TO SAVEPOINT ' + name)
        throw err
      }
    },
  }
  return db
}

export function pgliteBanco(pg: PGlite): Banco {
  return {
    query: async <T>(sql: string, params?: unknown[]) => (await pg.query<T>(sql, params)).rows,
    exec: async (sql) => void (await pg.exec(sql)),
    transaction: (fn) => pg.transaction((tx) => fn(pgliteTx(tx))),
    close: () => pg.close(),
  }
}

export async function abrirBanco(url = process.env.DATABASE_URL, pasta = process.env.PGLITE_DIR ?? './.dados'): Promise<Banco> {
  if (url) {
    const { default: pg } = await import('pg')
    // count(*) and sum() come back as bigint text from pg; PGlite gives numbers.
    pg.types.setTypeParser(20, Number)
    return pgBanco(new pg.Pool({ connectionString: url }) as unknown as PgPool)
  }
  const { PGlite } = await import('@electric-sql/pglite')
  return pgliteBanco(await PGlite.create(pasta))
}
`

export const MIGRAR = String.raw`// Applies the files in migrations/ that are not in _migrations yet, in numeric order, each in its own transaction.
import { readdirSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { abrirBanco, type Db } from './banco'

const NUMERADA = /^(\d+)_.*\.sql$/

export async function migrar(db: Db, pasta = 'migrations'): Promise<string[]> {
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
  const feitas = new Set((await db.query<{ name: string }>('SELECT name FROM _migrations')).map((r) => r.name))
  const arquivos = readdirSync(pasta)
    .filter((f) => NUMERADA.test(f))
    .sort((a, b) => Number(NUMERADA.exec(a)![1]) - Number(NUMERADA.exec(b)![1]) || a.localeCompare(b))
  const aplicadas: string[] = []
  for (const nome of arquivos) {
    if (feitas.has(nome)) continue
    try {
      await db.transaction(async (tx) => {
        await tx.exec(readFileSync(pasta + '/' + nome, 'utf8'))
        await tx.query('INSERT INTO _migrations (name) VALUES ($1)', [nome])
      })
    } catch (err) {
      throw new Error('A migração ' + nome + ' falhou: ' + (err as Error).message, { cause: err })
    }
    aplicadas.push(nome)
  }
  return aplicadas
}

// npm run migrar
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const banco = await abrirBanco()
  const aplicadas = await migrar(banco)
  console.log(aplicadas.length ? 'Migrações aplicadas: ' + aplicadas.join(', ') : 'Nada a migrar.')
  await banco.close()
}
`

export const SERVIDOR = String.raw`// npm start: migrates, then serves the app from src/index.ts. Hono and fetch puro are both { fetch(req, env) }.
import { serve } from '@hono/node-server'
import type { Env } from '../env'
import app from '../index'
import { abrirBanco } from './banco'
import { migrar } from './migrar'

const banco = await abrirBanco()
const aplicadas = await migrar(banco)
if (aplicadas.length) console.log('Migrações aplicadas: ' + aplicadas.join(', '))

const porta = Number(process.env.PORT ?? 3000)
const env: Env = { db: banco }
const servidor = serve({ fetch: (req: Request) => (app as { fetch(req: Request, env: Env): Response | Promise<Response> }).fetch(req, env), port: porta })
console.log('Ouvindo em http://localhost:' + porta)

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    servidor.close()
    void banco.close().finally(() => process.exit(0))
  })
}
`

export const SUPORTE = String.raw`// Runs the acceptance cases of the stages (from the Gargalo) against src/index.ts and an in-memory Postgres (PGlite).
import { PGlite } from '@electric-sql/pglite'
import { expect } from 'vitest'
import type { Env } from '../src/env'
import app from '../src/index'
import { pgliteBanco, type Banco } from '../src/infra/banco'
import { migrar } from '../src/infra/migrar'

export interface Pedido {
  method?: string
  path: string
  headers?: Record<string, string>
  body?: unknown
}
export interface Passo {
  request: Pedido
  expect?: { status: number; headers?: Record<string, string>; body?: unknown }
  /** Name to where its value is in the response: status, header.<name> or body.<path>. Later steps use it as {{name}}. */
  save?: Record<string, string>
}
export interface Caso {
  name: string
  requests: Passo[]
  /** One request after the other; otherwise they run together. */
  sequential?: boolean
  db?: { sql: string; params?: unknown[]; rows?: unknown[] }
}
interface Resposta {
  status: number
  headers: Record<string, string>
  body: unknown
}

export async function abrirBanco(): Promise<Banco> {
  return pgliteBanco(await PGlite.create())
}

/** Empty database, the migrations, then the stage's seed. */
export async function preparar(banco: Banco, seed?: string) {
  await banco.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
  await migrar(banco)
  if (seed) await banco.exec(seed)
}

/** Objects match when every expected key matches; arrays and values match exactly. */
export function casa(esperado: unknown, recebido: unknown): boolean {
  if (Array.isArray(esperado)) return Array.isArray(recebido) && recebido.length === esperado.length && esperado.every((e, i) => casa(e, recebido[i]))
  if (esperado !== null && typeof esperado === 'object') {
    if (recebido === null || typeof recebido !== 'object') return false
    return Object.entries(esperado).every(([k, v]) => casa(v, (recebido as Record<string, unknown>)[k]))
  }
  return Object.is(esperado, recebido)
}

function preencher<T>(valor: T, vars: Record<string, unknown>): T {
  if (typeof valor === 'string') {
    const inteiro = /^\{\{(\w+)\}\}$/.exec(valor)
    if (inteiro && inteiro[1] in vars) return vars[inteiro[1]] as T
    return valor.replace(/\{\{(\w+)\}\}/g, (m, nome: string) => (nome in vars ? String(vars[nome]) : m)) as T
  }
  if (Array.isArray(valor)) return valor.map((v) => preencher(v, vars)) as T
  if (valor !== null && typeof valor === 'object') return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, preencher(v, vars)])) as T
  return valor
}

function escolher(res: Resposta, de: string): unknown {
  if (de === 'status') return res.status
  if (de.startsWith('header.')) return res.headers[de.slice(7).toLowerCase()]
  return de
    .split('.')
    .slice(1)
    .reduce<unknown>((v, chave) => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[chave] : undefined), res.body)
}

async function chamar(banco: Banco, pedido: Pedido): Promise<Resposta> {
  const headers = new Headers(pedido.headers)
  if (pedido.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const req = new Request(new URL(pedido.path, 'http://localhost'), { method: pedido.method ?? 'GET', headers, body: pedido.body === undefined ? undefined : JSON.stringify(pedido.body) })
  const env: Env = { db: banco }
  const res = await (app as { fetch(req: Request, env: Env): Response | Promise<Response> }).fetch(req, env)
  const texto = await res.text()
  let body: unknown = texto
  try {
    body = JSON.parse(texto)
  } catch {
    // Not JSON: the text is the body.
  }
  return { status: res.status, headers: Object.fromEntries(res.headers), body }
}

export async function rodar(banco: Banco, caso: Caso) {
  const vars: Record<string, unknown> = {}
  const juntas = caso.sequential ? undefined : await Promise.all(caso.requests.map((p) => chamar(banco, p.request)))
  for (const [i, passo] of caso.requests.entries()) {
    const res = juntas ? juntas[i] : await chamar(banco, preencher(passo.request, vars))
    const esperado = passo.expect && preencher(passo.expect, vars)
    if (esperado) {
      const onde = 'Requisição ' + (i + 1) + ' (' + (passo.request.method ?? 'GET') + ' ' + passo.request.path + '): '
      expect(res.status, onde + 'status ' + JSON.stringify(res.body)).toBe(esperado.status)
      for (const [nome, valor] of Object.entries(esperado.headers ?? {})) expect(res.headers[nome.toLowerCase()] ?? null, onde + 'cabeçalho ' + nome).toBe(valor)
      if (esperado.body !== undefined) expect(casa(esperado.body, res.body), onde + 'corpo diferente do esperado. Esperado ' + JSON.stringify(esperado.body) + ', recebido ' + JSON.stringify(res.body)).toBe(true)
    }
    for (const [nome, de] of Object.entries(passo.save ?? {})) {
      const valor = escolher(res, de)
      expect(valor, 'a resposta não tem ' + de + ' (para {{' + nome + '}})').not.toBeUndefined()
      vars[nome] = valor
    }
  }
  if (caso.db) {
    const linhas = await banco.query(caso.db.sql, preencher(caso.db.params, vars))
    if (caso.db.rows !== undefined) expect(casa(caso.db.rows, linhas), 'estado do banco diferente do esperado: ' + JSON.stringify(linhas)).toBe(true)
  }
}
`

export const VITEST_CONFIG = `import { defineConfig } from 'vitest/config'

// PGlite takes a few seconds to start; each test file opens one.
export default defineConfig({ test: { include: ['tests/*.test.ts'], testTimeout: 30_000, hookTimeout: 60_000 } })
`

export const VITEST_HISTORICO = `import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['tests/historico/*.test.ts'], testTimeout: 30_000, hookTimeout: 60_000 } })
`

export const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["src", "tests", "vitest.config.ts", "vitest.historico.config.ts"]
}
`

export const COMPOSE = `# npm run banco  (docker compose up -d)
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: gargalo
      POSTGRES_PASSWORD: gargalo
      POSTGRES_DB: gargalo
    ports:
      - '5432:5432'
    volumes:
      - dados:/var/lib/postgresql/data
volumes:
  dados:
`

export const ENV_EXAMPLE = `# Sem DATABASE_URL o projeto usa PGlite em ./.dados, sem precisar de Docker.
DATABASE_URL=postgres://gargalo:gargalo@localhost:5432/gargalo
PORT=3000
`

export const GITIGNORE = `node_modules
.dados
.env
`
