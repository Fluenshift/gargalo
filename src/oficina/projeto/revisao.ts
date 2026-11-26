// Code review: a ready-made project with four planted bugs (SQL injection, race condition, field leakage, N+1).
// The player finds and fixes them; `revisaoStage` proves each one with a test, `judgeRevisao` names which are still there.

import type { TestCase, TestResult } from '../exercise'
import type { Project } from './project'
import { stepTest, type GuidedStep, type ProjectCourse, type RequestCheck, type Stage, type StepCheck } from './stage'

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

const CONFLICT =
  "Response.json({ type: 'about:blank', title: 'Sem estoque', status: 409 }, { status: 409, headers: { 'Content-Type': 'application/problem+json' } })"

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

/** GET /pedidos once the N+1 is gone: the orders, then the items of all of them at once. */
export const REVISAO_MAX_QUERIES = 2

/** The bugs, in the order the stage's tests prove them. `test` is the name of that test. */
export const REVISAO_BUGS = [
  { id: 'vazamento', title: 'Vazamento de campos', test: 'a lista de usuários não expõe senha_hash' },
  { id: 'sql-injection', title: 'SQL injection', test: 'a busca não deixa o nome virar SQL' },
  { id: 'corrida', title: 'Condição de corrida', test: 'duas compras do último item não vendem duas vezes' },
  { id: 'n-mais-um', title: 'N+1', test: `os pedidos vêm com seus itens em até ${REVISAO_MAX_QUERIES} consultas` },
] as const

export type RevisaoBugId = (typeof REVISAO_BUGS)[number]['id']

const INJECAO = `/usuarios/busca?nome=${encodeURIComponent("x' OR '1'='1")}`

const PEDIDOS_COM_ITENS = [
  {
    id: 1,
    cliente: 'Ana',
    itens: [
      { produto: 'Caneta', qtd: 2 },
      { produto: 'Lápis', qtd: 1 },
    ],
  },
  { id: 2, cliente: 'Beto', itens: [{ produto: 'Caneta', qtd: 1 }] },
  { id: 3, cliente: 'Ana', itens: [{ produto: 'Lápis', qtd: 4 }] },
  { id: 4, cliente: 'Beto', itens: [{ produto: 'Caneta', qtd: 3 }] },
]

/**
 * What shows each bug fixed: the "Conferir passo" of the step that fixes it. The race needs two purchases at once, which one
 * request can't send, so its step reads the file and the stage's own test proves it; the other three are also the stage's tests.
 */
export const REVISAO_FIX_CHECKS = {
  vazamento: { kind: 'request', path: '/usuarios', status: 200, absent: ['senha_hash'] },
  'sql-injection': { kind: 'request', path: INJECAO, status: 200, body: [] },
  corrida: { kind: 'file', path: 'src/index.ts', contains: ['RETURNING'] },
  'n-mais-um': { kind: 'request', path: '/pedidos', status: 200, body: PEDIDOS_COM_ITENS, maxQueries: REVISAO_MAX_QUERIES },
} satisfies Record<RevisaoBugId, StepCheck>

const bugTest = (check: RequestCheck, name: string): TestCase => ({ ...stepTest(check), name })

const tests: TestCase[] = [
  bugTest(REVISAO_FIX_CHECKS.vazamento, REVISAO_BUGS[0].test),
  bugTest(REVISAO_FIX_CHECKS['sql-injection'], REVISAO_BUGS[1].test),
  {
    name: REVISAO_BUGS[2].test,
    requests: [{ request: { method: 'POST', path: '/produtos/1/comprar' } }, { request: { method: 'POST', path: '/produtos/1/comprar' } }],
    db: { sql: 'SELECT count(*)::int AS n FROM compras', rows: [{ n: 1 }] },
  },
  bugTest(REVISAO_FIX_CHECKS['n-mais-um'], REVISAO_BUGS[3].test),
]

const FIXED = revisaoRoutes(...FIXED_BLOCKS)

// --- Guided steps (issue #138): each bug is an investigation, from the easiest to the hardest. The course fixes fetch puro. ---

