import type { OficinaExercise } from '../exercises'

export const FINTECH_SCHEMA = `CREATE TABLE contas (id int PRIMARY KEY, titular text NOT NULL, saldo_centavos int NOT NULL);
CREATE TABLE pagamentos (id serial PRIMARY KEY, chave text NOT NULL UNIQUE, valor_centavos int NOT NULL);`

export const FINTECH_SEED = `INSERT INTO contas VALUES (1, 'Ana', 10000), (2, 'Bruno', 5000), (3, 'Carla', 0);
INSERT INTO pagamentos (chave, valor_centavos) VALUES ('pedido-41', 2500);`

const pay = (chave: string | undefined, body: unknown) => ({ method: 'POST', path: '/pagamentos', body, ...(chave && { headers: { 'idempotency-key': chave } }) })
const charges = (n: number) => ({ sql: 'SELECT count(*)::int AS n FROM pagamentos', rows: [{ n }] })
const MISSING_KEY = { erro: 'Falta o cabeçalho Idempotency-Key.' }

export const PAGAMENTO_REFERENCE = `export default async function handler(req: Request, ctx: Ctx): Promise<Response> {
  const { pathname } = new URL(req.url)
  if (req.method === 'POST' && pathname === '/pagamentos') return pagar(req, ctx)
  return Response.json({ erro: 'Rota não encontrada.' }, { status: 404 })
}

async function pagar(req: Request, ctx: Ctx): Promise<Response> {
  const chave = req.headers.get('idempotency-key')
  if (!chave) return Response.json({ erro: 'Falta o cabeçalho Idempotency-Key.' }, { status: 400 })
  const body = (await req.json().catch(() => null)) as { valor_centavos?: unknown } | null
  const valor = body?.valor_centavos
  if (!Number.isInteger(valor) || (valor as number) <= 0) return Response.json({ erro: 'valor_centavos precisa ser um inteiro positivo.' }, { status: 400 })
  // A chave UNIQUE decide: de duas requisições com a mesma chave, só uma insere. A outra não insere nada e lê a que ficou.
  const [novo] = await ctx.db.query(
    'INSERT INTO pagamentos (chave, valor_centavos) VALUES ($1, $2) ON CONFLICT (chave) DO NOTHING RETURNING id, valor_centavos',
    [chave, valor],
  )
  const pagamento = novo ?? (await ctx.db.query('SELECT id, valor_centavos FROM pagamentos WHERE chave = $1', [chave]))[0]
  return Response.json(pagamento, { status: 201 })
}
`

