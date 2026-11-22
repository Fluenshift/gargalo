import type { TestCase } from '../exercise'
import type { OficinaExercise } from '../exercises'
import { STARTUP_SCHEMA, cadastro } from './cadastro'

const TOTAL = 20_000
const pessoa = (id: number) => ({ id, nome: `Pessoa ${id}`, email: `pessoa${id}@exemplo.com` })
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => pessoa(from + i))
const cursor = (id: number) => encodeURIComponent(btoa(String(id)))
const page = (name: string, query: string, usuarios: ReturnType<typeof pessoa>[], proximo: string | null): TestCase => ({
  name,
  requests: [{ request: { path: `/usuarios${query}` }, expect: { status: 200, body: { usuarios, proximo } } }],
})

const LISTAR = `
async function listar(req: Request, ctx: Ctx): Promise<Response> {
  const params = new URL(req.url).searchParams
  const limite = Number(params.get('limite') ?? 20)
  if (!Number.isInteger(limite) || limite < 1 || limite > 100) return Response.json({ erro: 'O limite vai de 1 a 100.' }, { status: 400 })
  let depois = 0
  const cursor = params.get('cursor')
  if (cursor) {
    try {
      depois = Number(atob(cursor))
    } catch {
      depois = NaN
    }
    if (!Number.isInteger(depois)) return Response.json({ erro: 'Cursor inválido.' }, { status: 400 })
  }
  // Uma linha além da página diz se há próxima. WHERE id > cursor desce pelo índice da chave e lê só a página.
  const linhas = await ctx.db.query<{ id: number; nome: string; email: string }>(
    'SELECT id, nome, email FROM usuarios WHERE id > $1 ORDER BY id LIMIT $2',
    [depois, limite + 1],
  )
  const usuarios = linhas.slice(0, limite)
  const proximo = linhas.length > limite ? btoa(String(usuarios[usuarios.length - 1].id)) : null
  return Response.json({ usuarios, proximo })
}
`

const NOT_FOUND = "  return Response.json({ erro: 'Rota não encontrada.' }, { status: 404 })"
const withList = (code: string) => code.replace(NOT_FOUND, `  if (req.method === 'GET') return listar(req, ctx)\n${NOT_FOUND}`)

export const paginacao: OficinaExercise = {
  id: 'paginacao',
  company: 'Startup',
  title: 'GET /usuarios: paginação por cursor',
  statement:
    'A Startup passou de 20 mil usuários e a lista do painel precisa vir em páginas. Em GET /usuarios?limite=&cursor=, responda 200 com { "usuarios": [{ id, nome, email }], "proximo" }, em ordem de id. ' +
    'O limite vai de 1 a 100 (padrão 20); fora disso, 400 com { "erro": "O limite vai de 1 a 100." }. ' +
    'O cursor é o id do último usuário da página, em base64 (btoa): quem chama só o devolve em ?cursor= para pegar a página seguinte. Na última página, proximo é null. Cursor que não decodifica para um id responde 400 com { "erro": "Cursor inválido." }. ' +
    'O POST /usuarios do exercício anterior continua valendo.',
  schema: STARTUP_SCHEMA,
  // Inserted out of id order, so a list without ORDER BY comes back shuffled.
  seed: `INSERT INTO usuarios (id, nome, email)
  SELECT i, 'Pessoa ' || i, 'pessoa' || i || '@exemplo.com' FROM generate_series(1, ${TOTAL}) i ORDER BY (i * 7919) % ${TOTAL};
SELECT setval('usuarios_id_seq', ${TOTAL});`,
  starter: cadastro.reference,
  visible: [
    page('primeira página', '?limite=3', range(1, 3), btoa('3')),
    page('segue do cursor', `?limite=3&cursor=${cursor(3)}`, range(4, 6), btoa('6')),
    page('última página tem proximo null', `?limite=5&cursor=${cursor(TOTAL - 2)}`, range(TOTAL - 1, TOTAL), null),
  ],
  hidden: [
    page('limite padrão é 20', '', range(1, 20), btoa('20')),
    page('página funda', `?limite=2&cursor=${cursor(15_000)}`, range(15_001, 15_002), btoa('15002')),
    page('página que termina bem no fim', `?limite=3&cursor=${cursor(TOTAL - 3)}`, range(TOTAL - 2, TOTAL), null),
    page('página no fim, de novo', `?limite=10&cursor=${cursor(TOTAL - 10)}`, range(TOTAL - 9, TOTAL), null),
    { name: 'limite fora da faixa', requests: [{ request: { path: '/usuarios?limite=500' }, expect: { status: 400, body: { erro: 'O limite vai de 1 a 100.' } } }] },
    { name: 'cursor inválido', requests: [{ request: { path: '/usuarios?cursor=abc' }, expect: { status: 400, body: { erro: 'Cursor inválido.' } } }] },
    {
      name: 'o cadastro continua funcionando',
      requests: [{ request: { method: 'POST', path: '/usuarios', body: { nome: 'Ana', email: 'ana@exemplo.com' } }, expect: { status: 201, headers: { location: `/usuarios/${TOTAL + 1}` } } }],
    },
  ],
  hints: [
    'OFFSET 15000 parece pular linhas, mas o banco lê as 15 mil e joga fora: quanto mais funda a página, mais cara. Paginação por chave pede as linhas depois da última que você mandou.',
    'Guarde no cursor o id do último usuário e busque WHERE id > $1 ORDER BY id LIMIT $2: o índice da chave primária vai direto ao ponto. Para saber se há próxima página, peça uma linha a mais que o limite.',
    "SELECT id, nome, email FROM usuarios WHERE id > $1 ORDER BY id LIMIT $2, com [Number(atob(cursor)), limite + 1]. proximo = linhas.length > limite ? btoa(String(ultimo.id)) : null.",
  ],
  reference: withList(cadastro.reference) + LISTAR,
  // OFFSET with the page's position as the cursor: the same answers, but a deep page reads every row before it.
  naive: withList(cadastro.reference) + LISTAR.replace(
    `  // Uma linha além da página diz se há próxima. WHERE id > cursor desce pelo índice da chave e lê só a página.
  const linhas = await ctx.db.query<{ id: number; nome: string; email: string }>(
    'SELECT id, nome, email FROM usuarios WHERE id > $1 ORDER BY id LIMIT $2',
    [depois, limite + 1],
  )`,
    `  const linhas = await ctx.db.query<{ id: number; nome: string; email: string }>(
    'SELECT id, nome, email FROM usuarios ORDER BY id LIMIT $1 OFFSET $2',
    [limite + 1, depois],
  )`,
  ),
  explanation:
    'WHERE id > $1 ORDER BY id LIMIT $2 desce pelo índice da chave primária até o cursor e lê só as linhas da página, seja a primeira ou a milésima. Com OFFSET, a resposta é a mesma, mas o banco lê e descarta todas as linhas antes da página: na página 750, são 15 mil linhas para entregar 20. ' +
    'Pedir uma linha a mais que o limite diz se há próxima página sem um COUNT(*). O cursor em base64 é opaco para quem chama, então dá para trocar a chave depois sem quebrar ninguém. ' +
    'O custo: não dá para pular direto para a página 40, só seguir de uma para a próxima, e a ordem precisa ser por uma chave única (aqui, id).',
  // At 150 req/s the reference answers in ~145 ms p99 (under 190 ms even with a 50 ms handler); see exercises.test.ts.
  load: { rps: 150, p99Ms: 200, queriesPerRequest: 1 },
}
