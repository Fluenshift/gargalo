import type { OficinaExercise } from '../exercises'
import { FINTECH_SCHEMA, FINTECH_SEED, PAGAMENTO_REFERENCE } from './pagamento'

const send = (de: unknown, para: unknown, valor_centavos: unknown) => ({ method: 'POST', path: '/transferencias', body: { de, para, valor_centavos } })
/** Balances of accounts 1, 2 and 3 after the requests (the seed starts them at 10000, 5000 and 0). */
const balances = (...saldos: number[]) => ({ sql: 'SELECT saldo_centavos FROM contas ORDER BY id', rows: saldos.map((saldo_centavos) => ({ saldo_centavos })) })
const INSUFFICIENT = { erro: 'Saldo insuficiente.' }
const INVALID = { erro: 'de, para e valor_centavos precisam ser inteiros, o valor positivo e as contas diferentes.' }

const TRANSFERIR = `
async function transferir(req: Request, ctx: Ctx): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { de?: unknown; para?: unknown; valor_centavos?: unknown } | null
  const { de, para, valor_centavos: valor } = body ?? {}
  if (![de, para, valor].every(Number.isInteger) || (valor as number) <= 0 || de === para) {
    return Response.json({ erro: 'de, para e valor_centavos precisam ser inteiros, o valor positivo e as contas diferentes.' }, { status: 400 })
  }
  try {
    // Débito e crédito na mesma transação: ou os dois acontecem, ou nenhum.
    return await ctx.db.transaction(async (tx) => {
      // Confere o saldo e debita no mesmo comando: duas transferências juntas não leem o mesmo saldo antigo.
      const [origem] = await tx.query<{ saldo_centavos: number }>(
        'UPDATE contas SET saldo_centavos = saldo_centavos - $1 WHERE id = $2 AND saldo_centavos >= $1 RETURNING saldo_centavos',
        [valor, de],
      )
      if (!origem) {
        const existe = await tx.query('SELECT 1 FROM contas WHERE id = $1', [de])
        return existe.length
          ? Response.json({ erro: 'Saldo insuficiente.' }, { status: 422 })
          : Response.json({ erro: 'Conta não encontrada.' }, { status: 404 })
      }
      const destino = await tx.query('UPDATE contas SET saldo_centavos = saldo_centavos + $1 WHERE id = $2 RETURNING id', [valor, para])
      // Lançar desfaz a transação, e com ela o débito acima.
      if (!destino.length) throw Response.json({ erro: 'Conta não encontrada.' }, { status: 404 })
      return Response.json({ de, para, valor_centavos: valor, saldo_centavos: origem.saldo_centavos })
    })
  } catch (err) {
    if (err instanceof Response) return err
    throw err
  }
}
`

const NOT_FOUND = "  return Response.json({ erro: 'Rota não encontrada.' }, { status: 404 })"
const ROUTE = "  if (req.method === 'POST' && pathname === '/transferencias') return transferir(req, ctx)"

