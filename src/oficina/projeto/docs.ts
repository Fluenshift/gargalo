// The short reference shown beside the editor: the chosen framework (Hono 4 or fetch puro) and the Env the project gets.

import type { Framework } from './project'

export interface DocEntry {
  /** Stable: guided steps link to it (`GuidedStep.docs`). Unique within docsFor(framework). */
  id: string
  title: string
  text: string
  code?: string
}

export interface DocSection {
  title: string
  entries: DocEntry[]
}

const HONO: DocSection[] = [
  {
    title: 'Hono: app e rotas',
    entries: [
      {
        id: 'hono-app', title: 'Criar o app',
        text: 'O app é um Hono com o tipo do Env; src/index.ts exporta ele por padrão.',
        code: `import { Hono } from 'hono'
import type { Env } from './env'

const app = new Hono<{ Bindings: Env }>()
export default app`,
      },
      {
        id: 'hono-rotas', title: 'Rotas',
        text: 'Um método por verbo HTTP. O handler recebe o contexto c e devolve uma resposta.',
        code: `app.get('/produtos', (c) => c.json([]))
app.post('/produtos', async (c) => { … })
app.put('/produtos/:id', …)
app.delete('/produtos/:id', …)`,
      },
      {
        id: 'hono-route', title: 'Rotas em outro arquivo',
        text: 'Cada arquivo cria um Hono e o index monta ele num prefixo com app.route.',
        code: `// src/routes/produtos.ts
export const produtos = new Hono<{ Bindings: Env }>()
produtos.get('/', (c) => …)      // GET /produtos
produtos.get('/:id', (c) => …)   // GET /produtos/1

// src/index.ts
app.route('/produtos', produtos)`,
      },
    ],
  },
  {
    title: 'Hono: ler a requisição',
    entries: [
      { id: 'hono-param', title: 'Parâmetro do caminho', text: 'Vem sempre como texto: converta antes de usar.', code: `const id = Number(c.req.param('id'))` },
      { id: 'hono-query', title: 'Query string', text: 'Texto ou undefined quando não veio.', code: `const limite = Number(c.req.query('limite') ?? 20)` },
      { id: 'hono-body', title: 'Corpo JSON', text: 'Lança erro se o corpo não for JSON válido.', code: `const body = await c.req.json<{ nome: string }>()` },
      { id: 'hono-header', title: 'Cabeçalho', text: 'Nome sem diferença de maiúsculas.', code: `const token = c.req.header('Authorization')` },
    ],
  },
  {
    title: 'Hono: responder',
    entries: [
      { id: 'hono-json', title: 'JSON com status', text: 'c.json(corpo, status); sem status, 200.', code: `return c.json(produto, 201)` },
      { id: 'hono-header-resposta', title: 'Cabeçalho na resposta', text: 'Chame c.header antes de devolver.', code: `c.header('Location', \`/produtos/\${produto.id}\`)
return c.json(produto, 201)` },
      { id: 'hono-sem-corpo', title: 'Sem corpo', text: '204 não tem corpo.', code: `return c.body(null, 204)` },
      {
        id: 'hono-erros', title: 'Erros com HTTPException',
        text: 'Lance de qualquer lugar; o Hono responde com o status. app.onError trata todos num lugar só.',
        code: `import { HTTPException } from 'hono/http-exception'

throw new HTTPException(404, { message: 'Produto não encontrado.' })

app.onError((err, c) => {
  const problem = { 'Content-Type': 'application/problem+json' }
  if (err instanceof HTTPException) return c.json({ type: 'about:blank', title: err.message, status: err.status }, err.status, problem)
  return c.json({ type: 'about:blank', title: 'Erro interno', status: 500 }, 500, problem)
})`,
      },
      { id: 'hono-notfound', title: 'Rota não encontrada', text: 'Sem rota, o Hono responde 404 "404 Not Found"; app.notFound troca essa resposta.', code: `app.notFound((c) => c.json({ title: 'Rota não encontrada', status: 404 }, 404))` },
    ],
  },
  {
    title: 'Hono: banco',
    entries: [{ id: 'hono-db', title: 'c.env.db', text: 'O banco chega no Env, em c.env.db.', code: `const produtos = await c.env.db.query('SELECT id, nome FROM produtos')` }],
  },
]