const PASSOS_REVISAO: GuidedStep[] = [
  {
    title: 'Vazamento: veja o que a rota devolve',
    do: 'Clique em Testar agora e olhe a resposta de GET /usuarios: repare no campo que não deveria estar ali.',
    learn:
      'Revisar começa por reproduzir: antes de mexer no código, veja o bug acontecer. Clique em Testar agora e leia o corpo da resposta de GET /usuarios, campo por campo. Uma rota que devolve linhas sem escolher as colunas entrega tudo que a tabela tem, inclusive o que ninguém deveria ver.',
    check: { kind: 'request', path: '/usuarios', status: 200 },
  },
  {
    title: 'Vazamento: escolha as colunas',
    do: 'Em src/index.ts, troque o SELECT * de /usuarios pelas colunas id, nome e email. Depois clique em Testar agora.',
    learn:
      'SELECT * devolve toda coluna da tabela, e quando alguém acrescentar uma coluna sensível amanhã ela vaza sozinha. Listar as [colunas](select-colunas) faz da consulta uma lista do que pode sair. Depois de corrigir, clique em Testar agora e confira que o campo sumiu.',
    file: 'src/index.ts',
    example: {
      file: 'modelo',
      code: String.raw`// Antes: devolve tudo, até a coluna cpf.
//   await env.db.query('SELECT * FROM clientes ORDER BY id')

// Depois: só o que o cliente da API precisa ver.
return Response.json(await env.db.query('SELECT id, nome, cidade FROM clientes ORDER BY id'))`,
      note: 'No seu caso: a tabela é usuarios, e a coluna que não pode sair é senha_hash. Mantenha id, nome e email.',
    },
    docs: ['select-colunas'],
    check: REVISAO_FIX_CHECKS.vazamento,
  },
  {
    title: 'SQL injection: engane a busca',
    do: 'Clique em Testar agora: o nome enviado vira SQL e a busca devolve todos os usuários.',
    learn:
      'A busca monta o SQL juntando texto com o nome que veio na URL. Se o nome contiver aspas, quem pediu passa a escrever pedaço do seu SQL: é uma [SQL injection](sql-injecao). Clique em Testar agora: a busca por um nome que não existe devolve todos os usuários.',
    check: { kind: 'request', path: INJECAO, status: 200 },
  },
  {
    title: 'SQL injection: passe o nome como parâmetro',
    do: 'Em src/index.ts, troque a concatenação do nome por um parâmetro $1. Depois clique em Testar agora: a busca deve voltar vazia.',
    learn:
      'A defesa é nunca colar a entrada no texto do SQL. Escreva $1 onde o valor entra e passe o valor à parte, no segundo argumento de [db.query](db-query): o banco trata aquilo sempre como dado, nunca como comando.',
    file: 'src/index.ts',
    example: {
      file: 'modelo',
      code: String.raw`const cidade = url.searchParams.get('cidade') ?? ''

// Antes: a entrada vira parte do SQL.
//   "SELECT id, nome FROM clientes WHERE cidade = '" + cidade + "'"

// Depois: $1 marca o lugar e o valor vai em params.
return Response.json(await env.db.query('SELECT id, nome FROM clientes WHERE cidade = $1', [cidade]))`,
      note: 'No seu caso: a tabela é usuarios, o filtro é nome e o valor é a variável nome. Mantenha as colunas id, nome e email. Conferir passo repete o ataque do passo anterior: com o conserto, a busca devolve lista vazia.',
    },
    docs: ['sql-injecao', 'db-query'],
    check: REVISAO_FIX_CHECKS['sql-injection'],
  },
  {
    title: 'N+1: conte as consultas',
    do: 'Clique em Testar agora e veja quantas consultas GET /pedidos faz: uma por pedido, mais uma.',
    learn:
      'A lista de pedidos busca os itens de cada pedido com uma consulta dentro de um laço: com 4 pedidos são 5 consultas, com 1000 são 1001. É o [N+1](n-mais-um), e passa em teste de caminho feliz porque a resposta está certa. Clique em Testar agora e leia, junto da resposta, quantas consultas ela custou.',
    check: { kind: 'request', path: '/pedidos', status: 200 },
  },
  {
    title: 'N+1: busque todos os itens de uma vez',
    do: 'Em src/index.ts, busque os itens de todos os pedidos numa consulta só e agrupe por pedido_id. Depois clique em Testar agora: devem ser 2 consultas.',
    learn:
      'Troque as N consultas por uma só: peça os itens de todos os pedidos com WHERE coluna = ANY($1), passando a lista de ids, e agrupe o resultado em memória. Dá sempre 2 consultas, não importa quantos pedidos existam.',
    file: 'src/index.ts',
    example: {
      file: 'modelo',
      code: String.raw`const autores = await env.db.query('SELECT id, nome FROM autores ORDER BY id')

// Uma consulta para os livros de todos os autores da lista, não uma por autor.
// ANY($1) aceita um array: aqui, os ids dos autores.
const livros = await env.db.query('SELECT autor_id, titulo FROM livros WHERE autor_id = ANY($1)', [autores.map((a) => a.id)])

// Agrupe em memória: cada autor leva os seus livros.
return Response.json(autores.map((a) => ({ ...a, livros: livros.filter((l) => l.autor_id === a.id) })))`,
      note: 'No seu caso: pedidos e itens, ligados por pedido_id. A resposta mantém a forma { id, cliente, itens: [{ produto, qtd }] }, sem pedido_id dentro dos itens. Depois, clique em Testar agora: deve dizer 2 consultas.',
    },
    docs: ['n-mais-um', 'db-query'],
    check: REVISAO_FIX_CHECKS['n-mais-um'],
  },
  {
    title: 'Condição de corrida: ler, esperar, gravar',
    do: 'Clique em Testar agora e leia o código de /produtos/1/comprar: ele lê o estoque, espera e só então grava.',
    learn:
      'A compra lê o estoque, decide e só depois grava. Se duas compras do último item chegam juntas, as duas leem 1, as duas decidem vender e o item é vendido duas vezes. O Testar agora faz uma compra só e não mostra isso: o bug só aparece com dois pedidos ao mesmo tempo, e é o Rodar testes que os envia.',
    check: { kind: 'request', method: 'POST', path: '/produtos/1/comprar', status: 201 },
  },
  {
    title: 'Condição de corrida: deixe o banco decidir',
    do: 'Em src/index.ts, troque o ler-e-gravar por um UPDATE que só baixa o estoque se ele for maior que zero. Depois, rode os testes da etapa.',
    learn:
      'Em vez de ler e gravar, faça o banco conferir e gravar numa operação só: UPDATE ... WHERE condição RETURNING. Se a condição falhou, nenhuma linha volta e a compra é recusada. Registre a compra na mesma [transação](db-transaction), para a baixa e o registro andarem juntos.',
    file: 'src/index.ts',
    example: {
      file: 'modelo',
      code: String.raw`const reservou = await env.db.transaction(async (tx) => {
  // A condição e a baixa acontecem juntas, dentro do banco.
  // RETURNING devolve a linha alterada; se nada casou, volta uma lista vazia.
  const baixa = await tx.query('UPDATE ingressos SET vagas = vagas - 1 WHERE id = $1 AND vagas > 0 RETURNING id', [id])
  if (!baixa.length) return false // esgotou: nada foi gravado
  await tx.query('INSERT INTO reservas (ingresso_id) VALUES ($1)', [id])
  return true
})`,
      note: 'No seu caso: a tabela é produtos, a coluna é estoque, e o registro vai em compras (produto_id). Recusado, responda o 409 que a rota já devolve; aceito, o 201. Depois rode os testes da etapa: eles conferem os quatro bugs.',
    },
    docs: ['update-atomico', 'returning', 'db-transaction'],
    check: REVISAO_FIX_CHECKS.corrida,
  },
]