export const transferencia: OficinaExercise = {
  id: 'transferencia',
  company: 'Fintech',
  title: 'POST /transferencias: sem saldo negativo',
  statement:
    'Na Fintech, duas transferências da mesma conta ao mesmo tempo deixaram saldo negativo. Em POST /transferencias, com { "de", "para", "valor_centavos" } no corpo (ids de contas e o valor), tire o valor do saldo_centavos da conta de origem, ponha na de destino e responda 200 com { de, para, valor_centavos, saldo_centavos }, este o novo saldo da origem. ' +
    'Sem saldo, 422 com { "erro": "Saldo insuficiente." }, e nada muda. Conta de origem ou de destino que não existe, 404 com { "erro": "Conta não encontrada." }, e nada muda. ' +
    'Dados inválidos (não inteiros, valor ≤ 0, mesma conta), 400 com { "erro": "de, para e valor_centavos precisam ser inteiros, o valor positivo e as contas diferentes." }. ' +
    'O saldo nunca fica negativo, mesmo com várias transferências juntas. ctx.db.transaction(async (tx) => { … }) abre uma transação: se a função lançar, tudo nela é desfeito. O POST /pagamentos do exercício anterior continua valendo.',
  schema: FINTECH_SCHEMA,
  seed: FINTECH_SEED,
  starter: PAGAMENTO_REFERENCE,
  visible: [
    {
      name: 'transfere e devolve o novo saldo',
      requests: [{ request: send(1, 2, 3000), expect: { status: 200, body: { de: 1, para: 2, valor_centavos: 3000, saldo_centavos: 7000 } } }],
      db: balances(7000, 8000, 0),
    },
    { name: 'sem saldo responde 422', requests: [{ request: send(3, 1, 100), expect: { status: 422, body: INSUFFICIENT } }], db: balances(10000, 5000, 0) },
    {
      name: 'duas transferências ao mesmo tempo',
      requests: [
        { request: send(1, 2, 6000), expect: { status: 200, body: { saldo_centavos: 4000 } } },
        { request: send(1, 3, 6000), expect: { status: 422, body: INSUFFICIENT } },
      ],
      db: balances(4000, 11000, 0),
    },
  ],
  hidden: [
    {
      name: 'três ao mesmo tempo',
      requests: [200, 200, 422].map((status) => ({ request: send(1, 2, 4000), expect: { status } })),
      db: balances(2000, 13000, 0),
    },
    {
      name: 'destino que não existe desfaz o débito',
      requests: [{ request: send(1, 99, 1000), expect: { status: 404, body: { erro: 'Conta não encontrada.' } } }],
      db: balances(10000, 5000, 0),
    },
    { name: 'origem que não existe', requests: [{ request: send(99, 1, 1000), expect: { status: 404, body: { erro: 'Conta não encontrada.' } } }], db: balances(10000, 5000, 0) },
    { name: 'valor negativo', requests: [{ request: send(1, 2, -500), expect: { status: 400, body: INVALID } }], db: balances(10000, 5000, 0) },
    { name: 'mesma conta', requests: [{ request: send(1, 1, 500), expect: { status: 400, body: INVALID } }] },
    {
      name: 'o pagamento continua pedindo a chave',
      requests: [{ request: { method: 'POST', path: '/pagamentos', body: { valor_centavos: 100 } }, expect: { status: 400, body: { erro: 'Falta o cabeçalho Idempotency-Key.' } } }],
    },
  ],
  hints: [
    'Ler o saldo, conferir no código e depois gravar abre uma janela: duas transferências leem o mesmo saldo antes de qualquer uma gravar, e as duas passam. A conferência e a escrita precisam ser uma coisa só para o banco.',
    'Ponha a condição no próprio UPDATE: ele só debita se o saldo cobre o valor, e RETURNING diz se debitou. Débito e crédito vão numa ctx.db.transaction, para que um erro no crédito desfaça o débito.',
    "UPDATE contas SET saldo_centavos = saldo_centavos - $1 WHERE id = $2 AND saldo_centavos >= $1 RETURNING saldo_centavos. Se não voltar linha, é 422 (ou 404, se a conta não existe). Destino inexistente: lance dentro da transação (throw Response.json(...)) e devolva no catch.",
  ],
  reference: PAGAMENTO_REFERENCE.replace(NOT_FOUND, `${ROUTE}\n${NOT_FOUND}`) + TRANSFERIR,
  // Reads, checks in code, then writes, outside a transaction: right one at a time, a negative balance when two run together.
  naive: PAGAMENTO_REFERENCE.replace(NOT_FOUND, `${ROUTE}\n${NOT_FOUND}`) + `
async function transferir(req: Request, ctx: Ctx): Promise<Response> {
  const { de, para, valor_centavos } = (await req.json()) as { de: number; para: number; valor_centavos: number }
  if (![de, para, valor_centavos].every(Number.isInteger) || valor_centavos <= 0 || de === para) {
    return Response.json({ erro: 'de, para e valor_centavos precisam ser inteiros, o valor positivo e as contas diferentes.' }, { status: 400 })
  }
  const [origem] = await ctx.db.query<{ saldo_centavos: number }>('SELECT saldo_centavos FROM contas WHERE id = $1', [de])
  const [destino] = await ctx.db.query('SELECT id FROM contas WHERE id = $1', [para])
  if (!origem || !destino) return Response.json({ erro: 'Conta não encontrada.' }, { status: 404 })
  if (origem.saldo_centavos < valor_centavos) return Response.json({ erro: 'Saldo insuficiente.' }, { status: 422 })
  await ctx.db.query('UPDATE contas SET saldo_centavos = $1 WHERE id = $2', [origem.saldo_centavos - valor_centavos, de])
  await ctx.db.query('UPDATE contas SET saldo_centavos = saldo_centavos + $1 WHERE id = $2', [valor_centavos, para])
  return Response.json({ de, para, valor_centavos, saldo_centavos: origem.saldo_centavos - valor_centavos })
}
`,
  explanation:
    'O UPDATE com WHERE saldo_centavos >= $1 confere e debita num comando só: o banco trava a linha enquanto atualiza, então a segunda transferência vê o saldo já debitado e não acha linha para atualizar. Débito e crédito na mesma transação garantem que dinheiro não some nem aparece: se o crédito falha, o débito volta. ' +
    'Ler o saldo e gravar depois dá certo com uma requisição por vez, mas duas juntas leem o mesmo saldo e as duas debitam. SELECT ... FOR UPDATE dentro da transação também resolve, travando a linha desde a leitura, ao preço de uma consulta a mais. ' +
    'O custo: transferências da mesma conta passam a esperar uma pela outra (a linha é um gargalo, como no livro-razão), e um CHECK (saldo_centavos >= 0) na tabela é a segunda linha de defesa.',
  // At 150 req/s the reference answers in ~145 ms p99 (under 190 ms even with a 50 ms handler); see exercises.test.ts.
  load: { rps: 150, p99Ms: 200, queriesPerRequest: 2 },
}
