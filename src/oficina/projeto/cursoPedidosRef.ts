// Reference solutions of the "API de pedidos" course: the whole project after each stage, in Hono and in plain fetch.
// Both share everything below the routes (db, http, validation, auth); only src/index.ts and src/routes/ differ.
// The generated code avoids backticks and `${` so it can live in plain strings.

import type { Framework } from './project'
import { starter } from './project'

/** What each stage adds to the project. */
interface Flags {
  stage: number
  /** From stage 4: zod validates what comes in. */
  validar: boolean
  /** From stage 5: the product list is paginated and filtered. */
  lista: boolean
  /** From stage 6: writes need a token. */
  auth: boolean
}

const lines = (...parts: (string | false)[]) => parts.filter((p) => p !== false).join('\n') + '\n'

// --- Stage 0 (primeiros-passos): the starter plus GET /ola ---

const OLA_HONO_ROUTE = String.raw`import { Hono } from 'hono'
import type { Env } from '../env'

export const ola = new Hono<{ Bindings: Env }>()

ola.get('/', (c) => c.json({ mensagem: 'olá' }))
`

const OLA_FETCH_ROUTE = String.raw`export function ola(): Response {
  return Response.json({ mensagem: 'olá' })
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

/** The id of a path like /produtos/7; anything that is not a whole number is a resource that does not exist. */
export function idDe(texto: string): number {
  const id = Number(texto)
  if (!Number.isInteger(id)) throw new ErroHttp(404, 'Recurso não encontrado')
  return id
}

export function achado<T>(valor: T | undefined, nome: string): T {
  if (valor === undefined) throw new ErroHttp(404, nome + ' não encontrado')
  return valor
}
`

const PEDIDOS_SQL = String.raw`CREATE TABLE pedidos (
  id serial PRIMARY KEY,
  total_centavos int NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE itens_pedido (
  id serial PRIMARY KEY,
  pedido_id int NOT NULL REFERENCES pedidos (id),
  produto_id int NOT NULL REFERENCES produtos (id),
  quantidade int NOT NULL CHECK (quantidade > 0),
  preco_centavos int NOT NULL
);
`

const USUARIOS_SQL = String.raw`CREATE TABLE usuarios (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  senha_hash text NOT NULL,
  papel text NOT NULL DEFAULT 'cliente' CHECK (papel IN ('cliente', 'admin'))
);
`

const dbProdutos = (f: Flags) =>
  String.raw`import type { Env } from '../env'

type Db = Env['db']

export interface Produto {
  id: number
  nome: string
  preco_centavos: number
}

export type NovoProduto = Omit<Produto, 'id'>
${f.lista ? '\nexport const LIMITE_MAX = 50\n' : ''}
export async function criarProduto(db: Db, p: NovoProduto): Promise<Produto> {
  const [criado] = await db.query<Produto>('INSERT INTO produtos (nome, preco_centavos) VALUES ($1, $2) RETURNING id, nome, preco_centavos', [p.nome, p.preco_centavos])
  return criado
}

export async function buscarProduto(db: Db, id: number): Promise<Produto | undefined> {
  const [produto] = await db.query<Produto>('SELECT id, nome, preco_centavos FROM produtos WHERE id = $1', [id])
  return produto
}

${
  f.lista
    ? String.raw`export interface Filtro {
  cursor: number
  limite: number
  q?: string
  preco_min?: number
  preco_max?: number
}

/** A page after the cursor: at most LIMITE_MAX items, one extra row is read to know whether there is a next page. */
export async function listarProdutos(db: Db, filtro: Filtro): Promise<{ itens: Produto[]; proximoCursor: number | null }> {
  const limite = Math.min(filtro.limite, LIMITE_MAX)
  const linhas = await db.query<Produto>(
    'SELECT id, nome, preco_centavos FROM produtos WHERE id > $1 AND ($2::text IS NULL OR nome ILIKE $2) AND ($3::int IS NULL OR preco_centavos >= $3) AND ($4::int IS NULL OR preco_centavos <= $4) ORDER BY id LIMIT $5',
    [filtro.cursor, filtro.q ? '%' + filtro.q + '%' : null, filtro.preco_min ?? null, filtro.preco_max ?? null, limite + 1],
  )
  const itens = linhas.slice(0, limite)
  return { itens, proximoCursor: linhas.length > limite ? itens[limite - 1].id : null }
}`
    : String.raw`export function listarProdutos(db: Db): Promise<Produto[]> {
  return db.query<Produto>('SELECT id, nome, preco_centavos FROM produtos ORDER BY id')
}`
}

export async function atualizarProduto(db: Db, id: number, p: NovoProduto): Promise<Produto | undefined> {
  const [produto] = await db.query<Produto>('UPDATE produtos SET nome = $1, preco_centavos = $2 WHERE id = $3 RETURNING id, nome, preco_centavos', [p.nome, p.preco_centavos, id])
  return produto
}

export async function removerProduto(db: Db, id: number): Promise<{ id: number } | undefined> {
  const [removido] = await db.query<{ id: number }>('DELETE FROM produtos WHERE id = $1 RETURNING id', [id])
  return removido
}
`

