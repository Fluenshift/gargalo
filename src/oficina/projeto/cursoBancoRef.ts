// Reference solutions of the "Banco" project course: the whole project after each stage, in Hono and in plain fetch.
// Both share everything below the routes (db, http, validation); only src/index.ts and src/routes/ differ.

import type { Framework } from './project'

const lines = (...parts: (string | false)[]) => parts.filter((p) => p !== false).join('\n') + '\n'

const ENV = `export interface Env {
  db: {
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
    transaction<R>(fn: (tx: Env['db']) => Promise<R>): Promise<R>
  }
}
`

const HTTP = String.raw`/** An error with the status it should answer; deErro turns it into problem+json. */
export class ErroHttp extends Error {
  status: number
  title: string
  extra: Record<string, unknown>

  constructor(status: number, title: string, detail?: string, extra: Record<string, unknown> = {}) {
    super(detail ?? title)
    this.status = status
    this.title = title
    this.extra = extra
  }
}

/** RFC 9457: every error the API answers has this shape. */
export function problema(status: number, title: string, detail?: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ type: 'about:blank', title, status, detail, ...extra }, { status, headers: { 'Content-Type': 'application/problem+json' } })
}

export function deErro(err: unknown): Response {
  if (err instanceof ErroHttp) return problema(err.status, err.title, err.message, err.extra)
  console.error(err)
  return problema(500, 'Erro interno', 'Algo deu errado do nosso lado.')
}

export function idDe(texto: string): number {
  const id = Number(texto)
  if (!Number.isInteger(id)) throw new ErroHttp(404, 'Recurso não encontrado')
  return id
}

export function achado<T>(valor: T | undefined, nome: string): T {
  if (valor === undefined) throw new ErroHttp(404, nome + ' não encontrada')
  return valor
}
`

const VALIDACAO = String.raw`import { z } from 'zod'
import { ErroHttp } from './http'

export const contaSchema = z.object({
  titular: z.string().trim().min(1),
  saldo_centavos: z.number().int().min(0),
})

export const transferenciaSchema = z
  .object({
    de: z.number().int().min(1),
    para: z.number().int().min(1),
    valor_centavos: z.number().int().min(1),
  })
  .refine((d) => d.de !== d.para, {
    message: 'As contas de origem e destino devem ser diferentes.',
    path: ['para'],
  })

export const pagamentoSchema = z.object({
  valor_centavos: z.number().int().min(1),
})

function validar<S extends z.ZodType>(dados: unknown, schema: S): z.output<S> {
  const resultado = schema.safeParse(dados)
  if (resultado.success) return resultado.data
  const erros = resultado.error.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message }))
  throw new ErroHttp(400, 'Dados inválidos', 'Corrija os campos indicados.', { erros })
}

export async function lerCorpo<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  return validar(await req.json().catch(() => undefined), schema)
}
`

const CONTAS_SQL = String.raw`CREATE TABLE contas (
  id serial PRIMARY KEY,
  titular text NOT NULL,
  saldo_centavos int NOT NULL CHECK (saldo_centavos >= 0)
);
`

const TRANSFERENCIAS_SQL = String.raw`CREATE TABLE transferencias (
  id serial PRIMARY KEY,
  de int NOT NULL REFERENCES contas (id),
  para int NOT NULL REFERENCES contas (id),
  valor_centavos int NOT NULL CHECK (valor_centavos > 0),
  criado_em timestamptz NOT NULL DEFAULT now()
);
`

const PAGAMENTOS_SQL = String.raw`CREATE TABLE pagamentos (
  id serial PRIMARY KEY,
  chave text NOT NULL UNIQUE,
  valor_centavos int NOT NULL CHECK (valor_centavos > 0),
  criado_em timestamptz NOT NULL DEFAULT now()
);
`

const DB_CONTAS = String.raw`import type { Env } from '../env'

type Db = Env['db']

export interface Conta {
  id: number
  titular: string
  saldo_centavos: number
}

export type NovaConta = Omit<Conta, 'id'>

export async function criarConta(db: Db, c: NovaConta): Promise<Conta> {
  const [criada] = await db.query<Conta>(
    'INSERT INTO contas (titular, saldo_centavos) VALUES ($1, $2) RETURNING id, titular, saldo_centavos',
    [c.titular, c.saldo_centavos],
  )
  return criada
}

export async function buscarConta(db: Db, id: number): Promise<Conta | undefined> {
  const [conta] = await db.query<Conta>('SELECT id, titular, saldo_centavos FROM contas WHERE id = $1', [id])
  return conta
}

export async function listarContas(db: Db): Promise<Conta[]> {
  return db.query<Conta>('SELECT id, titular, saldo_centavos FROM contas ORDER BY id')
}
`

