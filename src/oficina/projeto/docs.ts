// The short reference shown beside the editor: the chosen framework (Hono 4 or fetch puro) and the Env the project gets.

import type { Framework } from './project'

export interface DocEntry {
  /** Stable: guided steps link to it (`GuidedStep.docs`). Unique within docsFor(framework). */
  id: string
  title: string
  text: string
  code?: string
  /** The official page for exactly this thing; absent for our own helpers. */
  url?: string
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
        id: 'hono-app', url: 'https://hono.dev/docs/api/hono', title: 'Criar o app',
        text: 'O app é um Hono com o tipo do Env; src/index.ts exporta ele por padrão.',
        code: `import { Hono } from 'hono'
import type { Env } from './env'

const app = new Hono<{ Bindings: Env }>()
export default app`,
      },
      {
        id: 'hono-rotas', url: 'https://hono.dev/docs/api/routing', title: 'Rotas',
        text: 'Um método por verbo HTTP. O handler recebe o contexto c e devolve uma resposta.',
        code: `app.get('/produtos', (c) => c.json([]))
app.post('/produtos', async (c) => { … })
app.put('/produtos/:id', …)
app.delete('/produtos/:id', …)`,
      },
      {
        id: 'hono-route', url: 'https://hono.dev/docs/api/routing#grouping', title: 'Rotas em outro arquivo',
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
      { id: 'hono-param', url: 'https://hono.dev/docs/api/request#param', title: 'Parâmetro do caminho', text: 'Vem sempre como texto: converta antes de usar.', code: `const id = Number(c.req.param('id'))` },
      { id: 'hono-query', url: 'https://hono.dev/docs/api/request#query', title: 'Query string', text: 'Texto ou undefined quando não veio.', code: `const limite = Number(c.req.query('limite') ?? 20)` },
      { id: 'hono-body', url: 'https://hono.dev/docs/api/request#json', title: 'Corpo JSON', text: 'Lança erro se o corpo não for JSON válido.', code: `const body = await c.req.json<{ nome: string }>()` },
      { id: 'hono-header', url: 'https://hono.dev/docs/api/request#header', title: 'Cabeçalho', text: 'Nome sem diferença de maiúsculas.', code: `const token = c.req.header('Authorization')` },
    ],
  },
  {
    title: 'Hono: responder',
    entries: [
      { id: 'hono-json', url: 'https://hono.dev/docs/api/context#json', title: 'JSON com status', text: 'c.json(corpo, status); sem status, 200.', code: `return c.json(produto, 201)` },
      { id: 'hono-header-resposta', url: 'https://hono.dev/docs/api/context#header', title: 'Cabeçalho na resposta', text: 'Chame c.header antes de devolver.', code: `c.header('Location', \`/produtos/\${produto.id}\`)
return c.json(produto, 201)` },
      { id: 'hono-sem-corpo', url: 'https://hono.dev/docs/api/context#body', title: 'Sem corpo', text: '204 não tem corpo.', code: `return c.body(null, 204)` },
      {
        id: 'hono-erros', url: 'https://hono.dev/docs/api/exception', title: 'Erros com HTTPException',
        text: 'Lance de qualquer lugar; o Hono responde com o status. app.onError trata todos num lugar só.',
        code: `import { HTTPException } from 'hono/http-exception'

throw new HTTPException(404, { message: 'Produto não encontrado.' })

app.onError((err, c) => {
  const problem = { 'Content-Type': 'application/problem+json' }
  if (err instanceof HTTPException) return c.json({ type: 'about:blank', title: err.message, status: err.status }, err.status, problem)
  return c.json({ type: 'about:blank', title: 'Erro interno', status: 500 }, 500, problem)
})`,
      },
      { id: 'hono-notfound', url: 'https://hono.dev/docs/api/hono#not-found', title: 'Rota não encontrada', text: 'Sem rota, o Hono responde 404 "404 Not Found"; app.notFound troca essa resposta.', code: `app.notFound((c) => c.json({ title: 'Rota não encontrada', status: 404 }, 404))` },
    ],
  },
  {
    title: 'Hono: banco',
    entries: [{ id: 'hono-db', title: 'c.env.db', text: 'O banco chega no Env, em c.env.db.', code: `const produtos = await c.env.db.query('SELECT id, nome FROM produtos')` }],
  },  {
    title: 'Hono: middleware',
    entries: [
      {
        id: 'hono-middleware', url: 'https://hono.dev/docs/guides/middleware', title: 'Middleware',
        text: "Uma função que roda antes do handler. Se lançar um erro, o handler nem começa e o app.onError responde; com await next(), segue. use('*') vale para todas as rotas do roteador; passado na rota, só para ela.",
        code: String.raw`import type { MiddlewareHandler } from 'hono'

const registrar: MiddlewareHandler = async (c, next) => {
  console.log(c.req.method, c.req.path)
  await next() // segue para o handler
}

rotas.use('*', registrar)                  // todas as rotas deste roteador
rotas.post('/', registrar, async (c) => …) // só esta rota`,
      },
    ],
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
        id: 'fetch-rotear', url: 'https://developer.mozilla.org/pt-BR/docs/Web/API/URL', title: 'Rotear por método e caminho',
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
      { id: 'fetch-query', url: 'https://developer.mozilla.org/pt-BR/docs/Web/API/URLSearchParams/get', title: 'Query string', text: 'searchParams.get devolve texto ou null.', code: `const limite = Number(searchParams.get('limite') ?? 20)` },
      { id: 'fetch-body', url: 'https://developer.mozilla.org/en-US/docs/Web/API/Request/json', title: 'Corpo JSON', text: 'Lança erro se o corpo não for JSON válido.', code: `const body = (await req.json()) as { nome: string }` },
      { id: 'fetch-header', url: 'https://developer.mozilla.org/en-US/docs/Web/API/Headers/get', title: 'Cabeçalho', text: 'Nome sem diferença de maiúsculas; null quando não veio.', code: `const token = req.headers.get('Authorization')` },
    ],
  },
  {
    title: 'fetch puro: responder',
    entries: [
      { id: 'fetch-json', url: 'https://developer.mozilla.org/en-US/docs/Web/API/Response/json_static', title: 'JSON com status', text: 'Response.json(corpo, { status, headers }); sem status, 200.', code: `return Response.json(produto, { status: 201, headers: { Location: \`/produtos/\${produto.id}\` } })` },
      { id: 'fetch-sem-corpo', url: 'https://developer.mozilla.org/pt-BR/docs/Web/HTTP/Reference/Status/204', title: 'Sem corpo', text: '204 não tem corpo.', code: `return new Response(null, { status: 204 })` },
    ],
  },  {
    title: 'fetch puro: o id no caminho',
    entries: [
      {
        id: 'fetch-param', title: 'Separar o caminho em pedaços',
        text: "split('/') quebra o caminho: o primeiro pedaço é vazio, o segundo é o recurso e o terceiro, o id (texto, ou undefined). O index escolhe a função pelo recurso e passa o id adiante.",
        code: String.raw`// '/produtos/7'.split('/') é ['', 'produtos', '7']
const [, recurso, id] = new URL(req.url).pathname.split('/')
if (recurso === 'produtos') return await produtos(req, env, id)`,
      },
    ],
  },
]