const DB_PEDIDOS = String.raw`import type { Env } from '../env'
import { ErroHttp } from '../http'

type Db = Env['db']

export interface ItemPedido {
  produto_id: number
  quantidade: number
  preco_centavos: number
}

export interface Pedido {
  id: number
  total_centavos: number
  itens: ItemPedido[]
}

/** The order and its items are written together or not at all: a missing product undoes the whole thing. */
export async function criarPedido(db: Db, itens: { produtoId: number; quantidade: number }[]): Promise<Pedido> {
  return db.transaction(async (tx) => {
    const [pedido] = await tx.query<{ id: number }>('INSERT INTO pedidos (total_centavos) VALUES (0) RETURNING id')
    const criados: ItemPedido[] = []
    let total = 0
    for (const item of itens) {
      const [produto] = await tx.query<{ preco_centavos: number }>('SELECT preco_centavos FROM produtos WHERE id = $1', [item.produtoId])
      if (!produto) throw new ErroHttp(422, 'Produto inexistente', 'O produto ' + item.produtoId + ' não existe.')
      await tx.query('INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco_centavos) VALUES ($1, $2, $3, $4)', [pedido.id, item.produtoId, item.quantidade, produto.preco_centavos])
      criados.push({ produto_id: item.produtoId, quantidade: item.quantidade, preco_centavos: produto.preco_centavos })
      total += produto.preco_centavos * item.quantidade
    }
    await tx.query('UPDATE pedidos SET total_centavos = $1 WHERE id = $2', [total, pedido.id])
    return { id: pedido.id, total_centavos: total, itens: criados }
  })
}

export async function buscarPedido(db: Db, id: number): Promise<Pedido | undefined> {
  const [pedido] = await db.query<{ id: number; total_centavos: number }>('SELECT id, total_centavos FROM pedidos WHERE id = $1', [id])
  if (!pedido) return undefined
  const itens = await db.query<ItemPedido>('SELECT produto_id, quantidade, preco_centavos FROM itens_pedido WHERE pedido_id = $1 ORDER BY id', [id])
  return { ...pedido, itens }
}
`

const validacao = (f: Flags) =>
  String.raw`import { z } from 'zod'
import { ErroHttp } from './http'

export const produtoSchema = z.object({
  nome: z.string().min(1),
  preco_centavos: z.number().int().min(0),
})

export const pedidoSchema = z.object({
  itens: z.array(z.object({ produtoId: z.number().int().min(1), quantidade: z.number().int().min(1) })).min(1),
})
${
  f.lista
    ? String.raw`
export const listaSchema = z.object({
  cursor: z.coerce.number().int().min(0).default(0),
  limite: z.coerce.number().int().min(1).default(20),
  q: z.string().optional(),
  preco_min: z.coerce.number().int().optional(),
  preco_max: z.coerce.number().int().optional(),
})
`
    : ''
}${
    f.auth
      ? String.raw`
export const cadastroSchema = z.object({
  email: z.email(),
  senha: z.string().min(8),
})

export const loginSchema = z.object({
  email: z.email(),
  senha: z.string().min(1),
})
`
      : ''
  }
function validar<S extends z.ZodType>(dados: unknown, schema: S): z.output<S> {
  const resultado = schema.safeParse(dados)
  if (resultado.success) return resultado.data
  const erros = resultado.error.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message }))
  throw new ErroHttp(400, 'Dados inválidos', 'Corrija os campos indicados.', { erros })
}

export async function lerCorpo<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  return validar(await req.json().catch(() => undefined), schema)
}
${
  f.lista
    ? String.raw`
