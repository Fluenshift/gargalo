// Reference solutions of the "Busca e paginação" course: the whole project after each stage, in Hono and in plain fetch.
// Both share everything below the routes (db, http, validation); only src/index.ts and src/routes/ differ.

import type { Framework } from './project'
import { starter } from './project'

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
`

const INDICE_SQL = `CREATE INDEX produtos_nome_idx ON produtos (lower(nome));
`

const VALIDACAO = String.raw`import { z } from 'zod'
import { ErroHttp } from './http'

export const listaSchema = z.object({
  cursor: z.coerce.number().int().min(0).default(0),
  limite: z.coerce.number().int().min(1).default(20),
})

function validar<S extends z.ZodType>(dados: unknown, schema: S): z.output<S> {
  const resultado = schema.safeParse(dados)
  if (resultado.success) return resultado.data
  const erros = resultado.error.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message }))
  throw new ErroHttp(400, 'Dados inválidos', 'Corrija os campos indicados.', { erros })
}

export function lerConsulta<S extends z.ZodType>(req: Request, schema: S): z.output<S> {
  return validar(Object.fromEntries(new URL(req.url).searchParams), schema)
}
`

const dbProdutos = (stage: number) => {
  if (stage === 1) {
    return String.raw`import type { Env } from '../env'

type Db = Env['db']

export interface Produto {
  id: number
  nome: string
  preco_centavos: number
}

export async function listarProdutos(db: Db): Promise<Produto[]> {
  return db.query<Produto>('SELECT id, nome, preco_centavos FROM produtos ORDER BY id')
}
`
  }

  const buscaFuncao =
    stage >= 3
      ? String.raw`

export async function buscarProdutos(db: Db, busca: string): Promise<Produto[]> {
  const prefixo = busca.trim().toLowerCase().replace(/[\\%_]/g, '\\$&') + '%'
  return db.query<Produto>(
    'SELECT id, nome, preco_centavos FROM produtos WHERE lower(nome) LIKE $1 ORDER BY lower(nome) LIMIT 20',
    [prefixo],
  )
}`
      : ''

  return (
    String.raw`import type { Env } from '../env'

type Db = Env['db']

export interface Produto {
  id: number
  nome: string
  preco_centavos: number
}

export const LIMITE_MAX = 50

export interface FiltroLista {
  cursor: number
  limite: number
}

export interface PaginaProdutos {
  itens: Produto[]
  proximoCursor: number | null
}

/** A page after the cursor: at most LIMITE_MAX items, one extra row is read to know whether there is a next page. */
export async function listarProdutos(db: Db, filtro: FiltroLista): Promise<PaginaProdutos> {
  const limite = Math.min(filtro.limite, LIMITE_MAX)
  const linhas = await db.query<Produto>(
    'SELECT id, nome, preco_centavos FROM produtos WHERE id > $1 ORDER BY id LIMIT $2',
    [filtro.cursor, limite + 1],
  )
  const itens = linhas.slice(0, limite)
  const proximoCursor = linhas.length > limite ? itens[itens.length - 1].id : null
  return { itens, proximoCursor }
}` +
    buscaFuncao +
    '\n'
  )
}

const honoProdutos = (stage: number) => {
  if (stage === 1) {
    return String.raw`import { Hono } from 'hono'
import { listarProdutos } from '../db/produtos'
import type { Env } from '../env'

export const produtos = new Hono<{ Bindings: Env }>()

produtos.get('/', async (c) => c.json(await listarProdutos(c.env.db)))
`
  }

  if (stage === 2) {
    return String.raw`import { Hono } from 'hono'
import { listarProdutos } from '../db/produtos'
import type { Env } from '../env'
import { lerConsulta, listaSchema } from '../validacao'

export const produtos = new Hono<{ Bindings: Env }>()

produtos.get('/', async (c) => c.json(await listarProdutos(c.env.db, lerConsulta(c.req.raw, listaSchema))))
`
  }

  return String.raw`import { Hono } from 'hono'
import { buscarProdutos, listarProdutos } from '../db/produtos'
import type { Env } from '../env'
import { ErroHttp } from '../http'
import { lerConsulta, listaSchema } from '../validacao'

export const produtos = new Hono<{ Bindings: Env }>()

