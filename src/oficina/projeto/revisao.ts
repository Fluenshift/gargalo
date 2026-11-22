// Code review: a ready-made project with four planted bugs (SQL injection, race condition, field leakage, N+1).
// The player finds and fixes them; `revisaoStage` proves each one with a test, `judgeRevisao` names which are still there.

import type { TestCase, TestResult } from '../exercise'
import type { Project } from './project'
import type { ProjectCourse, Stage } from './stage'

const MIGRATION = `CREATE TABLE usuarios (id serial PRIMARY KEY, nome text NOT NULL, email text NOT NULL, senha_hash text NOT NULL);
CREATE TABLE produtos (id serial PRIMARY KEY, nome text NOT NULL, estoque int NOT NULL CHECK (estoque >= 0));
CREATE TABLE compras (id serial PRIMARY KEY, produto_id int NOT NULL REFERENCES produtos (id));
CREATE TABLE pedidos (id serial PRIMARY KEY, cliente text NOT NULL);
CREATE TABLE itens (id serial PRIMARY KEY, pedido_id int NOT NULL REFERENCES pedidos (id), produto text NOT NULL, qtd int NOT NULL);
`

const SEED = `INSERT INTO usuarios (nome, email, senha_hash) VALUES ('Ana', 'ana@exemplo.com', 'h1'), ('Beto', 'beto@exemplo.com', 'h2');
INSERT INTO produtos (nome, estoque) VALUES ('Caneta', 1);
INSERT INTO pedidos (cliente) VALUES ('Ana'), ('Beto'), ('Ana'), ('Beto');
INSERT INTO itens (pedido_id, produto, qtd) VALUES (1, 'Caneta', 2), (1, 'Lápis', 1), (2, 'Caneta', 1), (3, 'Lápis', 4), (4, 'Caneta', 3);
`

const CONFLICT = "Response.json({ type: 'about:blank', title: 'Sem estoque', status: 409 }, { status: 409, headers: { 'Content-Type': 'application/problem+json' } })"

/** The four route bodies are the only difference between the buggy project and its fix. */
export const revisaoRoutes = (usuarios: string, busca: string, comprar: string, pedidos: string) => `export default {
  async fetch(req: Request, env: any): Promise<Response> {
    const url = new URL(req.url)
    const parts = url.pathname.split('/').filter(Boolean)

    if (req.method === 'GET' && url.pathname === '/usuarios') {
${usuarios}
    }

    if (req.method === 'GET' && url.pathname === '/usuarios/busca') {
${busca}
    }

    if (req.method === 'POST' && parts[0] === 'produtos' && parts[2] === 'comprar') {
      const id = Number(parts[1])
${comprar}
    }

    if (req.method === 'GET' && url.pathname === '/pedidos') {
${pedidos}
    }

    return new Response(null, { status: 404 })
  },
}
`

export const BUGGY_BLOCKS = [
  "      return Response.json(await env.db.query('SELECT * FROM usuarios ORDER BY id'))",
  `      const nome = url.searchParams.get('nome') ?? ''
      return Response.json(await env.db.query("SELECT id, nome, email FROM usuarios WHERE nome = '" + nome + "'"))`,
  `      const [produto] = await env.db.query('SELECT estoque FROM produtos WHERE id = $1', [id])
      if (!produto || produto.estoque < 1) return ${CONFLICT}
      await env.db.query('UPDATE produtos SET estoque = $1 WHERE id = $2', [produto.estoque - 1, id])
      await env.db.query('INSERT INTO compras (produto_id) VALUES ($1)', [id])
      return Response.json({ ok: true }, { status: 201 })`,
  `      const pedidos = await env.db.query('SELECT id, cliente FROM pedidos ORDER BY id')
      for (const pedido of pedidos) {
        pedido.itens = await env.db.query('SELECT produto, qtd FROM itens WHERE pedido_id = $1 ORDER BY id', [pedido.id])
      }
      return Response.json(pedidos)`,
] as const

export const FIXED_BLOCKS = [
  "      return Response.json(await env.db.query('SELECT id, nome, email FROM usuarios ORDER BY id'))",
  `      const nome = url.searchParams.get('nome') ?? ''
      return Response.json(await env.db.query('SELECT id, nome, email FROM usuarios WHERE nome = $1', [nome]))`,
  `      const comprou = await env.db.transaction(async (tx: any) => {
        const baixa = await tx.query('UPDATE produtos SET estoque = estoque - 1 WHERE id = $1 AND estoque > 0 RETURNING id', [id])
        if (!baixa.length) return false
        await tx.query('INSERT INTO compras (produto_id) VALUES ($1)', [id])
        return true
      })
      return comprou ? Response.json({ ok: true }, { status: 201 }) : ${CONFLICT}`,
  `      const pedidos = await env.db.query('SELECT id, cliente FROM pedidos ORDER BY id')
      const itens = await env.db.query('SELECT pedido_id, produto, qtd FROM itens WHERE pedido_id = ANY($1) ORDER BY id', [pedidos.map((p: any) => p.id)])
      return Response.json(pedidos.map((p: any) => ({ ...p, itens: itens.filter((i: any) => i.pedido_id === p.id).map(({ produto, qtd }: any) => ({ produto, qtd })) })))`,
] as const