export function lerConsulta<S extends z.ZodType>(req: Request, schema: S): z.output<S> {
  return validar(Object.fromEntries(new URL(req.url).searchParams), schema)
}
`
    : ''
}`

const AUTH = String.raw`import { ErroHttp } from './http'

// Em produção o segredo vem de uma variável de ambiente, nunca do código.
const SEGREDO = 'segredo-de-desenvolvimento'
const ITERACOES = 100_000
const HORA_MS = 3_600_000
const texto = new TextEncoder()

const hex = (bytes: ArrayBuffer | Uint8Array) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
const base64 = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)))

async function derivar(senha: string, sal: Uint8Array): Promise<string> {
  const chave = await crypto.subtle.importKey('raw', texto.encode(senha), 'PBKDF2', false, ['deriveBits'])
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: ITERACOES }, chave, 256))
}

/** salt:hash, with a random salt per user. */
export async function hashSenha(senha: string): Promise<string> {
  const sal = crypto.getRandomValues(new Uint8Array(16))
  return hex(sal) + ':' + (await derivar(senha, sal))
}

export async function confereSenha(senha: string, guardado: string): Promise<boolean> {
  const [salHex, hash] = guardado.split(':')
  const sal = Uint8Array.from((salHex.match(/../g) ?? []).map((par) => parseInt(par, 16)))
  return (await derivar(senha, sal)) === hash
}

async function assinar(dados: string): Promise<string> {
  const chave = await crypto.subtle.importKey('raw', texto.encode(SEGREDO), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return base64(await crypto.subtle.sign('HMAC', chave, texto.encode(dados)))
}

/** A signed token that stops working after an hour. */
export async function criarToken(usuario: { id: number; papel: string }): Promise<{ token: string; expiraEm: string }> {
  const exp = Date.now() + HORA_MS
  const dados = btoa(JSON.stringify({ sub: usuario.id, papel: usuario.papel, exp }))
  return { token: dados + '.' + (await assinar(dados)), expiraEm: new Date(exp).toISOString() }
}

/** The session of the request, or 401 (no valid token) / 403 (valid token, wrong role). */
export async function exigir(req: Request, papel?: 'admin'): Promise<{ sub: number; papel: string }> {
  const [tipo, token] = (req.headers.get('Authorization') ?? '').split(' ')
  if (tipo !== 'Bearer' || !token) throw new ErroHttp(401, 'Não autenticado', 'Envie Authorization: Bearer <token>.')
  const [dados, assinatura] = token.split('.')
  if (!dados || assinatura !== (await assinar(dados))) throw new ErroHttp(401, 'Token inválido')
  let sessao: { sub: number; papel: string; exp: number }
  try {
    sessao = JSON.parse(atob(dados))
  } catch {
    throw new ErroHttp(401, 'Token inválido')
  }
  if (!(sessao.exp > Date.now())) throw new ErroHttp(401, 'Token expirado')
  if (papel && sessao.papel !== papel) throw new ErroHttp(403, 'Sem permissão', 'Só ' + papel + ' faz isso.')
  return sessao
}
`

const DB_USUARIOS = String.raw`import type { Env } from '../env'

type Db = Env['db']

export interface Usuario {
  id: number
  email: string
  papel: 'cliente' | 'admin'
}

/** The first user becomes admin, the rest are clients; undefined when the e-mail is taken. */
export async function criarUsuario(db: Db, email: string, senhaHash: string): Promise<Usuario | undefined> {
  const [usuario] = await db.query<Usuario>(
    "INSERT INTO usuarios (email, senha_hash, papel) VALUES ($1, $2, CASE WHEN EXISTS (SELECT 1 FROM usuarios) THEN 'cliente' ELSE 'admin' END) ON CONFLICT (email) DO NOTHING RETURNING id, email, papel",
    [email, senhaHash],
  )
  return usuario
}

export async function buscarCredenciais(db: Db, email: string): Promise<(Usuario & { senha_hash: string }) | undefined> {
  const [usuario] = await db.query<Usuario & { senha_hash: string }>('SELECT id, email, papel, senha_hash FROM usuarios WHERE email = $1', [email])
  return usuario
}
`

// --- Fetch puro ---