export const revisaoStage: Stage = {
  id: 'revisao',
  title: 'Revisão de código',
  statement:
    'Este projeto já funciona, mas tem quatro bugs plantados: um vazamento de campos, uma SQL injection, um N+1 e uma condição de corrida. Em cada um você reproduz, entende e corrige.',
  steps: PASSOS_REVISAO,
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
  bugs: judgeRevisao,
}

/** The buggy project the player starts from. */
export const revisaoStarter: Project = {
  id: 'revisao',
  framework: 'fetch',
  files: { 'src/index.ts': revisaoRoutes(...BUGGY_BLOCKS), 'migrations/001_init.sql': MIGRATION },
}

export const revisaoCourse: ProjectCourse = {
  id: 'revisao',
  title: 'Revisão de código',
  summary: 'Depois do básico: ache e corrija os problemas de uma API pronta, como vazamento de dados e N+1.',
  stages: [revisaoStage],
  starter: revisaoStarter,
}

export interface BugVerdict {
  id: RevisaoBugId
  title: string
  /** True when the bug is gone. */
  fixed: boolean
}

/** Which bugs are fixed: each one's test in `revisaoStage.tests` (same order) passed, from what `runTests`/`runStage` return. */
export function judgeRevisao(results: TestResult[]): BugVerdict[] {
  return REVISAO_BUGS.map((bug, i) => ({ id: bug.id, title: bug.title, fixed: !!results[i]?.passed }))
}