/** The API's error format and thrown errors: plain TypeScript, the same in both frameworks. */
export const ERROS_DOCS: DocSection = {
  title: 'Erros da API',
  entries: [
    {
      id: 'problem-json', url: 'https://www.rfc-editor.org/rfc/rfc9457.html',
      title: 'problem+json',
      text: 'O formato padrão de erro de API (RFC 9457): Content-Type application/problem+json e um corpo com type, title e status (detail é opcional). Um formato só deixa o cliente tratar todo erro do mesmo jeito.',
      code: `return Response.json(
  { type: 'about:blank', title: 'Não encontrado', status: 404 },
  { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
)`,
    },
    {
      id: 'erro-lancado', url: 'https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Reference/Statements/try...catch',
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
      id: 'response-pronta', url: 'https://developer.mozilla.org/pt-BR/docs/Web/API/Response',
      title: 'Devolver um Response pronto',
      text: 'Response é o tipo padrão da web: o fetch puro sempre devolve um. No Hono, um handler também pode devolver um Response em vez de c.json, então a mesma função de erro serve aos dois.',
      code: `app.get('/x', () => Response.json({ ok: true }, { status: 200 }))`,
    },
    {
      id: 'http-helpers',
      title: 'src/http.ts: ErroHttp, problema e deErro',
      text: 'ErroHttp(status, title, detail?, extra?) é um Error que carrega o status. problema(...) monta o Response em problem+json. deErro(err) transforma qualquer erro lançado em resposta: ErroHttp vira o status dele, o resto vira 500.',
      code: `throw new ErroHttp(409, 'Fatura já paga') // de qualquer lugar
return problema(404, 'Rota não encontrada') // um Response pronto
return deErro(err) // no catch, ou em app.onError(deErro)`,
    },
    {
      id: 'id-achado',
      title: 'idDe e achado',
      text: 'idDe(texto) converte o id da URL em número e lança ErroHttp 400 se não for um inteiro válido. achado(valor, nome) devolve o valor, ou lança 404 "<nome> não encontrada" quando a linha não existe.',
      code: `const id = idDe('7') // 7; idDe('abc') lança 400
const fatura = achado(await buscarFatura(db, id), 'Fatura') // ou 404`,
    },
    {
      id: 'zod-refine', url: 'https://zod.dev/api#refinements',
      title: 'Zod: regra entre campos',
      text: 'refine roda depois dos campos individuais e recebe o objeto inteiro. O path diz em qual campo o erro aparece.',
      code: `z.object({ origem: z.number(), destino: z.number() })
  .refine((r) => r.origem !== r.destino, { message: 'Devem ser diferentes.', path: ['destino'] })`,
    },
    {
      id: 'zod-validar', url: 'https://zod.dev/basics#parsing-data',
      title: 'Zod: safeParse e o 400',
      text: 'safeParse não lança erro: devolve { success, data } ou { success: false, error }. Converta a falha em ErroHttp 400, com a lista de campos no extra, e o deErro a responde em problem+json.',
      code: `const r = cartaoSchema.safeParse(dados)
if (r.success) return r.data
const erros = r.error.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message }))
throw new ErroHttp(400, 'Dados inválidos', 'Corrija os campos indicados.', { erros })`,
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
      id: 'returning', url: 'https://www.postgresql.org/docs/current/dml-returning.html', title: 'RETURNING',
      text: 'INSERT e UPDATE devolvem a linha gravada com RETURNING.',
      code: `const [criado] = await db.query('INSERT INTO produtos (nome) VALUES ($1) RETURNING id, nome', [nome])`,
    },
    {
      id: 'db-transaction', url: 'https://www.postgresql.org/docs/current/tutorial-transactions.html', title: 'db.transaction',
      text: 'Tudo dentro grava junto ou nada grava: um erro desfaz tudo. Use o tx que a função recebe.',
      code: `await db.transaction(async (tx) => {
  const [pedido] = await tx.query<{ id: number }>('INSERT INTO pedidos DEFAULT VALUES RETURNING id')
  await tx.query('INSERT INTO itens (pedido_id, produto_id) VALUES ($1, $2)', [pedido.id, produtoId])
})`,
    },
    {
      id: 'db-erros', url: 'https://www.postgresql.org/docs/current/errcodes-appendix.html', title: 'Erros do banco',
      text: 'O erro tem code do Postgres: 23505 valor repetido, 23502 campo obrigatório nulo, 23503 referência inválida.',
      code: `try { … } catch (err) {
  if ((err as { code?: string }).code === '23505') return c.json({ title: 'Já existe', status: 409 }, 409)
  throw err
}`,
    },
    {
      id: 'select-colunas', url: 'https://www.postgresql.org/docs/current/sql-select.html', title: 'Escolher as colunas',
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
      id: 'update-atomico', url: 'https://www.postgresql.org/docs/current/sql-update.html', title: 'Gravar sem ler antes',
      text: 'Ler, decidir e gravar deixa uma brecha entre a leitura e a gravação: duas requisições passam juntas. Ponha a condição no próprio UPDATE; o banco a confere e grava numa operação só, e RETURNING diz se alguma linha mudou.',
      code: `const vendeu = await db.query('UPDATE ingressos SET vagas = vagas - 1 WHERE id = $1 AND vagas > 0 RETURNING id', [id])
if (!vendeu.length) { /* esgotado */ }`,
    },
    {
      id: 'sql-migracao', url: 'https://www.postgresql.org/docs/current/sql-createtable.html',
      title: 'Migração: criar a tabela',
      text: 'Cada arquivo em migrations/ roda uma vez, em ordem de nome. CHECK recusa valores fora da regra; REFERENCES (chave estrangeira) recusa uma linha que aponta para outra inexistente; UNIQUE recusa duplicata.',
      code: `CREATE TABLE faturas (
  id serial PRIMARY KEY,
  cartao int NOT NULL REFERENCES cartoes (id), -- o cartão tem de existir
  valor_centavos int NOT NULL CHECK (valor_centavos > 0), -- sempre positivo
  codigo text NOT NULL UNIQUE -- sem repetição
);`,
    },
    {
      id: 'dinheiro-centavos', url: 'https://www.postgresql.org/docs/current/datatype-numeric.html',
      title: 'Dinheiro em centavos inteiros',
      text: 'Ponto flutuante não representa 0,10 exatamente, e as somas acumulam erro. Guarde o valor como inteiro de centavos e converta só para exibir.',
      code: `0.1 + 0.2 // 0.30000000000000004
10 + 20 // 30 centavos: exato`,
    },
    {
      id: 'corrida-saldo', url: 'https://www.postgresql.org/docs/current/explicit-locking.html',
      title: 'Condição de corrida no saldo',
      text: 'Ler o saldo, conferir no código e gravar depois deixa uma janela: duas requisições leem o mesmo valor e as duas passam. O banco do navegador roda uma transação por vez e não mostra isso; o checklist confere o SQL de forma estática.',
      code: `// leitura e gravação separadas: duas requisições passam juntas
const [c] = await tx.query('SELECT saldo_centavos FROM contas WHERE id = $1', [id])
if (c.saldo_centavos >= valor) await tx.query('UPDATE contas SET saldo_centavos = saldo_centavos - $1 WHERE id = $2', [valor, id])`,
    },
    {
      id: 'update-condicional', url: 'https://www.postgresql.org/docs/current/sql-update.html',
      title: 'UPDATE condicional',
      text: 'Ponha a conferência no próprio UPDATE: o banco confere e grava num comando só. RETURNING vazio significa que nenhuma linha mudou.',
      code: `const [conta] = await tx.query(
  'UPDATE contas SET saldo_centavos = saldo_centavos - $1 WHERE id = $2 AND saldo_centavos >= $1 RETURNING saldo_centavos',
  [valor, id],
)
if (!conta) { /* a conta não existe ou o saldo não bastou */ }`,
    },
    {
      id: 'for-update-ordem', url: 'https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS',
      title: 'FOR UPDATE e a ordem dos locks',
      text: 'FOR UPDATE trava as linhas até o fim da transação. Duas transações que travam as mesmas linhas em ordens diferentes podem esperar uma pela outra (deadlock); travar sempre em ordem de id evita isso.',
      code: `await tx.query('SELECT id FROM contas WHERE id = ANY($1) ORDER BY id FOR UPDATE', [[de, para]])`,
    },
    {
      id: 'idempotencia', url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Idempotency-Key',
      title: 'Idempotência e Idempotency-Key',
      text: 'Uma operação idempotente repetida tem o mesmo efeito de uma vez. O cliente manda uma chave única no cabeçalho Idempotency-Key: mesma chave e mesmo corpo devolvem a resposta original, mesma chave com corpo diferente é 422.',
      code: `POST /pagamentos
Idempotency-Key: pedido-42

{ "valor_centavos": 1500 }`,
    },
    {
      id: 'indice-prefixo', url: 'https://www.postgresql.org/docs/current/indexes-opclass.html',
      title: 'Índice para busca por prefixo',
      text: 'LIKE sobre uma expressão sem índice lê a tabela inteira. Um índice na mesma expressão, com text_pattern_ops, deixa o LIKE de prefixo virar uma busca por intervalo. Busca no meio do texto (%x%) não usa esse índice.',
      code: `CREATE INDEX produtos_nome_idx ON produtos (lower(nome) text_pattern_ops);

SELECT id, nome FROM produtos WHERE lower(nome) LIKE $1 ORDER BY lower(nome) LIMIT 20`,
    },
    {
      id: 'like-prefixo', url: 'https://www.postgresql.org/docs/current/functions-matching.html#FUNCTIONS-LIKE',
      title: 'LIKE: escapar % e _',
      text: 'Em LIKE, % e _ são curingas. Para tratar a entrada como texto, ponha uma barra invertida antes da própria barra, de % e de _; depois acrescente o % final, o único curinga que você quer.',
      code: `const prefixo = termo.trim().toLowerCase().replace(/[\\\\%_]/g, '\\\\$&') + '%'`,
    },
  ],
}