const fetchHealth = String.raw`import { bancoResponde } from '../db/saude'
import type { Env } from '../env'

export async function health(_req: Request, env: Env): Promise<Response> {
  await bancoResponde(env.db)
  return Response.json({ status: 'ok' })
}
`

const fetchProdutos = (f: Flags) => {
  const admin = f.auth ? "    await exigir(req, 'admin')\n" : ''
  const corpo = f.validar ? 'await lerCorpo(req, produtoSchema)' : 'await req.json()'
  return (
    lines(
      "import { atualizarProduto, buscarProduto, criarProduto, listarProdutos, removerProduto } from '../db/produtos'",
      f.auth && "import { exigir } from '../auth'",
      "import type { Env } from '../env'",
      "import { achado, idDe, problema } from '../http'",
      f.validar && 'import { ' + (f.lista ? 'listaSchema, ' : '') + 'lerCorpo, ' + (f.lista ? 'lerConsulta, ' : '') + "produtoSchema } from '../validacao'",
    ) +
    String.raw`
export async function produtos(req: Request, env: Env, id?: string): Promise<Response> {
  const { db } = env
  if (!id && req.method === 'GET') return Response.json(await listarProdutos(db${f.lista ? ', lerConsulta(req, listaSchema)' : ''}))
  if (!id && req.method === 'POST') {
${admin}    const criado = await criarProduto(db, ${corpo})
    return Response.json(criado, { status: 201, headers: { Location: '/produtos/' + criado.id } })
  }
  if (id && req.method === 'GET') return Response.json(achado(await buscarProduto(db, idDe(id)), 'Produto'))
  if (id && req.method === 'PUT') {
${admin}    return Response.json(achado(await atualizarProduto(db, idDe(id), ${corpo}), 'Produto'))
  }
  if (id && req.method === 'DELETE') {
${admin}    achado(await removerProduto(db, idDe(id)), 'Produto')
    return new Response(null, { status: 204 })
  }
  return problema(405, 'Método não permitido')
}
`
  )
}

const fetchPedidos = (f: Flags) => {
  const corpo = f.validar ? 'await lerCorpo(req, pedidoSchema)' : 'await req.json()'
  return (
    lines(
      f.auth && "import { exigir } from '../auth'",
      "import { buscarPedido, criarPedido } from '../db/pedidos'",
      "import type { Env } from '../env'",
      "import { achado, idDe, problema } from '../http'",
      f.validar && "import { lerCorpo, pedidoSchema } from '../validacao'",
    ) +
    String.raw`
export async function pedidos(req: Request, env: Env, id?: string): Promise<Response> {
${f.auth ? '  await exigir(req)\n' : ''}  if (!id && req.method === 'POST') {
    const criado = await criarPedido(env.db, (${corpo}).itens)
    return Response.json(criado, { status: 201, headers: { Location: '/pedidos/' + criado.id } })
  }
  if (id && req.method === 'GET') return Response.json(achado(await buscarPedido(env.db, idDe(id)), 'Pedido'))
  return problema(405, 'Método não permitido')
}
`
  )
}

const FETCH_USUARIOS = String.raw`import { confereSenha, criarToken, hashSenha } from '../auth'
import { buscarCredenciais, criarUsuario } from '../db/usuarios'
import type { Env } from '../env'
import { ErroHttp, problema } from '../http'
import { cadastroSchema, lerCorpo, loginSchema } from '../validacao'

export async function usuarios(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return problema(405, 'Método não permitido')
  const { email, senha } = await lerCorpo(req, cadastroSchema)
  const criado = await criarUsuario(env.db, email, await hashSenha(senha))
  if (!criado) throw new ErroHttp(409, 'E-mail já cadastrado')
  return Response.json(criado, { status: 201 })
}

export async function login(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return problema(405, 'Método não permitido')
  const { email, senha } = await lerCorpo(req, loginSchema)
  const usuario = await buscarCredenciais(env.db, email)
  if (!usuario || !(await confereSenha(senha, usuario.senha_hash))) throw new ErroHttp(401, 'Credenciais inválidas', 'E-mail ou senha incorretos.')
  return Response.json(await criarToken(usuario))
}
`

