import type { OficinaExercise } from '../exercises'

export const ECOMMERCE_SCHEMA = `CREATE TABLE produtos (id int PRIMARY KEY, nome text NOT NULL, preco_centavos int NOT NULL);
CREATE TABLE pedidos (id int PRIMARY KEY, cliente text NOT NULL);
CREATE TABLE itens (
  id serial PRIMARY KEY,
  pedido_id int NOT NULL REFERENCES pedidos,
  produto_id int NOT NULL REFERENCES produtos,
  quantidade int NOT NULL
);
CREATE INDEX itens_pedido_idx ON itens (pedido_id);`

export const PRODUTOS = 20_000
const WORDS = ['Camiseta', 'Caneca', 'Livro', 'Mochila', 'Garrafa', 'Caderno', 'Cabo', 'Capa', 'Tapete', 'Vela']
const COLORS = ['azul', 'verde', 'preta', 'branca', 'vermelha']
const FIXED: Record<number, [string, number]> = {
  1: ['Teclado mecânico', 34990],
  2: ['Teclado sem fio', 19990],
  3: ['Tela 24 polegadas', 89990],
  4: ['Fone de ouvido', 9990],
  5: ['Fone sem fio', 24990],
}

/** Product `id` as the seed makes it: five named ones, then generated names. */
export const produto = (id: number) => {
  const [nome, preco_centavos] = FIXED[id] ?? [`${WORDS[id % 10]} ${COLORS[Math.floor(id / 10) % 5]} ${id}`, 990 + (id % 50) * 100]
  return { id, nome, preco_centavos }
}

const sqlArray = (xs: string[]) => `ARRAY[${xs.map((x) => `'${x}'`).join(', ')}]`

export const ECOMMERCE_SEED = `INSERT INTO produtos VALUES ${Object.entries(FIXED).map(([id, [nome, preco]]) => `(${id}, '${nome}', ${preco})`).join(', ')};
INSERT INTO produtos
  SELECT i, (${sqlArray(WORDS)})[1 + i % 10] || ' ' || (${sqlArray(COLORS)})[1 + i / 10 % 5] || ' ' || i, 990 + i % 50 * 100
  FROM generate_series(6, ${PRODUTOS}) i;
INSERT INTO pedidos VALUES (1, 'Ana'), (2, 'Bruno'), (3, 'Carla');
INSERT INTO pedidos SELECT i, 'Cliente ' || i FROM generate_series(4, 2000) i;
INSERT INTO itens (pedido_id, produto_id, quantidade) VALUES (1, 1, 1), (1, 4, 2), (1, 100, 3);
INSERT INTO itens (pedido_id, produto_id, quantidade) SELECT 2, 1000 + k, 1 FROM generate_series(1, 20) k;
INSERT INTO itens (pedido_id, produto_id, quantidade)
  SELECT p, 6 + (p * 7 + k * 13) % ${PRODUTOS - 5}, 1 + k % 3 FROM generate_series(4, 2000) p, generate_series(1, 5) k;`

const item = (id: number, quantidade: number) => ({ produto: produto(id).nome, quantidade, preco_centavos: produto(id).preco_centavos })
const total = (itens: ReturnType<typeof item>[]) => itens.reduce((s, i) => s + i.quantidade * i.preco_centavos, 0)
const pedido1 = [item(1, 1), item(4, 2), item(100, 3)]
const pedido2 = Array.from({ length: 20 }, (_, k) => item(1001 + k, 1))
const get = (path: string) => ({ path })

export const PEDIDO_REFERENCE = `export default async function handler(req: Request, ctx: Ctx): Promise<Response> {
  const url = new URL(req.url)
  const pedido = /^\\/pedidos\\/(\\d+)$/.exec(url.pathname)
  if (pedido) return buscarPedido(Number(pedido[1]), ctx)
  return Response.json({ erro: 'Rota não encontrada.' }, { status: 404 })
}

async function buscarPedido(id: number, ctx: Ctx): Promise<Response> {
  const [pedido] = await ctx.db.query<{ id: number; cliente: string }>('SELECT id, cliente FROM pedidos WHERE id = $1', [id])
  if (!pedido) return Response.json({ erro: 'Pedido não encontrado.' }, { status: 404 })
  // Os itens e os nomes dos produtos numa consulta só, seja o pedido de 1 ou de 100 itens.
  const itens = await ctx.db.query<{ produto: string; quantidade: number; preco_centavos: number }>(
    \`SELECT p.nome AS produto, i.quantidade, p.preco_centavos
       FROM itens i JOIN produtos p ON p.id = i.produto_id
      WHERE i.pedido_id = $1
      ORDER BY i.id\`,
    [id],
  )
  const total_centavos = itens.reduce((soma, i) => soma + i.quantidade * i.preco_centavos, 0)
  return Response.json({ ...pedido, itens, total_centavos })
}
`