const DB_TRANSFERENCIAS = String.raw`import type { Env } from '../env'
import { ErroHttp } from '../http'

type Db = Env['db']

export interface TransferenciaResultado {
  de: number
  para: number
  valor_centavos: number
  saldo_centavos: number
}

export async function transferir(db: Db, de: number, para: number, valor: number): Promise<TransferenciaResultado> {
  return db.transaction(async (tx) => {
    const [origem] = await tx.query<{ saldo_centavos: number }>(
      'UPDATE contas SET saldo_centavos = saldo_centavos - $1 WHERE id = $2 AND saldo_centavos >= $1 RETURNING saldo_centavos',
      [valor, de],
    )
    if (!origem) {
      const existe = await tx.query('SELECT 1 FROM contas WHERE id = $1', [de])
      if (!existe.length) throw new ErroHttp(404, 'Conta não encontrada', 'Conta de origem não encontrada.')
      throw new ErroHttp(409, 'Saldo insuficiente', 'Saldo insuficiente para realizar a transferência.')
    }
    const [destino] = await tx.query<{ id: number }>(
      'UPDATE contas SET saldo_centavos = saldo_centavos + $1 WHERE id = $2 RETURNING id',
      [valor, para],
    )
    if (!destino) {
      throw new ErroHttp(404, 'Conta não encontrada', 'Conta de destino não encontrada.')
    }
    await tx.query(
      'INSERT INTO transferencias (de, para, valor_centavos) VALUES ($1, $2, $3)',
      [de, para, valor],
    )
    return { de, para, valor_centavos: valor, saldo_centavos: origem.saldo_centavos }
  })
}
`

const DB_PAGAMENTOS = String.raw`import type { Env } from '../env'

type Db = Env['db']

export interface Pagamento {
  id: number
  chave: string
  valor_centavos: number
}

export async function processarPagamento(db: Db, chave: string, valorCentavos: number): Promise<{ id: number; valor_centavos: number }> {
  const [novo] = await db.query<{ id: number; valor_centavos: number }>(
    'INSERT INTO pagamentos (chave, valor_centavos) VALUES ($1, $2) ON CONFLICT (chave) DO NOTHING RETURNING id, valor_centavos',
    [chave, valorCentavos],
  )
  if (novo) return novo
  const [existente] = await db.query<{ id: number; valor_centavos: number }>(
    'SELECT id, valor_centavos FROM pagamentos WHERE chave = $1',
    [chave],
  )
  return existente
}
`

const HONO_CONTAS = String.raw`import { Hono } from 'hono'
import { buscarConta, criarConta, listarContas } from '../db/contas'
import type { Env } from '../env'
import { achado, idDe } from '../http'
import { contaSchema, lerCorpo } from '../validacao'

export const contas = new Hono<{ Bindings: Env }>()

contas.get('/', async (c) => c.json(await listarContas(c.env.db)))

contas.post('/', async (c) => {
  const corpo = await lerCorpo(c.req.raw, contaSchema)
  const criada = await criarConta(c.env.db, corpo)
  c.header('Location', '/contas/' + criada.id)
  return c.json(criada, 201)
})

contas.get('/:id', async (c) => c.json(achado(await buscarConta(c.env.db, idDe(c.req.param('id'))), 'Conta')))
`

const HONO_TRANSFERENCIAS = String.raw`import { Hono } from 'hono'
import { transferir } from '../db/transferencias'
import type { Env } from '../env'
import { lerCorpo, transferenciaSchema } from '../validacao'

export const transferencias = new Hono<{ Bindings: Env }>()

transferencias.post('/', async (c) => {
  const { de, para, valor_centavos } = await lerCorpo(c.req.raw, transferenciaSchema)
  const resultado = await transferir(c.env.db, de, para, valor_centavos)
  return c.json(resultado, 200)
})
`

const HONO_PAGAMENTOS = String.raw`import { Hono } from 'hono'
import { processarPagamento } from '../db/pagamentos'
import type { Env } from '../env'
import { ErroHttp } from '../http'
import { lerCorpo, pagamentoSchema } from '../validacao'

export const pagamentos = new Hono<{ Bindings: Env }>()

pagamentos.post('/', async (c) => {
  const chave = c.req.header('idempotency-key')
  if (!chave) throw new ErroHttp(400, 'Falta o cabeçalho Idempotency-Key')
  const { valor_centavos } = await lerCorpo(c.req.raw, pagamentoSchema)
  const pagamento = await processarPagamento(c.env.db, chave, valor_centavos)
  return c.json(pagamento, 201)
})
`

