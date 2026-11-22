import type { OficinaExercise } from '../exercises'
import { ECOMMERCE_SCHEMA, ECOMMERCE_SEED, PEDIDO_REFERENCE, PRODUTOS, produto } from './pedido'

/** What the search should answer: up to 20 products whose lowercased name starts with `busca`, in that order (the database collates as C, by code point). */
const found = (busca: string) => {
  const all = Array.from({ length: PRODUTOS }, (_, i) => produto(i + 1)).filter((p) => p.nome.toLowerCase().startsWith(busca.toLowerCase()))
  return all.sort((a, b) => (a.nome.toLowerCase() < b.nome.toLowerCase() ? -1 : 1)).slice(0, 20)
}
const search = (name: string, busca: string) => ({
  name,
  requests: [{ request: { path: `/produtos?busca=${encodeURIComponent(busca)}` }, expect: { status: 200, body: { produtos: found(busca) } } }],
})

const BUSCAR = `
async function buscarProdutos(busca: string, ctx: Ctx): Promise<Response> {
  if (!busca.trim()) return Response.json({ erro: 'Informe o que buscar em ?busca=.' }, { status: 400 })
  // % e _ são curingas do LIKE: escapados, a busca "50%" procura o texto "50%".
  const prefixo = busca.trim().toLowerCase().replace(/[\\\\%_]/g, '\\\\$&') + '%'
  const produtos = await ctx.db.query(
    'SELECT id, nome, preco_centavos FROM produtos WHERE lower(nome) LIKE $1 ORDER BY lower(nome) LIMIT 20',
    [prefixo],
  )
  return Response.json({ produtos })
}
`

const NOT_FOUND = "  return Response.json({ erro: 'Rota não encontrada.' }, { status: 404 })"
const ROUTE = "  if (url.pathname === '/produtos') return buscarProdutos(url.searchParams.get('busca') ?? '', ctx)"
const MIGRATION = `// Roda uma vez antes de cada teste, depois dos dados, como uma migration no deploy.
export const migration = 'CREATE INDEX produtos_nome_idx ON produtos (lower(nome))'

`
const withSearch = PEDIDO_REFERENCE.replace(NOT_FOUND, `${ROUTE}\n${NOT_FOUND}`) + BUSCAR

export const busca: OficinaExercise = {
  id: 'busca',
  company: 'E-commerce',
  title: 'GET /produtos?busca=: busca lenta',
  statement:
    'A busca do E-commerce varre 20 mil produtos a cada letra digitada. Em GET /produtos?busca=, responda 200 com { "produtos": [{ id, nome, preco_centavos }] }: até 20 produtos cujo nome começa com a busca, sem diferenciar maiúsculas, em ordem alfabética do nome em minúsculas. ' +
    '% e _ na busca valem como texto, não como curinga. Busca vazia responde 400 com { "erro": "Informe o que buscar em ?busca=." }. ' +
    'Para criar um índice, exporte do mesmo arquivo export const migration = \'CREATE INDEX ...\': ela roda antes de cada teste, depois dos dados, como uma migration no deploy. O GET /pedidos/<id> do exercício anterior continua valendo.',
  schema: ECOMMERCE_SCHEMA,
  seed: ECOMMERCE_SEED,
  starter: PEDIDO_REFERENCE,
  visible: [
    search('acha pelo começo do nome', 'tecl'),
    search('não diferencia maiúsculas', 'FONE'),
    { name: 'busca vazia', requests: [{ request: { path: '/produtos?busca=' }, expect: { status: 400, body: { erro: 'Informe o que buscar em ?busca=.' } } }] },
  ],
  hidden: [
    search('devolve no máximo 20, em ordem', 'vela verde 1'),
    search('acha um só', 'tela 24'),
    search('nada encontrado', 'xícara'),
    search('% é texto, não curinga', '%'),
    search('_ é texto, não curinga', 'c_neca'),
    { name: 'sem o parâmetro busca', requests: [{ request: { path: '/produtos' }, expect: { status: 400, body: { erro: 'Informe o que buscar em ?busca=.' } } }] },
  ],
  hints: [
    "Sem índice, WHERE lower(nome) LIKE 'cane%' lê as 20 mil linhas para achar as que servem. Veja o número de linhas lidas de cada teste. Um índice leva o banco direto ao começo do nome.",
    "O índice precisa ser sobre a mesma expressão da consulta: lower(nome). Uma busca por prefixo (LIKE 'x%') usa o índice; '%x%' não. Crie o índice em export const migration.",
    "export const migration = 'CREATE INDEX produtos_nome_idx ON produtos (lower(nome))', e na consulta: WHERE lower(nome) LIKE $1 ORDER BY lower(nome) LIMIT 20, com $1 = prefixo + '%'.",
  ],
  reference: MIGRATION + withSearch,
  // The same query, without the index: right answers, every row read.
  naive: withSearch,
  explanation:
    "O índice em lower(nome) guarda os nomes em minúsculas já ordenados: LIKE 'tecl%' vira um intervalo (de 'tecl' até 'tecm') e o banco lê só as linhas dele. Como ORDER BY lower(nome) é a ordem do próprio índice, com LIMIT 20 ele para na vigésima, sem ordenar nada. Sem o índice, cada busca lê as 20 mil linhas. " +
    "Confira com EXPLAIN: Index Scan using produtos_nome_idx em vez de Seq Scan. Num banco com collation que não seja C, o índice para LIKE precisa de text_pattern_ops. " +
    "O custo: cada INSERT e UPDATE de produto também atualiza o índice, e ele só serve para prefixo. Busca no meio do nome ('%azul%') pede outro tipo de índice (trigramas) ou um serviço de busca.",
  // At 150 req/s the reference answers in ~145 ms p99 (under 190 ms even with a 50 ms handler); see exercises.test.ts.
  load: { rps: 150, p99Ms: 200, queriesPerRequest: 1 },
}