export const pagamento: OficinaExercise = {
  id: 'pagamento',
  company: 'Fintech',
  title: 'POST /pagamentos: com Idempotency-Key',
  statement:
    'O app da Fintech repete o pagamento quando a rede cai no meio, e às vezes manda o mesmo pagamento duas vezes ao mesmo tempo. Em POST /pagamentos, com { "valor_centavos" } no corpo e o cabeçalho Idempotency-Key, grave o pagamento na tabela pagamentos e responda 201 com { id, valor_centavos }. ' +
    'A mesma chave de novo não cobra outra vez: responde 201 com o mesmo pagamento da primeira vez, inclusive quando as duas chegam juntas. ' +
    'Sem o cabeçalho, 400 com { "erro": "Falta o cabeçalho Idempotency-Key." }; valor que não é inteiro positivo, 400 com { "erro": "valor_centavos precisa ser um inteiro positivo." }. A coluna chave já é UNIQUE.',
  schema: FINTECH_SCHEMA,
  seed: FINTECH_SEED,
  starter: `export default async function handler(req: Request, ctx: Ctx): Promise<Response> {
  const chave = req.headers.get('idempotency-key')
  const { valor_centavos } = (await req.json()) as { valor_centavos: number }
  const [pagamento] = await ctx.db.query('INSERT INTO pagamentos (chave, valor_centavos) VALUES ($1, $2) RETURNING id, valor_centavos', [chave, valor_centavos])
  return Response.json(pagamento, { status: 201 })
}
`,
  visible: [
    {
      name: 'cobra e responde 201',
      requests: [{ request: pay('pedido-42', { valor_centavos: 1500 }), expect: { status: 201, body: { id: 2, valor_centavos: 1500 } } }],
      db: charges(2),
    },
    {
      name: 'a mesma chave de novo devolve o mesmo pagamento',
      requests: [{ request: pay('pedido-41', { valor_centavos: 2500 }), expect: { status: 201, body: { id: 1, valor_centavos: 2500 } } }],
      db: charges(1),
    },
    { name: 'sem Idempotency-Key', requests: [{ request: pay(undefined, { valor_centavos: 1500 }), expect: { status: 400, body: MISSING_KEY } }], db: charges(1) },
  ],
  hidden: [
    {
      name: 'a mesma chave duas vezes ao mesmo tempo cobra uma vez',
      requests: [0, 1].map(() => ({ request: pay('pedido-43', { valor_centavos: 990 }), expect: { status: 201, body: { id: 2, valor_centavos: 990 } } })),
      db: charges(2),
    },
    {
      name: 'chaves diferentes ao mesmo tempo cobram as duas',
      requests: ['pedido-44', 'pedido-45'].map((chave) => ({ request: pay(chave, { valor_centavos: 100 }), expect: { status: 201, body: { valor_centavos: 100 } } })),
      db: charges(3),
    },
    {
      name: 'valor inválido',
      requests: [{ request: pay('pedido-46', { valor_centavos: -5 }), expect: { status: 400, body: { erro: 'valor_centavos precisa ser um inteiro positivo.' } } }],
      db: charges(1),
    },
  ],
  hints: [
    'A chave de idempotência identifica o pagamento: a segunda requisição com a mesma chave devolve o que a primeira fez, sem cobrar de novo. Quem garante isso, mesmo com duas ao mesmo tempo, é o UNIQUE da coluna chave.',
    'Procurar a chave com SELECT e só então inserir tem uma janela: duas requisições juntas passam as duas pelo SELECT. Tente inserir direto e, se a chave já existir, leia o pagamento que está lá.',
    'INSERT INTO pagamentos (chave, valor_centavos) VALUES ($1, $2) ON CONFLICT (chave) DO NOTHING RETURNING id, valor_centavos. Se não voltar linha, a chave já existia: SELECT id, valor_centavos FROM pagamentos WHERE chave = $1.',
  ],
  reference: PAGAMENTO_REFERENCE,
  // Looks the key up first: fine for a retry, but two requests at once both miss it and the second INSERT breaks the UNIQUE.
  naive: `export default async function handler(req: Request, ctx: Ctx): Promise<Response> {
  const chave = req.headers.get('idempotency-key')
  if (!chave) return Response.json({ erro: 'Falta o cabeçalho Idempotency-Key.' }, { status: 400 })
  const { valor_centavos } = (await req.json()) as { valor_centavos: number }
  if (!Number.isInteger(valor_centavos) || valor_centavos <= 0) return Response.json({ erro: 'valor_centavos precisa ser um inteiro positivo.' }, { status: 400 })
  const [existente] = await ctx.db.query('SELECT id, valor_centavos FROM pagamentos WHERE chave = $1', [chave])
  if (existente) return Response.json(existente, { status: 201 })
  const [pagamento] = await ctx.db.query('INSERT INTO pagamentos (chave, valor_centavos) VALUES ($1, $2) RETURNING id, valor_centavos', [chave, valor_centavos])
  return Response.json(pagamento, { status: 201 })
}
`,
  explanation:
    'O INSERT com ON CONFLICT (chave) DO NOTHING tenta e verifica num passo só, e o UNIQUE garante que só uma requisição grava aquela chave, venham elas uma depois da outra ou juntas. Quem não gravou lê o pagamento que ficou e responde igual: para o app, repetir é seguro. ' +
    'Procurar a chave antes de inserir funciona com uma requisição por vez, mas duas juntas passam as duas pela busca; sem o UNIQUE seriam duas cobranças, com ele a segunda vira erro 500. ' +
    'O custo: guardar as chaves (com um prazo para apagar as velhas), e uma consulta a mais em cada repetição. Uma API completa também recusa a mesma chave com outro valor e guarda a resposta inteira, não só o registro.',
  // At 150 req/s the reference answers in ~145 ms p99 (under 190 ms even with a 50 ms handler); see exercises.test.ts.
  load: { rps: 150, p99Ms: 200, queriesPerRequest: 2 },
}