const FETCH: DocSection[] = [
  {
    title: 'fetch puro: o app',
    entries: [
      {
        id: 'fetch-app', title: 'O formato',
        text: 'O mesmo de Bun, Deno e Cloudflare Workers: um objeto com fetch(req, env) que devolve um Response.',
        code: `import type { Env } from './env'

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return Response.json({ ok: true })
  },
}`,
      },
      {
        id: 'fetch-rotear', title: 'Rotear por método e caminho',
        text: 'Leia o caminho com new URL(req.url) e decida com if; um regex pega o parâmetro.',
        code: `const { pathname, searchParams } = new URL(req.url)
if (req.method === 'GET' && pathname === '/produtos') return listar(env)
const m = pathname.match(/^\\/produtos\\/(\\d+)$/)
if (m && req.method === 'GET') return buscar(env, Number(m[1]))
return Response.json({ title: 'Rota não encontrada', status: 404 }, { status: 404 })`,
      },
    ],
  },
  {
    title: 'fetch puro: ler a requisição',
    entries: [
      { id: 'fetch-query', title: 'Query string', text: 'searchParams.get devolve texto ou null.', code: `const limite = Number(searchParams.get('limite') ?? 20)` },
      { id: 'fetch-body', title: 'Corpo JSON', text: 'Lança erro se o corpo não for JSON válido.', code: `const body = (await req.json()) as { nome: string }` },
      { id: 'fetch-header', title: 'Cabeçalho', text: 'Nome sem diferença de maiúsculas; null quando não veio.', code: `const token = req.headers.get('Authorization')` },
    ],
  },
  {
    title: 'fetch puro: responder',
    entries: [
      { id: 'fetch-json', title: 'JSON com status', text: 'Response.json(corpo, { status, headers }); sem status, 200.', code: `return Response.json(produto, { status: 201, headers: { Location: \`/produtos/\${produto.id}\` } })` },
      { id: 'fetch-sem-corpo', title: 'Sem corpo', text: '204 não tem corpo.', code: `return new Response(null, { status: 204 })` },
    ],
  },
]

/** The API's error format and thrown errors: plain TypeScript, the same in both frameworks. */
export const ERROS_DOCS: DocSection = {
  title: 'Erros da API',
  entries: [
    {
      id: 'problem-json',
      title: 'problem+json',
      text: 'O formato padrão de erro de API (RFC 9457): Content-Type application/problem+json e um corpo com type, title e status (detail é opcional). Um formato só deixa o cliente tratar todo erro do mesmo jeito.',
      code: `return Response.json(
  { type: 'about:blank', title: 'Não encontrado', status: 404 },
  { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
)`,
    },
    {
      id: 'erro-lancado',
      title: 'Lançar e capturar um erro',
      text: 'throw interrompe a função e sobe até o primeiro catch. Uma classe que estende Error carrega dados a mais (o status, por exemplo); instanceof diz qual erro chegou.',
      code: `class ErroHttp extends Error {
  status: number
  constructor(status: number, mensagem: string) {
    super(mensagem)
    this.status = status
  }
}

try {
  throw new ErroHttp(404, 'Não encontrado')
} catch (err) {
  if (err instanceof ErroHttp) console.log(err.status) // 404
}`,
    },
    {
      id: 'response-pronta',
      title: 'Devolver um Response pronto',
      text: 'Response é o tipo padrão da web: o fetch puro sempre devolve um. No Hono, um handler também pode devolver um Response em vez de c.json, então a mesma função de erro serve aos dois.',
      code: `app.get('/x', () => Response.json({ ok: true }, { status: 200 }))`,
    },
  ],
}