/** What the E-commerce stages after Health teach: plain TypeScript, SQL and zod, the same in both frameworks. */
const PROJETO_DOCS: DocSection[] = [
  {
    title: 'API: status e ids',
    entries: [
      {
        id: 'status-http', url: 'https://developer.mozilla.org/pt-BR/docs/Web/HTTP/Reference/Status', title: 'Status HTTP da API',
        text: 'O número diz o resultado. 2xx deu certo, 4xx o cliente errou, 5xx o servidor errou.',
        code: String.raw`200 OK              leu ou atualizou, com corpo
201 Created         criou; o cabeçalho Location diz onde o recurso está
204 No Content      apagou; não leva corpo
400 Bad Request     a entrada tem forma errada (validação)
401 Unauthorized    não sei quem é você (sem token, token inválido ou vencido)
403 Forbidden       sei quem é, mas não pode (papel errado)
404 Not Found       o recurso não existe
409 Conflict        bate com algo que já existe (e-mail repetido)
422 Unprocessable   a forma está certa, mas não dá para processar (produto inexistente)`,
      },
      {
        id: 'achado-404', url: 'https://developer.mozilla.org/pt-BR/docs/Web/HTTP/Reference/Status/404', title: 'Id inexistente vira 404',
        text: 'O id da URL chega como texto, e uma consulta sem linha dá undefined. Duas funções pequenas lançam o 404 uma vez só, e o app.onError (ou o catch) responde.',
        code: String.raw`export function idDe(texto: string): number {
  const id = Number(texto) // Number('abc') é NaN
  if (!Number.isInteger(id)) throw new ErroHttp(404, 'Recurso não encontrado')
  return id
}

export function achado<T>(valor: T | undefined, nome: string): T {
  if (valor === undefined) throw new ErroHttp(404, nome + ' não encontrado')
  return valor
}`,
      },
    ],
  },
  {
    title: 'SQL e migrações',
    entries: [
      {
        id: 'db-camada', title: 'Rotas e SQL em arquivos separados',
        text: 'A rota cuida de HTTP (ler a requisição, escolher o status); o SQL fica em funções de src/db/, que recebem o db. A rota fica curta e o banco, fácil de testar.',
        code: String.raw`// src/db/categorias.ts: só SQL
export async function buscarCategoria(db: Db, id: number) { … }

// src/routes/categorias.ts: só HTTP
const categoria = achado(await buscarCategoria(c.env.db, idDe(id)), 'Categoria')`,
      },
      {
        id: 'db-colunas', url: 'https://www.postgresql.org/docs/current/sql-select.html', title: 'SELECT com colunas por nome',
        text: 'SELECT * devolve toda coluna, inclusive as que você adicionar depois (uma senha, por exemplo). Liste as colunas que a resposta precisa.',
        code: String.raw`'SELECT id, nome, preco_centavos FROM produtos WHERE id = $1'`,
      },
      {
        id: 'migracao-sql', url: 'https://www.postgresql.org/docs/current/ddl-constraints.html', title: 'CREATE TABLE e chave estrangeira',
        text: 'Uma migração é um arquivo SQL em migrations/, aplicado na aba Banco. REFERENCES liga uma coluna à chave de outra tabela: o banco recusa um valor que não existe lá. CHECK e UNIQUE fazem o banco recusar dados ruins.',
        code: String.raw`CREATE TABLE itens (
  id serial PRIMARY KEY,
  pedido_id int NOT NULL REFERENCES pedidos (id), -- precisa existir em pedidos
  quantidade int NOT NULL CHECK (quantidade > 0), -- nunca 0 nem negativo
  codigo text NOT NULL UNIQUE                     -- nunca repetido
);`,
      },
      {
        id: 'on-conflict', url: 'https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT', title: 'ON CONFLICT DO NOTHING',
        text: 'Se o INSERT violaria um UNIQUE, em vez de erro ele é ignorado e RETURNING devolve nada: a função devolve undefined e a rota responde 409. É mais seguro que um SELECT antes, que duas requisições simultâneas atravessam juntas.',
        code: String.raw`const [novo] = await db.query(
  'INSERT INTO membros (email) VALUES ($1) ON CONFLICT (email) DO NOTHING RETURNING id, email',
  [email],
)
if (!novo) throw new ErroHttp(409, 'E-mail já cadastrado')`,
      },
      {
        id: 'paginacao-cursor', title: 'Paginação por cursor',
        text: 'O cliente guarda o id do último item que viu e pede os seguintes. Leia uma linha a mais que o limite: se ela vier, há próxima página. Limite o tamanho máximo no módulo do banco.',
        code: String.raw`const limite = Math.min(pedido, 50) // teto
const linhas = await db.query('SELECT id, texto FROM comentarios WHERE id > $1 ORDER BY id LIMIT $2', [cursor, limite + 1])
const itens = linhas.slice(0, limite)
const proximoCursor = linhas.length > limite ? itens[limite - 1].id : null`,
      },
      {
        id: 'filtro-opcional', title: 'Filtro opcional numa consulta só',
        text: 'Cada filtro é (parâmetro IS NULL OR condição): com null, vale tudo; com valor, filtra. Assim a consulta é uma só, com ou sem filtros.',
        code: String.raw`'SELECT id, texto FROM comentarios WHERE ($1::text IS NULL OR autor ILIKE $1) ORDER BY id'
// params: [autor ? '%' + autor + '%' : null]`,
      },
    ],
  },
  {
    title: 'Validação com zod',
    entries: [
      {
        id: 'zod-schema', url: 'https://zod.dev/api#objects', title: 'z.object: a forma da entrada',
        text: 'zod confere em tempo de execução se um dado tem a forma esperada. Cada campo é um tipo com regras encadeadas.',
        code: String.raw`import { z } from 'zod'

const categoriaSchema = z.object({
  nome: z.string().min(1),
  ordem: z.number().int().min(0),
  tags: z.array(z.string()).min(1),
})`,
      },
      {
        id: 'zod-safeparse', url: 'https://zod.dev/basics#parsing-data', title: 'safeParse',
        text: 'Não lança: devolve { success: true, data } ou { success: false, error }. Os problemas estão em error.issues, cada um com path (onde) e message (o quê).',
        code: String.raw`const r = categoriaSchema.safeParse(dados)
if (!r.success) console.log(r.error.issues) // [{ path: ['nome'], message: '…' }]
else console.log(r.data)                    // já com o tipo do schema`,
      },
      {
        id: 'zod-coerce', url: 'https://zod.dev/api#coercion', title: 'z.coerce: texto vira número',
        text: 'Tudo que vem na URL é texto. z.coerce.number() converte antes de validar; default dá o valor quando o parâmetro não veio.',
        code: String.raw`const paginaSchema = z.object({
  pagina: z.coerce.number().int().min(1).default(1), // '2' vira 2; ausente vira 1
  busca: z.string().optional(),
})
paginaSchema.parse(Object.fromEntries(new URL(req.url).searchParams))`,
      },
    ],
  },
  {
    title: 'Senhas e tokens',
    entries: [
      {
        id: 'auth-401-403', url: 'https://developer.mozilla.org/pt-BR/docs/Web/HTTP/Reference/Status/401', title: '401 e 403',
        text: 'Autenticação responde "quem é você?"; autorização, "o que você pode?". 401: sem token, token inválido ou vencido. 403: token válido, mas o papel não pode.',
        code: String.raw`if (!token) throw new ErroHttp(401, 'Não autenticado')
if (sessao.papel !== 'admin') throw new ErroHttp(403, 'Sem permissão')`,
      },
      {
        id: 'hash-senha', title: 'Hash de senha com sal',
        text: 'Um hash é uma conta de mão única: confere a senha, mas não a recupera. O sal aleatório por usuário faz senhas iguais terem hashes diferentes. Use um algoritmo lento, como PBKDF2, para dificultar a força bruta.',
        code: String.raw`const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits'])
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: 100_000 }, chave, 256)`,
      },
      {
        id: 'token-assinado', title: 'Token assinado',
        text: 'dados.assinatura: os dados (quem é, validade) em base64 e o HMAC deles com um segredo só do servidor. Quem altera os dados não sabe refazer a assinatura. Para conferir, refaça a assinatura e compare; depois confira a validade.',
        code: String.raw`const dados = btoa(JSON.stringify({ sub: 1, exp: Date.now() + 3_600_000 }))
const token = dados + '.' + (await assinar(dados)) // enviado em Authorization: Bearer <token>`,
      },
    ],
  },
]

/** The reference beside the editor: the framework's sections, the API's errors, then the Env. */
export const docsFor = (framework: Framework): DocSection[] => [...(framework === 'hono' ? HONO : FETCH), ERROS_DOCS, ENV_DOCS, ...PROJETO_DOCS]