/** The route modules of a stage: file, and the names it exports (each is a path of the same name). */
const modulos = (f: Flags): [string, string[]][] => [
  ['health', ['health']],
  ...(f.stage >= 2 ? [['produtos', ['produtos']] as [string, string[]]] : []),
  ...(f.stage >= 3 ? [['pedidos', ['pedidos']] as [string, string[]]] : []),
  ...(f.stage >= 6 ? [['usuarios', ['usuarios', 'login']] as [string, string[]]] : []),
]

const fetchIndex = (f: Flags) => {
  const mods = modulos(f)
  return (
    lines(
      "import type { Env } from './env'",
      "import { deErro, problema } from './http'",
      ...mods.map(([file, names]) => 'import { ' + names.join(', ') + " } from './routes/" + file + "'"),
    ) +
    String.raw`
type Rota = (req: Request, env: Env, id?: string) => Promise<Response>

const rotas: Record<string, Rota> = { ${mods.flatMap(([, names]) => names).join(', ')} }

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

// --- Hono ---

const honoProdutos = (f: Flags) => {
  const admin = f.auth ? 'soAdmin, ' : ''
  const corpo = f.validar ? 'await lerCorpo(c.req.raw, produtoSchema)' : 'await c.req.json()'
  return (
    lines(
      "import { Hono } from 'hono'",
      f.auth && "import type { MiddlewareHandler } from 'hono'",
      f.auth && "import { exigir } from '../auth'",
      "import { atualizarProduto, buscarProduto, criarProduto, listarProdutos, removerProduto } from '../db/produtos'",
      "import type { Env } from '../env'",
      "import { achado, idDe } from '../http'",
      f.validar && 'import { ' + (f.lista ? 'listaSchema, ' : '') + 'lerCorpo, ' + (f.lista ? 'lerConsulta, ' : '') + "produtoSchema } from '../validacao'",
    ) +
    String.raw`
export const produtos = new Hono<{ Bindings: Env }>()
${
  f.auth
    ? String.raw`
const soAdmin: MiddlewareHandler = async (c, next) => {
  await exigir(c.req.raw, 'admin')
  await next()
}
`
    : ''
}
produtos.get('/', async (c) => c.json(await listarProdutos(c.env.db${f.lista ? ', lerConsulta(c.req.raw, listaSchema)' : ''})))

produtos.post('/', ${admin}async (c) => {
  const criado = await criarProduto(c.env.db, ${corpo})
  c.header('Location', '/produtos/' + criado.id)
  return c.json(criado, 201)
})

produtos.get('/:id', async (c) => c.json(achado(await buscarProduto(c.env.db, idDe(c.req.param('id'))), 'Produto')))

produtos.put('/:id', ${admin}async (c) => c.json(achado(await atualizarProduto(c.env.db, idDe(c.req.param('id')), ${corpo}), 'Produto')))

produtos.delete('/:id', ${admin}async (c) => {
  achado(await removerProduto(c.env.db, idDe(c.req.param('id'))), 'Produto')
  return c.body(null, 204)
})
`
  )
}

const honoPedidos = (f: Flags) => {
  const corpo = f.validar ? 'await lerCorpo(c.req.raw, pedidoSchema)' : 'await c.req.json()'
  return (
    lines(
      "import { Hono } from 'hono'",
      f.auth && "import { exigir } from '../auth'",
      "import { buscarPedido, criarPedido } from '../db/pedidos'",
      "import type { Env } from '../env'",
      "import { achado, idDe } from '../http'",
      f.validar && "import { lerCorpo, pedidoSchema } from '../validacao'",
    ) +
    String.raw`
export const pedidos = new Hono<{ Bindings: Env }>()
${
  f.auth
    ? String.raw`
// Every order route needs a logged-in user.
pedidos.use('*', async (c, next) => {
  await exigir(c.req.raw)
  await next()
})
`
    : ''
}
pedidos.post('/', async (c) => {
  const criado = await criarPedido(c.env.db, (${corpo}).itens)
  c.header('Location', '/pedidos/' + criado.id)
  return c.json(criado, 201)
})

pedidos.get('/:id', async (c) => c.json(achado(await buscarPedido(c.env.db, idDe(c.req.param('id'))), 'Pedido')))
`
  )
}

const HONO_USUARIOS = String.raw`import { Hono } from 'hono'
import { confereSenha, criarToken, hashSenha } from '../auth'
import { buscarCredenciais, criarUsuario } from '../db/usuarios'
import type { Env } from '../env'
import { ErroHttp } from '../http'
import { cadastroSchema, lerCorpo, loginSchema } from '../validacao'

export const usuarios = new Hono<{ Bindings: Env }>()

usuarios.post('/', async (c) => {
  const { email, senha } = await lerCorpo(c.req.raw, cadastroSchema)
  const criado = await criarUsuario(c.env.db, email, await hashSenha(senha))
  if (!criado) throw new ErroHttp(409, 'E-mail já cadastrado')
  return c.json(criado, 201)
})

export const login = new Hono<{ Bindings: Env }>()

login.post('/', async (c) => {
  const { email, senha } = await lerCorpo(c.req.raw, loginSchema)
  const usuario = await buscarCredenciais(c.env.db, email)
  if (!usuario || !(await confereSenha(senha, usuario.senha_hash))) throw new ErroHttp(401, 'Credenciais inválidas', 'E-mail ou senha incorretos.')
  return c.json(await criarToken(usuario))
})
`

const honoIndex = (f: Flags) => {
  const mods = modulos(f)
  return (
    lines(
      "import { Hono } from 'hono'",
      "import type { Env } from './env'",
      "import { deErro, problema } from './http'",
      ...mods.map(([file, names]) => 'import { ' + names.join(', ') + " } from './routes/" + file + "'"),
    ) +
    String.raw`
const app = new Hono<{ Bindings: Env }>()

${mods
  .flatMap(([, names]) => names)
  .map((n) => "app.route('/" + n + "', " + n + ')')
  .join('\n')}

app.notFound(() => problema(404, 'Rota não encontrada'))
app.onError(deErro)

export default app
`
  )
}

/** The whole project after `stage` (0 to 6). Stage 0 is "primeiros-passos": starter + GET /ola, without the migration. */
export function referencia(framework: Framework, stage: number): Record<string, string> {
  if (stage === 0) {
    const hono = framework === 'hono'
    const files = starter('referencia', framework).files
    // The course starts blank: the produtos table arrives with its stage (2), not with the project.
    delete files['migrations/001_init.sql']
    files['src/routes/ola.ts'] = hono ? OLA_HONO_ROUTE : OLA_FETCH_ROUTE
    const ligar = hono ? "app.route('/health', health)" : 'return health(env)'
    const registro = hono ? "app.route('/ola', ola)" : "if (req.method === 'GET' && pathname === '/ola') return ola()"
    files['src/index.ts'] = files['src/index.ts']
      .replace("import { health } from './routes/health'", (m) => [m, "import { ola } from './routes/ola'"].join('\n'))
      .replace(ligar, (m) => [m, registro].join(hono ? '\n' : '\n' + '    '))
    return files
  }
  const f: Flags = { stage, validar: stage >= 4, lista: stage >= 5, auth: stage >= 6 }
  const hono = framework === 'hono'
  const base = starter('referencia', framework).files
  const files: Record<string, string> = {
    'src/index.ts': hono ? honoIndex(f) : fetchIndex(f),
    'src/routes/health.ts': hono ? base['src/routes/health.ts'] : fetchHealth,
    'src/db/saude.ts': base['src/db/saude.ts'],
    'src/env.ts': base['src/env.ts'],
    'src/http.ts': HTTP,
  }
  if (stage >= 2) {
    files['migrations/001_init.sql'] = base['migrations/001_init.sql']
    files['src/routes/produtos.ts'] = hono ? honoProdutos(f) : fetchProdutos(f)
    files['src/db/produtos.ts'] = dbProdutos(f)
  }
  if (stage >= 3) {
    files['src/routes/pedidos.ts'] = hono ? honoPedidos(f) : fetchPedidos(f)
    files['src/db/pedidos.ts'] = DB_PEDIDOS
    files['migrations/002_pedidos.sql'] = PEDIDOS_SQL
  }
  if (stage >= 4) files['src/validacao.ts'] = validacao(f)
  if (stage >= 6) {
    files['src/auth.ts'] = AUTH
    files['src/db/usuarios.ts'] = DB_USUARIOS
    files['src/routes/usuarios.ts'] = hono ? HONO_USUARIOS : FETCH_USUARIOS
    files['migrations/003_usuarios.sql'] = USUARIOS_SQL
  }
  return files
}