/** The bugs, in the order the stage's tests prove them. `test` is the name of that test. */
export const REVISAO_BUGS = [
  { id: 'vazamento', title: 'Vazamento de campos', test: 'a lista de usuários não expõe senha_hash' },
  { id: 'sql-injection', title: 'SQL injection', test: 'a busca não deixa o nome virar SQL' },
  { id: 'corrida', title: 'Condição de corrida', test: 'duas compras do último item não vendem duas vezes' },
  { id: 'n-mais-um', title: 'N+1', test: 'os pedidos vêm com seus itens' },
] as const

export type RevisaoBugId = (typeof REVISAO_BUGS)[number]['id']

/** The leak and N+1 tests pass either way; what shows the bug is a `senha_hash` in the answer, and how many queries it took. */
export const REVISAO_MAX_QUERIES = 2

const tests: TestCase[] = [
  {
    name: REVISAO_BUGS[0].test,
    // Extra keys pass an `expect`, so the leak is judged in code from the captured answer (see judgeRevisao).
    requests: [{ request: { path: '/usuarios' }, expect: { status: 200 } }],
    capture: true,
  },
  {
    name: REVISAO_BUGS[1].test,
    requests: [{ request: { path: `/usuarios/busca?nome=${encodeURIComponent("x' OR '1'='1")}` }, expect: { status: 200, body: [] } }],
  },
  {
    name: REVISAO_BUGS[2].test,
    requests: [{ request: { method: 'POST', path: '/produtos/1/comprar' } }, { request: { method: 'POST', path: '/produtos/1/comprar' } }],
    db: { sql: 'SELECT count(*)::int AS n FROM compras', rows: [{ n: 1 }] },
  },
  {
    name: REVISAO_BUGS[3].test,
    requests: [
      {
        request: { path: '/pedidos' },
        expect: {
          status: 200,
          body: [
            { id: 1, cliente: 'Ana', itens: [{ produto: 'Caneta', qtd: 2 }, { produto: 'Lápis', qtd: 1 }] },
            { id: 2, cliente: 'Beto', itens: [{ produto: 'Caneta', qtd: 1 }] },
            { id: 3, cliente: 'Ana', itens: [{ produto: 'Lápis', qtd: 4 }] },
            { id: 4, cliente: 'Beto', itens: [{ produto: 'Caneta', qtd: 3 }] },
          ],
        },
      },
    ],
  },
]

const FIXED = revisaoRoutes(...FIXED_BLOCKS)

export const revisaoStage: Stage = {
  id: 'revisao',
  title: 'Revisão de código',
  statement:
    'Este projeto já funciona, mas tem quatro bugs plantados: um vazamento de campos, uma SQL injection, uma condição de corrida e um N+1. Leia o código, ache cada um e corrija sem mudar o que a API responde.',
  files: ['src/index.ts', 'migrations/001_init.sql'],
  tests,
  checklist: [{ id: 'sql-parametrizado' }, { id: 'sem-select-estrela' }, { id: 'sem-vazar-campos', requests: [{ path: '/usuarios' }], fields: ['senha_hash'] }],
  hints: [
    'Procure onde uma rota devolve linhas sem escolher as colunas, onde a entrada do usuário vira texto de SQL, onde o código lê e depois grava o mesmo dado e onde há uma consulta dentro de um laço.',
    'A lista de usuários usa SELECT *: liste as colunas. A busca concatena o nome no SQL: use $1 e passe o valor em params. A compra lê o estoque e grava depois: deixe o banco decidir com UPDATE ... WHERE estoque > 0 RETURNING.',
    'Em /pedidos, busque todos os itens de uma vez com WHERE pedido_id = ANY($1) e agrupe em memória. Faça a baixa do estoque e o registro da compra na mesma transação.',
  ],
  explanation:
    'Os quatro bugs passam em teste de caminho feliz. Quem escolhe as colunas escolhe o que sai; entrada do usuário nunca vira SQL, só parâmetro; ler e depois gravar precisa ser uma operação atômica; e uma consulta por linha vira milhares sob carga.',
  reference: { hono: { 'src/index.ts': FIXED }, fetch: { 'src/index.ts': FIXED } },
  seed: SEED,
}

export const revisaoCourse: ProjectCourse = { id: 'revisao', title: 'Revisão de código', stages: [revisaoStage] }

/** The buggy project the player starts from; register it in the Projetos screen as the starter of `revisaoCourse`. */
export const revisaoStarter: Project = {
  id: 'revisao',
  framework: 'fetch',
  files: { 'src/index.ts': revisaoRoutes(...BUGGY_BLOCKS), 'migrations/001_init.sql': MIGRATION },
}

export interface BugVerdict {
  id: RevisaoBugId
  title: string
  /** True when the bug is gone. */
  fixed: boolean
}

/** Which bugs are fixed, from the results of `revisaoStage.tests` run through `runTests`/`runStage` (the N+1 one reads their metrics). */
export function judgeRevisao(results: TestResult[]): BugVerdict[] {
  return REVISAO_BUGS.map((bug, i) => {
    const r = results[i]
    const leaks = bug.id === 'vazamento' && JSON.stringify(r?.responses?.[0]?.body ?? 'senha_hash').includes('senha_hash')
    const slow = bug.id === 'n-mais-um' && (r?.metrics?.[0]?.queries ?? Infinity) > REVISAO_MAX_QUERIES
    return { id: bug.id, title: bug.title, fixed: !!r?.passed && !leaks && !slow }
  })
}