/** The Env and its db: the same for both frameworks. */
export const ENV_DOCS: DocSection = {
  title: 'Env e banco',
  entries: [
    {
      id: 'env', title: 'Env',
      text: 'O que o app recebe de fora: só o banco, em env.db (no Hono, c.env.db). O tipo está em src/env.ts.',
      code: `export interface Env {
  db: {
    query<T>(sql: string, params?: unknown[]): Promise<T[]>
    transaction<R>(fn: (tx: Env['db']) => Promise<R>): Promise<R>
  }
}`,
    },
    {
      id: 'db-query', title: 'db.query',
      text: 'Devolve as linhas como objetos. Valores entram por $1, $2… em params, nunca colados no SQL.',
      code: `const [produto] = await db.query<{ id: number; nome: string }>(
  'SELECT id, nome FROM produtos WHERE id = $1',
  [id],
)`,
    },
    {
      id: 'returning', title: 'RETURNING',
      text: 'INSERT e UPDATE devolvem a linha gravada com RETURNING.',
      code: `const [criado] = await db.query('INSERT INTO produtos (nome) VALUES ($1) RETURNING id, nome', [nome])`,
    },
    {
      id: 'db-transaction', title: 'db.transaction',
      text: 'Tudo dentro grava junto ou nada grava: um erro desfaz tudo. Use o tx que a função recebe.',
      code: `await db.transaction(async (tx) => {
  const [pedido] = await tx.query<{ id: number }>('INSERT INTO pedidos DEFAULT VALUES RETURNING id')
  await tx.query('INSERT INTO itens (pedido_id, produto_id) VALUES ($1, $2)', [pedido.id, produtoId])
})`,
    },
    {
      id: 'db-erros', title: 'Erros do banco',
      text: 'O erro tem code do Postgres: 23505 valor repetido, 23502 campo obrigatório nulo, 23503 referência inválida.',
      code: `try { … } catch (err) {
  if ((err as { code?: string }).code === '23505') return c.json({ title: 'Já existe', status: 409 }, 409)
  throw err
}`,
    },
    {
      id: 'select-colunas', title: 'Escolher as colunas',
      text: 'SELECT * devolve toda coluna, inclusive as que forem criadas depois. Listar as colunas faz a consulta dizer o que pode sair.',
      code: `// devolve tudo da tabela
await db.query('SELECT * FROM clientes')
// devolve só o que a API pode mostrar
await db.query('SELECT id, nome FROM clientes')`,
    },
    {
      id: 'sql-injecao', title: 'SQL injection',
      text: 'Colar a entrada no texto do SQL deixa quem a enviou escrever SQL. Com $1 e params, o valor chega ao banco separado do comando e nunca é executado.',
      code: `const nome = "x' OR '1'='1"
// ERRADO: o OR vira parte do SQL e casa todas as linhas
await db.query("SELECT id FROM clientes WHERE nome = '" + nome + "'")
// CERTO: o valor é só dado
await db.query('SELECT id FROM clientes WHERE nome = $1', [nome])`,
    },
    {
      id: 'n-mais-um', title: 'N+1: uma consulta por linha',
      text: 'Uma consulta dentro de um laço roda uma vez por linha. Busque tudo de uma vez com ANY($1) e agrupe em memória: o número de consultas deixa de crescer com os dados.',
      code: `// N+1: 1 consulta para os autores + 1 para cada um
for (const a of autores) a.livros = await db.query('SELECT titulo FROM livros WHERE autor_id = $1', [a.id])

// 2 consultas, não importa quantos autores
const livros = await db.query('SELECT autor_id, titulo FROM livros WHERE autor_id = ANY($1)', [autores.map((a) => a.id)])`,
    },
    {
      id: 'update-atomico', title: 'Gravar sem ler antes',
      text: 'Ler, decidir e gravar deixa uma brecha entre a leitura e a gravação: duas requisições passam juntas. Ponha a condição no próprio UPDATE; o banco a confere e grava numa operação só, e RETURNING diz se alguma linha mudou.',
      code: `const vendeu = await db.query('UPDATE ingressos SET vagas = vagas - 1 WHERE id = $1 AND vagas > 0 RETURNING id', [id])
if (!vendeu.length) { /* esgotado */ }`,
    },
  ],
}

/** The reference beside the editor: the framework's sections, the API's errors, then the Env. */
export const docsFor = (framework: Framework): DocSection[] => [...(framework === 'hono' ? HONO : FETCH), ERROS_DOCS, ENV_DOCS]