produtos.get('/', async (c) => {
  const url = new URL(c.req.raw.url)
  if (url.searchParams.has('busca')) {
    const busca = url.searchParams.get('busca') ?? ''
    if (!busca.trim()) throw new ErroHttp(400, 'Busca inválida', 'Informe o que buscar em ?busca=.')
    const encontrados = await buscarProdutos(c.env.db, busca)
    return c.json({ produtos: encontrados, itens: encontrados })
  }
  return c.json(await listarProdutos(c.env.db, lerConsulta(c.req.raw, listaSchema)))
})
`
}

const fetchProdutos = (stage: number) => {
  if (stage === 1) {
    return String.raw`import { listarProdutos } from '../db/produtos'
import type { Env } from '../env'
import { problema } from '../http'

export async function produtos(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'GET') return problema(405, 'Método não permitido')
  return Response.json(await listarProdutos(env.db))
}
`
  }

  if (stage === 2) {
    return String.raw`import { listarProdutos } from '../db/produtos'
import type { Env } from '../env'
import { problema } from '../http'
import { lerConsulta, listaSchema } from '../validacao'

export async function produtos(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'GET') return problema(405, 'Método não permitido')
  return Response.json(await listarProdutos(env.db, lerConsulta(req, listaSchema)))
}
`
  }

  return String.raw`import { buscarProdutos, listarProdutos } from '../db/produtos'
import type { Env } from '../env'
import { ErroHttp, problema } from '../http'
import { lerConsulta, listaSchema } from '../validacao'

export async function produtos(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'GET') return problema(405, 'Método não permitido')
  const url = new URL(req.url)
  if (url.searchParams.has('busca')) {
    const busca = url.searchParams.get('busca') ?? ''
    if (!busca.trim()) throw new ErroHttp(400, 'Busca inválida', 'Informe o que buscar em ?busca=.')
    const encontrados = await buscarProdutos(env.db, busca)
    return Response.json({ produtos: encontrados, itens: encontrados })
  }
  return Response.json(await listarProdutos(env.db, lerConsulta(req, listaSchema)))
}
`
}

const HONO_INDEX = String.raw`import { Hono } from 'hono'
import type { Env } from './env'
import { deErro, problema } from './http'
import { health } from './routes/health'
import { produtos } from './routes/produtos'

const app = new Hono<{ Bindings: Env }>()

app.route('/health', health)
app.route('/produtos', produtos)

app.notFound(() => problema(404, 'Rota não encontrada'))
app.onError(deErro)

export default app
`

const FETCH_INDEX = String.raw`import type { Env } from './env'
import { deErro, problema } from './http'
import { health } from './routes/health'
import { produtos } from './routes/produtos'

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url)
    if (pathname === '/health') return health(env)
    if (pathname === '/produtos') {
      try {
        return await produtos(req, env)
      } catch (err) {
        return deErro(err)
      }
    }
    return problema(404, 'Rota não encontrada')
  },
}
`

const FETCH_HEALTH = String.raw`import { bancoResponde } from '../db/saude'
import type { Env } from '../env'

export async function health(env: Env): Promise<Response> {
  await bancoResponde(env.db)
  return Response.json({ status: 'ok' })
}
`

/** The whole project after `stage` (1 to 3). */
export function referencia(framework: Framework, stage: number): Record<string, string> {
  const hono = framework === 'hono'
  const base = starter('referencia', framework).files
  const files: Record<string, string> = {
    'src/index.ts': hono ? HONO_INDEX : FETCH_INDEX,
    'src/routes/health.ts': hono ? base['src/routes/health.ts'] : FETCH_HEALTH,
    'src/routes/produtos.ts': hono ? honoProdutos(stage) : fetchProdutos(stage),
    'src/db/saude.ts': base['src/db/saude.ts'],
    'src/db/produtos.ts': dbProdutos(stage),
    'src/env.ts': base['src/env.ts'],
    'src/http.ts': HTTP,
    'migrations/001_init.sql': base['migrations/001_init.sql'],
  }
  if (stage >= 2) {
    files['src/validacao.ts'] = VALIDACAO
  }
  if (stage >= 3) {
    files['migrations/002_indice_busca.sql'] = INDICE_SQL
  }
  return files
}