const FETCH_CONTAS = String.raw`import { buscarConta, criarConta, listarContas } from '../db/contas'
import type { Env } from '../env'
import { achado, idDe, problema } from '../http'
import { contaSchema, lerCorpo } from '../validacao'

export async function contas(req: Request, env: Env, id?: string): Promise<Response> {
  const { db } = env
  if (!id && req.method === 'GET') return Response.json(await listarContas(db))
  if (!id && req.method === 'POST') {
    const corpo = await lerCorpo(req, contaSchema)
    const criada = await criarConta(db, corpo)
    return Response.json(criada, { status: 201, headers: { Location: '/contas/' + criada.id } })
  }
  if (id && req.method === 'GET') return Response.json(achado(await buscarConta(db, idDe(id)), 'Conta'))
  return problema(405, 'Método não permitido')
}
`

const FETCH_TRANSFERENCIAS = String.raw`import { transferir } from '../db/transferencias'
import type { Env } from '../env'
import { problema } from '../http'
import { lerCorpo, transferenciaSchema } from '../validacao'

export async function transferencias(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return problema(405, 'Método não permitido')
  const { de, para, valor_centavos } = await lerCorpo(req, transferenciaSchema)
  const resultado = await transferir(env.db, de, para, valor_centavos)
  return Response.json(resultado, { status: 200 })
}
`

const FETCH_PAGAMENTOS = String.raw`import { processarPagamento } from '../db/pagamentos'
import type { Env } from '../env'
import { ErroHttp, problema } from '../http'
import { lerCorpo, pagamentoSchema } from '../validacao'

export async function pagamentos(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return problema(405, 'Método não permitido')
  const chave = req.headers.get('idempotency-key')
  if (!chave) throw new ErroHttp(400, 'Falta o cabeçalho Idempotency-Key')
  const { valor_centavos } = await lerCorpo(req, pagamentoSchema)
  const pagamento = await processarPagamento(env.db, chave, valor_centavos)
  return Response.json(pagamento, { status: 201 })
}
`

const modulos = (stage: number): [string, string][] => [
  ['contas', 'contas'],
  ...(stage >= 2 ? [['transferencias', 'transferencias'] as [string, string]] : []),
  ...(stage >= 3 ? [['pagamentos', 'pagamentos'] as [string, string]] : []),
]

const honoIndex = (stage: number) => {
  const mods = modulos(stage)
  return (
    lines(
      "import { Hono } from 'hono'",
      "import type { Env } from './env'",
      "import { deErro, problema } from './http'",
      ...mods.map(([file, name]) => "import { " + name + " } from './routes/" + file + "'"),
    ) +
    String.raw`
const app = new Hono<{ Bindings: Env }>()

${mods.map(([, name]) => "app.route('/" + name + "', " + name + ')').join('\n')}

app.notFound(() => problema(404, 'Rota não encontrada'))
app.onError(deErro)

export default app
`
  )
}

const fetchIndex = (stage: number) => {
  const mods = modulos(stage)
  return (
    lines(
      "import type { Env } from './env'",
      "import { deErro, problema } from './http'",
      ...mods.map(([file, name]) => "import { " + name + " } from './routes/" + file + "'"),
    ) +
    String.raw`
type Rota = (req: Request, env: Env, id?: string) => Promise<Response>

const rotas: Record<string, Rota> = { ${mods.map(([, name]) => name).join(', ')} }

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const [, recurso, id] = new URL(req.url).pathname.split('/')
    if (!Object.hasOwn(rotas, recurso)) return problema(404, 'Rota não encontrada')
    try {
      return await rotas[recurso](req, env, id)
    } catch (err) {
      return deErro(err)
    }
  },
}
`
  )
}

/** The whole project after stage (1 to 3). */
export function referencia(framework: Framework, stage: number): Record<string, string> {
  const hono = framework === 'hono'
  const files: Record<string, string> = {
    'src/index.ts': hono ? honoIndex(stage) : fetchIndex(stage),
    'src/env.ts': ENV,
    'src/http.ts': HTTP,
    'src/validacao.ts': VALIDACAO,
    'src/db/contas.ts': DB_CONTAS,
    'src/routes/contas.ts': hono ? HONO_CONTAS : FETCH_CONTAS,
    'migrations/001_contas.sql': CONTAS_SQL,
  }
  if (stage >= 2) {
    files['src/db/transferencias.ts'] = DB_TRANSFERENCIAS
    files['src/routes/transferencias.ts'] = hono ? HONO_TRANSFERENCIAS : FETCH_TRANSFERENCIAS
    files['migrations/002_transferencias.sql'] = TRANSFERENCIAS_SQL
  }
  if (stage >= 3) {
    files['src/db/pagamentos.ts'] = DB_PAGAMENTOS
    files['src/routes/pagamentos.ts'] = hono ? HONO_PAGAMENTOS : FETCH_PAGAMENTOS
    files['migrations/003_pagamentos.sql'] = PAGAMENTOS_SQL
  }
  return files
}