export const pedido: OficinaExercise = {
  id: 'pedido',
  company: 'E-commerce',
  title: 'GET /pedidos/:id: pedido com itens',
  statement:
    'A tela de um pedido do E-commerce está lenta em pedidos grandes. Em GET /pedidos/<id>, responda 200 com { id, cliente, itens, total_centavos }, em que cada item é { produto, quantidade, preco_centavos }: produto é o nome do produto, os itens vêm na ordem em que entraram no pedido (itens.id) e o total soma quantidade × preço. ' +
    'Pedido que não existe responde 404 com { "erro": "Pedido não encontrado." }. ' +
    'Tabelas: pedidos (id, cliente), itens (id, pedido_id, produto_id, quantidade) com índice em pedido_id, e produtos (id, nome, preco_centavos). Um pedido de 20 itens não pode custar 20 consultas.',
  schema: ECOMMERCE_SCHEMA,
  seed: ECOMMERCE_SEED,
  starter: `export default async function handler(req: Request, ctx: Ctx): Promise<Response> {
  const id = Number(new URL(req.url).pathname.split('/')[2])
  const [pedido] = await ctx.db.query('SELECT id, cliente FROM pedidos WHERE id = $1', [id])
  return Response.json(pedido)
}
`,
  visible: [
    { name: 'pedido com três itens', requests: [{ request: get('/pedidos/1'), expect: { status: 200, body: { id: 1, cliente: 'Ana', itens: pedido1, total_centavos: total(pedido1) } } }] },
    { name: 'pedido que não existe', requests: [{ request: get('/pedidos/9999'), expect: { status: 404, body: { erro: 'Pedido não encontrado.' } } }] },
  ],
  hidden: [
    { name: 'pedido com vinte itens', requests: [{ request: get('/pedidos/2'), expect: { status: 200, body: { id: 2, cliente: 'Bruno', itens: pedido2, total_centavos: total(pedido2) } } }] },
    { name: 'pedido sem itens', requests: [{ request: get('/pedidos/3'), expect: { status: 200, body: { id: 3, cliente: 'Carla', itens: [], total_centavos: 0 } } }] },
    { name: 'id que não é número', requests: [{ request: get('/pedidos/abc'), expect: { status: 404 } }] },
  ],
  hints: [
    'Buscar os itens e depois o produto de cada um, num laço, é o N+1: uma consulta por item. Com 20 itens são 22 idas ao banco numa requisição.',
    'Traga os itens já com o nome e o preço do produto: um JOIN entre itens e produtos resolve em uma consulta. (Outra saída: juntar os produto_id e buscar todos com WHERE id = ANY($1).)',
    'SELECT p.nome AS produto, i.quantidade, p.preco_centavos FROM itens i JOIN produtos p ON p.id = i.produto_id WHERE i.pedido_id = $1 ORDER BY i.id',
  ],
  reference: PEDIDO_REFERENCE,
  naive: `export default async function handler(req: Request, ctx: Ctx): Promise<Response> {
  const match = /^\\/pedidos\\/(\\d+)$/.exec(new URL(req.url).pathname)
  if (!match) return Response.json({ erro: 'Rota não encontrada.' }, { status: 404 })
  const id = Number(match[1])
  const [pedido] = await ctx.db.query<{ id: number; cliente: string }>('SELECT id, cliente FROM pedidos WHERE id = $1', [id])
  if (!pedido) return Response.json({ erro: 'Pedido não encontrado.' }, { status: 404 })
  const linhas = await ctx.db.query<{ produto_id: number; quantidade: number }>('SELECT produto_id, quantidade FROM itens WHERE pedido_id = $1 ORDER BY id', [id])
  const itens = []
  for (const linha of linhas) {
    const [p] = await ctx.db.query<{ nome: string; preco_centavos: number }>('SELECT nome, preco_centavos FROM produtos WHERE id = $1', [linha.produto_id])
    itens.push({ produto: p.nome, quantidade: linha.quantidade, preco_centavos: p.preco_centavos })
  }
  const total_centavos = itens.reduce((soma, i) => soma + i.quantidade * i.preco_centavos, 0)
  return Response.json({ ...pedido, itens, total_centavos })
}
`,
  explanation:
    'O JOIN traz cada item já com o nome e o preço do produto: duas consultas por pedido, tenha ele 3 ou 300 itens. O laço que busca um produto por vez dá a mesma resposta, mas são 2 + N idas ao banco, e cada uma paga a viagem e o trabalho de uma consulta: com carga, o banco enfileira e o p99 sobe. ' +
    'WHERE id = ANY($1) com a lista de ids também resolve em uma consulta, útil quando os dados vêm de outro serviço. ' +
    'O custo: o JOIN repete as colunas do produto em cada linha e amarra a consulta ao formato das duas tabelas; para listas de pedidos, vale o mesmo cuidado em escala maior.',
  // At 150 req/s the reference answers in ~145 ms p99 (under 190 ms even with a 50 ms handler); see exercises.test.ts.
  load: { rps: 150, p99Ms: 200, queriesPerRequest: 2 },
}
