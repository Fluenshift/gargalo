// Projeto Banco of the Oficina: guided project created from transferencia.ts and pagamento.ts.

import type { RequestSpec } from '../exercise'
import { HTTP, referencia } from './cursoBancoRef'
import type { GuidedStep, ProjectCourse, Stage } from './stage'

const post = (path: string, body: unknown, headers?: Record<string, string>): RequestSpec => ({ method: 'POST', path, body, headers })

const CONTAS_SEED = "INSERT INTO contas (titular, saldo_centavos) VALUES ('Ana', 10000), ('Bruno', 5000), ('Carla', 0)"
const FINTECH_SEED = `${CONTAS_SEED};\nINSERT INTO pagamentos (chave, valor_centavos) VALUES ('pedido-41', 2500)`

// --- Guided steps (issue #138): one concept each, the pattern in code on a stand-in table, the docs entry and a check. ---

const PASSOS_CONTAS: GuidedStep[] = [
  {
    title: 'Onde cada coisa mora',
    learn:
      'Toda requisição entra por src/index.ts: new Hono() cria o [app](hono-app) e app.route liga cada prefixo ao arquivo que cuida dele. As rotas ficam em src/routes/ e só cuidam de HTTP; o SQL fica em src/db/, e o banco chega em c.env.db (veja o [Env](env)). Aqui à direita, a aba Requisição chama sua API como um navegador faria, e Rodar testes confere a etapa, com até 3 estrelas.',
    file: 'src/index.ts',
    example: {
      file: 'src/routes/health.ts',
      code: String.raw`import { Hono } from 'hono'
import { bancoResponde } from '../db/saude' // o SQL mora em src/db/
import type { Env } from '../env'

// Um roteador por recurso; o index escolhe o prefixo com app.route.
export const health = new Hono<{ Bindings: Env }>()

// GET na raiz do roteador = GET /health. c é o contexto da requisição.
health.get('/', async (c) => {
  await bancoResponde(c.env.db) // c.env.db é o banco
  return c.json({ status: 'ok' }) // JSON com status 200
})`,
      note: 'O projeto inicial já responde GET /health: teste na aba Requisição. Suas rotas de contas terão esta mesma forma.',
    },
    docs: ['hono-app', 'hono-route', 'env'],
    byFramework: {
      fetch: {
        learn:
          'Toda requisição entra por src/index.ts, que exporta um objeto com [fetch(req, env)](fetch-app): o servidor chama essa função e espera um Response. As rotas ficam em src/routes/ e só cuidam de HTTP; o SQL fica em src/db/, e o banco chega em env.db (veja o [Env](env)). Aqui à direita, a aba Requisição chama sua API como um navegador faria, e Rodar testes confere a etapa, com até 3 estrelas.',
        example: {
          file: 'src/routes/health.ts',
          code: String.raw`import { bancoResponde } from '../db/saude' // o SQL mora em src/db/
import type { Env } from '../env'

// Uma função por rota: o index chama quando o caminho casa.
export async function health(env: Env): Promise<Response> {
  await bancoResponde(env.db) // env.db é o banco
  return Response.json({ status: 'ok' }) // JSON com status 200
}`,
          note: 'O projeto inicial já responde GET /health: teste na aba Requisição. Suas rotas de contas terão esta mesma forma.',
        },
        docs: ['fetch-app', 'fetch-rotear', 'env'],
      },
    },
  },
  {
    title: 'O que o src/http.ts já traz',
    learn:
      'Este curso começa com src/http.ts pronto, para você focar no banco. [ErroHttp e problema](http-helpers) montam erros em [problem+json](problem-json), e deErro transforma qualquer erro lançado numa resposta. [idDe e achado](id-achado) validam o id da URL e viram 404 quando a linha não existe.',
    file: 'src/http.ts',
    example: {
      file: 'modelo',
      code: String.raw`import { achado, ErroHttp, idDe } from '../http'

// idDe converte o texto da URL em número; "abc" lança ErroHttp 400.
const id = idDe('7')

// achado devolve a linha, ou lança ErroHttp 404: "Fatura não encontrada".
const fatura = achado(await buscarFatura(db, id), 'Fatura')

// Qualquer outra regra de negócio: lance um ErroHttp com o status certo.
if (fatura.paga) throw new ErroHttp(409, 'Fatura já paga')`,
      note: 'Você só vai usar essas funções; não precisa editar o arquivo. Quem transforma o que foi lançado em resposta é o deErro, que o index liga no último passo.',
    },
    docs: ['http-helpers', 'id-achado', 'problem-json'],
  },
  {
    title: 'Dinheiro em centavos: a tabela',
    learn:
      'Dinheiro em ponto flutuante arredonda errado e perde centavos. Guarde um [inteiro em centavos](dinheiro-centavos) e deixe o banco recusar saldo negativo com CHECK. A [migração](sql-migracao) é um arquivo SQL em migrations/ que cria a tabela.',
    file: 'migrations/001_contas.sql',
    example: {
      file: 'modelo',
      code: String.raw`-- Uma migração é um arquivo SQL em migrations/, rodado em ordem.
CREATE TABLE cartoes (
  id serial PRIMARY KEY, -- chave gerada pelo banco
  dono text NOT NULL, -- texto obrigatório
  limite_centavos int NOT NULL CHECK (limite_centavos >= 0) -- inteiro em centavos; o banco recusa negativo
);`,
      note: 'No seu caso: a tabela é contas, com id serial, titular text e saldo_centavos int não negativo.',
    },
    docs: ['dinheiro-centavos', 'sql-migracao'],
    check: { kind: 'file', path: 'migrations/001_contas.sql', contains: ['CREATE TABLE contas', 'saldo_centavos int', 'CHECK'] },
  },
  {
    title: 'O SQL em src/db/contas.ts',
    learn:
      'Cada operação vira uma função em src/db/, e a rota só chama. Os valores entram por [$1, $2 em params](db-query), nunca colados no SQL, e [RETURNING](returning) devolve a linha gravada. Liste as colunas em vez de usar SELECT *: a resposta não muda quando a tabela ganhar uma coluna interna.',
    file: 'src/db/contas.ts',
    example: {
      file: 'modelo',
      code: String.raw`import type { Env } from '../env'

type Db = Env['db'] // o tipo do banco que a rota entrega

export interface Cartao {
  id: number
  dono: string
  limite_centavos: number
}

// INSERT ... RETURNING devolve a linha criada, com o id que o banco gerou.
export async function criarCartao(db: Db, dono: string, limite: number): Promise<Cartao> {
  const [criado] = await db.query<Cartao>(
    'INSERT INTO cartoes (dono, limite_centavos) VALUES ($1, $2) RETURNING id, dono, limite_centavos', // $1 e $2 vêm de params
    [dono, limite],
  )
  return criado
}

// Sem linha, o desestruturado fica undefined: quem chama decide o 404.
export async function buscarCartao(db: Db, id: number): Promise<Cartao | undefined> {
  const [cartao] = await db.query<Cartao>('SELECT id, dono, limite_centavos FROM cartoes WHERE id = $1', [id])
  return cartao
}

// Colunas explícitas e ORDER BY: uma ordem previsível para o cliente.
export async function listarCartoes(db: Db): Promise<Cartao[]> {
  return db.query<Cartao>('SELECT id, dono, limite_centavos FROM cartoes ORDER BY id')
}`,
      note: 'No seu caso: criarConta(db, { titular, saldo_centavos }), buscarConta(db, id) e listarContas(db), com as colunas id, titular, saldo_centavos e a lista ordenada por id.',
    },
    docs: ['db-query', 'returning'],
    check: {
      kind: 'file',
      path: 'src/db/contas.ts',
      contains: ['RETURNING id, titular, saldo_centavos', 'SELECT id, titular, saldo_centavos FROM contas WHERE id = $1', 'SELECT id, titular, saldo_centavos FROM contas ORDER BY id'],
    },
  },
  {
    title: 'Valide na borda com Zod',
    learn:
      'Nunca confie no corpo que chega: um saldo de 10.5 ou de -100 corromperia o banco. Um [schema do Zod](zod-schema) descreve o formato aceito, e o TypeScript deduz o tipo a partir dele. Os limites ficam no schema: o int do Postgres vai só até 2147483647.',
    file: 'src/validacao.ts',
    example: {
      file: 'modelo',
      code: String.raw`import { z } from 'zod'

// z.object descreve o corpo esperado, campo a campo.
export const cartaoSchema = z.object({
  dono: z.string().trim().min(1), // texto sem espaços nas pontas, não vazio
  limite_centavos: z.number().int().min(0).max(2147483647), // inteiro, dentro do int do Postgres
})`,
      note: 'No seu caso: contaSchema, com titular (texto não vazio) e saldo_centavos (inteiro de 0 a 2147483647).',
    },
    docs: ['zod-schema'],
    check: { kind: 'file', path: 'src/validacao.ts', contains: ['export const contaSchema', 'z.number().int()', '2147483647'] },
  },
  {
    title: 'Transforme falhas em 400: lerCorpo',
    learn:
      'safeParse não lança erro: devolve success e os dados, ou a lista de problemas. Converta a falha num [ErroHttp 400](zod-validar) com a lista de campos no extra, e o deErro a responde em problem+json. Uma função só, lerCorpo, serve a todas as rotas de POST.',
    file: 'src/validacao.ts',
    example: {
      file: 'modelo',
      code: String.raw`import { ErroHttp } from './http'

export async function lerCartao(req: Request) {
  // Corpo que não é JSON vira undefined, e o schema o recusa.
  const resultado = cartaoSchema.safeParse(await req.json().catch(() => undefined))
  if (resultado.success) return resultado.data // dados já validados e tipados
  // Um item por campo errado: { campo, mensagem }.
  const erros = resultado.error.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message }))
  // O 4º argumento (extra) vai para o corpo do problem+json.
  throw new ErroHttp(400, 'Dados inválidos', 'Corrija os campos indicados.', { erros })
}`,
      note: 'No seu caso: lerCorpo(req, schema), que recebe o schema como argumento (<S extends z.ZodType>, devolvendo z.output<S>), para as próximas etapas reusarem.',
    },
    docs: ['zod-validar'],
    check: { kind: 'file', path: 'src/validacao.ts', contains: ['export async function lerCorpo', 'safeParse', 'ErroHttp(400'] },
  },
  {
    title: 'As rotas de contas',
    learn:
      'A rota é fina: lê a entrada, chama a função de src/db/ e responde. POST responde [201 com o cabeçalho Location](hono-header-resposta), que diz onde ler o recurso novo; GET /:id usa idDe e achado para os erros 400 e 404. Os erros são lançados: quem os converte em resposta é o app, no próximo passo.',
    file: 'src/routes/contas.ts',
    example: {
      file: 'modelo',
      code: String.raw`import { Hono } from 'hono'
import { buscarCartao, criarCartao, listarCartoes } from '../db/cartoes'
import type { Env } from '../env'
import { achado, idDe } from '../http'
import { lerCartao } from '../validacao'

export const cartoes = new Hono<{ Bindings: Env }>()

// GET /cartoes: lista tudo.
cartoes.get('/', async (c) => c.json(await listarCartoes(c.env.db)))

cartoes.post('/', async (c) => {
  const corpo = await lerCartao(c.req.raw) // c.req.raw é a Request padrão
  const criado = await criarCartao(c.env.db, corpo.dono, corpo.limite_centavos)
  c.header('Location', '/cartoes/' + criado.id) // onde ler o recurso novo
  return c.json(criado, 201) // 201 Created
})

// :id chega como texto; idDe valida (400) e achado vira 404 se a linha não existe.
cartoes.get('/:id', async (c) => c.json(achado(await buscarCartao(c.env.db, idDe(c.req.param('id'))), 'Cartão')))`,
      note: 'No seu caso: o roteador se chama contas, o corpo vem de lerCorpo(c.req.raw, contaSchema) e o nome em achado é "Conta".',
    },
    docs: ['hono-rotas', 'hono-header-resposta', 'hono-param', 'id-achado'],
    check: {
      kind: 'file',
      path: 'src/routes/contas.ts',
      contains: ["contas.get('/'", "contas.post('/'", "contas.get('/:id'", 'Location', ', 201)', 'idDe(', 'achado('],
    },
    byFramework: {
      fetch: {
        learn:
          'A rota é fina: lê a entrada, chama a função de src/db/ e responde. O index passa o id da URL como texto, e a função decide pelo método. POST responde [201 com o cabeçalho Location](fetch-json), que diz onde ler o recurso novo; GET com id usa idDe e achado para os erros 400 e 404.',
        example: {
          file: 'modelo',
          code: String.raw`import { buscarCartao, criarCartao, listarCartoes } from '../db/cartoes'
import type { Env } from '../env'
import { achado, idDe, problema } from '../http'
import { lerCartao } from '../validacao'

// Uma função por recurso: o index entrega req, env e o id da URL (texto, ou undefined).
export async function cartoes(req: Request, env: Env, id?: string): Promise<Response> {
  if (!id && req.method === 'GET') return Response.json(await listarCartoes(env.db))
  if (!id && req.method === 'POST') {
    const corpo = await lerCartao(req) // aqui req já é a Request padrão
    const criado = await criarCartao(env.db, corpo.dono, corpo.limite_centavos)
    // Location vai em headers, junto do status 201 (Created).
    return Response.json(criado, { status: 201, headers: { Location: '/cartoes/' + criado.id } })
  }
  // Com id: idDe valida (400) e achado vira 404 se a linha não existe.
  if (id && req.method === 'GET') return Response.json(achado(await buscarCartao(env.db, idDe(id)), 'Cartão'))
  return problema(405, 'Método não permitido') // um verbo que a rota não atende
}`,
          note: 'No seu caso: a função se chama contas, o corpo vem de lerCorpo(req, contaSchema) e o nome em achado é "Conta".',
        },
        docs: ['fetch-json', 'fetch-body', 'id-achado'],
        check: { kind: 'file', path: 'src/routes/contas.ts', contains: ['export async function contas', 'status: 201', 'Location', 'idDe(id)', 'achado('] },
      },
    },
  },
  {
    title: 'Registre a rota e padronize os erros',
    learn:
      'Falta ligar a rota e dizer ao app como responder erros. [app.notFound](hono-notfound) trata o caminho sem dono, e [app.onError](hono-erros) pega todo erro lançado: os dois usam os helpers de http.ts. Sem esse passo, um ErroHttp viraria um 500 genérico.',
    file: 'src/index.ts',
    example: {
      file: 'src/index.ts',
      code: String.raw`import { cartoes } from './routes/cartoes' // 1. importe o roteador
import { deErro, problema } from './http'

const app = new Hono<{ Bindings: Env }>()

app.route('/health', health)
app.route('/cartoes', cartoes) // 2. monte no prefixo

// 3. Caminho sem dono: 404 em problem+json.
app.notFound(() => problema(404, 'Rota não encontrada'))
// 4. Todo erro lançado (ErroHttp ou bug) passa pelo deErro.
app.onError(deErro)`,
      note: "No seu caso: importe contas de './routes/contas' e monte em '/contas'.",
    },
    docs: ['hono-route', 'hono-notfound', 'hono-erros'],
    check: { kind: 'request', path: '/contas/abc', status: 400, body: { status: 400 } },
    byFramework: {
      fetch: {
        learn:
          'Falta ligar a função e tratar os erros. O index separa o caminho em partes, chama a função do recurso e envolve tudo num try/catch: o deErro transforma todo erro lançado em resposta. Separe com split, não com um regex só de dígitos: assim /contas/abc chega ao idDe e responde 400.',
        example: {
          file: 'src/index.ts',
          code: String.raw`import { cartoes } from './routes/cartoes' // 1. importe a função
import { deErro, problema } from './http'

type Rota = (req: Request, env: Env, id?: string) => Promise<Response>

// 2. Recurso -> função: um objeto no lugar de vários if.
const rotas: Record<string, Rota> = { cartoes }

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // '/cartoes/7' vira ['', 'cartoes', '7']: o recurso e o id (texto).
    const [, recurso, id] = new URL(req.url).pathname.split('/')
    // hasOwn evita que "constructor" ou "toString" achem algo no objeto.
    if (!Object.hasOwn(rotas, recurso)) return problema(404, 'Rota não encontrada')
    try {
      return await rotas[recurso](req, env, id) // await: o erro de uma rota async cai no catch
    } catch (err) {
      return deErro(err) // ErroHttp vira o status dele; o resto vira 500
    }
  },
}`,
          note: "No seu caso: importe contas de './routes/contas' e acrescente contas em rotas. O /health do starter pode ficar num if antes do split.",
        },
        docs: ['fetch-rotear', 'erro-lancado', 'http-helpers'],
        check: { kind: 'request', path: '/contas/abc', status: 400, body: { status: 400 } },
      },
    },
  },
]

const PASSOS_TRANSFERENCIAS: GuidedStep[] = [
  {
    title: 'A corrida do saldo',
    learn:
      'Duas transferências ao mesmo tempo da mesma conta podem ler o mesmo saldo e gastar o dinheiro duas vezes: uma [condição de corrida](corrida-saldo). Ler o saldo, conferir no código e gravar depois deixa a brecha aberta; a saída é deixar o próprio UPDATE conferir. O banco do navegador roda uma transação por vez e não mostra a corrida, então a conferência saldo-atomico do checklist lê o seu SQL para ver se a brecha existe.',
    example: {
      file: 'modelo',
      code: String.raw`// ERRADO: dois pedidos leem qtd = 1 ao mesmo tempo, e os dois passam.
const [item] = await db.query('SELECT qtd FROM estoque WHERE id = $1', [id])
if (item.qtd < 1) throw new ErroHttp(409, 'Sem estoque')
await db.query('UPDATE estoque SET qtd = qtd - 1 WHERE id = $1', [id])

// CERTO: conferir e baixar é um comando só; o banco o serializa por linha.
const [baixado] = await db.query('UPDATE estoque SET qtd = qtd - 1 WHERE id = $1 AND qtd >= 1 RETURNING qtd', [id])
if (!baixado) throw new ErroHttp(409, 'Sem estoque') // nenhuma linha mudou`,
      note: 'No seu caso: o estoque é o saldo_centavos da conta de origem, e a baixa é o valor da transferência.',
    },
    docs: ['corrida-saldo', 'update-condicional'],
  },
  {
    title: 'A tabela de transferências',
    learn:
      'Cada etapa traz sua migração, numerada para rodar depois da anterior. A transferência guarda quem enviou, quem recebeu e o valor, com [REFERENCES](sql-migracao) para o banco recusar uma conta que não existe. O CHECK impede valor zero ou negativo, mesmo se a validação falhar.',
    file: 'migrations/002_transferencias.sql',
    example: {
      file: 'modelo',
      code: String.raw`CREATE TABLE faturas (
  id serial PRIMARY KEY,
  cartao int NOT NULL REFERENCES cartoes (id), -- chave estrangeira: o cartão tem de existir
  valor_centavos int NOT NULL CHECK (valor_centavos > 0), -- sempre positivo
  criado_em timestamptz NOT NULL DEFAULT now() -- preenchido pelo banco
);`,
      note: 'No seu caso: a tabela é transferencias, com de e para (cada um REFERENCES contas (id)), valor_centavos e criado_em.',
    },
    docs: ['sql-migracao'],
    check: { kind: 'file', path: 'migrations/002_transferencias.sql', contains: ['CREATE TABLE transferencias', 'REFERENCES contas', 'valor_centavos'] },
  },
  {
    title: 'Uma regra entre dois campos',
    learn:
      'O corpo traz três números, e a regra "origem diferente do destino" envolve dois campos. [refine](zod-refine) roda depois dos campos individuais e recebe o objeto inteiro; o path diz em qual campo mostrar o erro. Os ids e o valor começam em 1: zero e negativos nunca existem.',
    file: 'src/validacao.ts',
    example: {
      file: 'modelo',
      code: String.raw`export const rotaSchema = z
  .object({
    origem: z.number().int().min(1).max(2147483647), // id: inteiro a partir de 1
    destino: z.number().int().min(1).max(2147483647),
  })
  // refine vê o objeto inteiro: aqui cabe uma regra entre campos.
  .refine((r) => r.origem !== r.destino, {
    message: 'Origem e destino devem ser diferentes.', // o texto do erro
    path: ['destino'], // em qual campo ele aparece
  })`,
      note: 'No seu caso: transferenciaSchema, com de, para e valor_centavos (todos inteiros de 1 a 2147483647) e a regra de ≠ entre de e para.',
    },
    docs: ['zod-schema', 'zod-refine'],
    check: { kind: 'file', path: 'src/validacao.ts', contains: ['export const transferenciaSchema', '.refine('] },
  },
  {
    title: 'Tudo ou nada: a transação',
    learn:
      'Débito, crédito e registro precisam gravar juntos, ou nenhum grava. [db.transaction](db-transaction) abre a transação e entrega um tx: use sempre o tx lá dentro, nunca o db. Se qualquer passo lançar um erro, o banco desfaz tudo o que a transação já gravou.',
    file: 'src/db/transferencias.ts',
    example: {
      file: 'modelo',
      code: String.raw`export async function comprarIngresso(db: Db, sessao: number, cliente: number) {
  // Tudo dentro do callback grava junto, ou nada grava.
  return db.transaction(async (tx) => {
    // tx, não db: só o tx participa da transação.
    await tx.query('UPDATE sessoes SET vagas = vagas - 1 WHERE id = $1', [sessao])
    await tx.query('INSERT INTO ingressos (sessao, cliente) VALUES ($1, $2)', [sessao, cliente])
    // O que a função devolve sai da transação junto com o COMMIT.
    return { sessao, cliente }
  })
}`,
      note: 'No seu caso: transferir(db, de, para, valor), que devolve { de, para, valor_centavos, saldo_centavos }. Por enquanto, escreva só a casca com db.transaction.',
    },
    docs: ['db-transaction'],
    check: { kind: 'file', path: 'src/db/transferencias.ts', contains: ['export async function transferir', 'db.transaction(async (tx)'] },
  },
  {
    title: 'Debite com UPDATE condicional',
    learn:
      'Primeiro tire o dinheiro da origem, e deixe o [UPDATE condicional](update-condicional) conferir o saldo: WHERE saldo_centavos >= $1. RETURNING vem vazio quando nenhuma linha mudou, e então a conta não existe ou o saldo não bastou. Pergunte ao banco qual dos dois, para responder 404 ou 409.',
    file: 'src/db/transferencias.ts',
    example: {
      file: 'modelo',
      code: String.raw`const [antes] = await tx.query<{ pontos: number }>(
  // Débito e conferência no mesmo comando: sem janela entre ler e gravar.
  'UPDATE carteiras SET pontos = pontos - $1 WHERE id = $2 AND pontos >= $1 RETURNING pontos',
  [custo, id],
)
if (!antes) {
  // Nenhuma linha mudou: ou a carteira não existe, ou os pontos não bastam.
  const existe = await tx.query('SELECT 1 FROM carteiras WHERE id = $1', [id])
  if (!existe.length) throw new ErroHttp(404, 'Carteira não encontrada')
  throw new ErroHttp(409, 'Pontos insuficientes') // 409 Conflict: o estado atual não permite
}`,
      note: 'No seu caso: tabela contas, coluna saldo_centavos e o id é o de. As respostas são 404 "Conta não encontrada" e 409 "Saldo insuficiente"; o RETURNING traz o novo saldo da origem.',
    },
    docs: ['update-condicional', 'db-query', 'db-erros'],
    check: { kind: 'file', path: 'src/db/transferencias.ts', contains: ['SET saldo_centavos = saldo_centavos - $1', 'saldo_centavos >= $1', 'ErroHttp(409'] },
  },
  {
    title: 'Credite o destino e registre',
    learn:
      'Com a origem debitada, credite o destino e grave a linha da transferência. Se o destino não existir, o UPDATE devolve vazio: lance um ErroHttp 404, e o [throw dentro da transação](db-transaction) desfaz o débito que já tinha sido feito. Termine devolvendo o novo saldo da origem.',
    file: 'src/db/transferencias.ts',
    example: {
      file: 'modelo',
      code: String.raw`// Credita e confere na mesma linha: RETURNING vazio = destino inexistente.
const [destino] = await tx.query<{ id: number }>('UPDATE carteiras SET pontos = pontos + $1 WHERE id = $2 RETURNING id', [custo, para])
// O throw aqui desfaz também o débito do passo anterior.
if (!destino) throw new ErroHttp(404, 'Carteira não encontrada', 'Carteira de destino não encontrada.')
await tx.query('INSERT INTO historico (de, para, pontos) VALUES ($1, $2, $3)', [id, para, custo]) // o registro
return { de: id, para, pontos: custo, saldo: antes.pontos } // o resultado da função`,
      note: 'No seu caso: INSERT INTO transferencias (de, para, valor_centavos), e o retorno é { de, para, valor_centavos, saldo_centavos } com o saldo da origem.',
    },
    docs: ['db-transaction', 'returning'],
    check: { kind: 'file', path: 'src/db/transferencias.ts', contains: ['saldo_centavos + $1', 'INSERT INTO transferencias'] },
  },
  {
    title: 'Evite impasse: trave as contas em ordem',
    learn:
      'Uma transferência de A para B e outra de B para A, ao mesmo tempo, podem ficar cada uma esperando a outra: um [deadlock](for-update-ordem). A saída é travar sempre na mesma ordem, a do id, com FOR UPDATE antes de mexer nos saldos. O banco do navegador não reproduz isso, mas num Postgres de verdade evita a falha.',
    file: 'src/db/transferencias.ts',
    example: {
      file: 'modelo',
      code: String.raw`// ANY($1) recebe os dois ids; ORDER BY id trava sempre do menor para o maior.
// FOR UPDATE: ninguém altera estas linhas até o fim da transação.
await tx.query('SELECT id FROM carteiras WHERE id = ANY($1) ORDER BY id FOR UPDATE', [[id, para]])
// Só depois vêm os UPDATEs, já com as duas linhas travadas.`,
      note: 'No seu caso: tabela contas e [de, para], como primeira consulta dentro da transação.',
    },
    docs: ['for-update-ordem'],
    check: { kind: 'file', path: 'src/db/transferencias.ts', contains: ['FOR UPDATE', 'ORDER BY id'] },
  },
  {
    title: 'A rota e o registro',
    learn:
      'A rota segue o molde da etapa anterior: lê o corpo validado, chama transferir e responde 200 com o resultado. Os erros 400, 404 e 409 já saem como problem+json pelo app. Registre a rota no index como fez com contas e teste com POST na aba Requisição.',
    file: 'src/routes/transferencias.ts',
    example: {
      file: 'modelo',
      code: String.raw`export const pontos = new Hono<{ Bindings: Env }>()

// POST /pontos: o corpo validado chega já desestruturado.
pontos.post('/', async (c) => {
  const { de, para, valor } = await lerCorpo(c.req.raw, trocaSchema)
  const resultado = await transferirPontos(c.env.db, de, para, valor)
  return c.json(resultado, 200) // 200: a operação já aconteceu, não há recurso novo para ler
})

// No index: import { pontos } from './routes/pontos'  e  app.route('/pontos', pontos)`,
      note: "No seu caso: o roteador é transferencias e o schema é transferenciaSchema. No index: importe de './routes/transferencias' e monte em '/transferencias'.",
    },
    docs: ['hono-route', 'hono-json'],
    check: { kind: 'file', path: 'src/index.ts', contains: ["from './routes/transferencias'", "app.route('/transferencias', transferencias)"] },
    byFramework: {
      fetch: {
        example: {
          file: 'modelo',
          code: String.raw`// A função recebe a Request: lerCorpo(req, schema) não precisa de c.req.raw.
export async function pontos(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return problema(405, 'Método não permitido') // só POST
  const { de, para, valor } = await lerCorpo(req, trocaSchema)
  const resultado = await transferirPontos(env.db, de, para, valor)
  return Response.json(resultado, { status: 200 }) // 200: a operação já aconteceu
}

// No index: import { pontos } from './routes/pontos'  e  const rotas = { cartoes, pontos }`,
          note: "No seu caso: a função é transferencias e o schema é transferenciaSchema. No index: importe de './routes/transferencias' e acrescente transferencias ao fim de rotas.",
        },
        docs: ['fetch-rotear', 'fetch-json'],
        check: { kind: 'file', path: 'src/index.ts', contains: ["from './routes/transferencias'", 'transferencias}'] },
      },
    },
  },
]

const PASSOS_PAGAMENTOS: GuidedStep[] = [
  {
    title: 'Por que uma chave de idempotência',
    learn:
      'Quando a rede falha, o cliente repete o POST sem saber se o primeiro chegou, e sem proteção cobra duas vezes. Com o cabeçalho Idempotency-Key, o cliente manda uma chave única por cobrança, e o servidor reconhece a repetição. Essa regra é a [idempotência](idempotencia): a mesma chave com o mesmo valor devolve a resposta original, e com outro valor é um erro 422.',
    example: {
      file: 'modelo',
      code: String.raw`// 1ª chamada: POST /envios   Idempotency-Key: pedido-7   { "peso": 300 }
//   chave nova -> grava e responde 201 { id: 1, peso: 300 }

// Repetição idêntica (a rede caiu antes da resposta chegar):
//   mesma chave, mesmo peso -> NÃO grava de novo, responde 201 { id: 1, peso: 300 }

// Mesma chave com outro corpo (provável bug do cliente):
//   mesma chave, peso 900 -> 422 e não grava nada`,
      note: 'No seu caso: POST /pagamentos, com valor_centavos no lugar de peso, e o título do 422 é "Chave de idempotência reutilizada".',
    },
    docs: ['idempotencia'],
  },
  {
    title: 'A chave é UNIQUE no banco',
    learn:
      'Guarde a chave numa coluna UNIQUE: o banco recusa duas linhas com a mesma chave, mesmo que duas requisições cheguem juntas. Essa garantia mora no banco porque é o único lugar onde a corrida se resolve de verdade. Veja a [migração](sql-migracao) da etapa anterior para o formato.',
    file: 'migrations/003_pagamentos.sql',
    example: {
      file: 'modelo',
      code: String.raw`CREATE TABLE envios (
  id serial PRIMARY KEY,
  chave text NOT NULL UNIQUE, -- UNIQUE: o banco recusa uma segunda linha com a mesma chave
  peso int NOT NULL CHECK (peso > 0),
  criado_em timestamptz NOT NULL DEFAULT now()
);`,
      note: 'No seu caso: a tabela é pagamentos, com chave text UNIQUE e valor_centavos int positivo.',
    },
    docs: ['sql-migracao', 'idempotencia'],
    check: { kind: 'file', path: 'migrations/003_pagamentos.sql', contains: ['CREATE TABLE pagamentos', 'UNIQUE'] },
  },
  {
    title: 'O valor do pagamento',
    learn:
      'Você já escreveu schemas: pagamentoSchema só tem valor_centavos, um inteiro de 1 a 2147483647. A chave não entra nele, porque não vem no corpo e sim num cabeçalho. Valide o valor do mesmo jeito que na transferência, com [zod](zod-schema).',
    file: 'src/validacao.ts',
    example: {
      file: 'modelo',
      code: String.raw`// Um schema com um campo só; o cabeçalho é lido na rota, fora dele.
export const envioSchema = z.object({
  peso: z.number().int().min(1).max(2147483647), // positivo: não existe envio de peso zero
})`,
      note: 'No seu caso: pagamentoSchema, com valor_centavos.',
    },
    docs: ['zod-schema'],
    check: { kind: 'file', path: 'src/validacao.ts', contains: ['export const pagamentoSchema'] },
  },
  {
    title: 'Leia o cabeçalho Idempotency-Key',
    learn:
      'O cabeçalho não vem no corpo: leia com [c.req.header](hono-header), que ignora maiúsculas e devolve undefined quando falta. Sem a chave não há como proteger a cobrança, então responda 400 com ErroHttp antes de qualquer outra coisa.',
    file: 'src/routes/pagamentos.ts',
    example: {
      file: 'modelo',
      code: String.raw`envios.post('/', async (c) => {
  // O nome do cabeçalho não diferencia maiúsculas; se faltar, vem undefined.
  const chave = c.req.header('idempotency-key')
  // Sem a chave, recuse já: o 400 vira problem+json pelo app.onError.
  if (!chave) throw new ErroHttp(400, 'Falta o cabeçalho Idempotency-Key')
  const corpo = await lerCorpo(c.req.raw, envioSchema) // valida o corpo, como antes
  // ... a gravação vem nos próximos passos
})`,
      note: 'No seu caso: pagamentos.post, o schema é pagamentoSchema e o corpo traz valor_centavos.',
    },
    docs: ['hono-header', 'hono-erros'],
    check: { kind: 'file', path: 'src/routes/pagamentos.ts', contains: ['ErroHttp(400'] },
    byFramework: {
      fetch: {
        learn:
          'O cabeçalho não vem no corpo: leia com [req.headers.get](fetch-header), que ignora maiúsculas e devolve null quando falta. Sem a chave não há como proteger a cobrança, então responda 400 com ErroHttp antes de qualquer outra coisa.',
        example: {
          file: 'modelo',
          code: String.raw`export async function envios(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return problema(405, 'Método não permitido')
  // O nome do cabeçalho não diferencia maiúsculas; se faltar, vem null.
  const chave = req.headers.get('idempotency-key')
  // Sem a chave, recuse já: o index captura o throw e o deErro responde 400.
  if (!chave) throw new ErroHttp(400, 'Falta o cabeçalho Idempotency-Key')
  const corpo = await lerCorpo(req, envioSchema) // valida o corpo, como antes
  // ... a gravação vem nos próximos passos
}`,
          note: 'No seu caso: a função é pagamentos, o schema é pagamentoSchema e o corpo traz valor_centavos.',
        },
        docs: ['fetch-header', 'erro-lancado'],
      },
    },
  },
  {
    title: 'Insira sem brigar: ON CONFLICT',
    learn:
      'Conferir a chave com um SELECT e inserir depois deixa a mesma brecha da corrida do saldo. Em vez disso, tente inserir logo: [ON CONFLICT DO NOTHING](on-conflict) ignora a linha quando a chave já existe, e o RETURNING vem vazio. Um INSERT só decide quem chegou primeiro.',
    file: 'src/db/pagamentos.ts',
    example: {
      file: 'modelo',
      code: String.raw`export async function registrarEnvio(db: Db, chave: string, peso: number) {
  const [novo] = await db.query<Envio>(
    // Se a chave já existe, não falha nem grava: o resultado vem vazio.
    'INSERT INTO envios (chave, peso) VALUES ($1, $2) ON CONFLICT (chave) DO NOTHING RETURNING id, peso',
    [chave, peso],
  )
  if (novo) return novo // chave nova: gravou agora
  // Vazio: a chave já existia. O próximo passo trata esse caso.
}`,
      note: 'No seu caso: processarPagamento(db, chave, valorCentavos), na tabela pagamentos, com RETURNING id, valor_centavos.',
    },
    docs: ['on-conflict', 'returning'],
    check: { kind: 'file', path: 'src/db/pagamentos.ts', contains: ['ON CONFLICT (chave) DO NOTHING', 'RETURNING id, valor_centavos'] },
  },
  {
    title: 'Chave repetida: devolver ou recusar',
    learn:
      'Se o INSERT veio vazio, a chave já foi usada: busque o pagamento guardado. Com o mesmo valor, é uma repetição, e a resposta é a original; com valor diferente, é a chave reutilizada para outra cobrança, e a resposta é 422. O 422 diz: entendi o pedido, mas não posso aceitá-lo.',
    file: 'src/db/pagamentos.ts',
    example: {
      file: 'modelo',
      code: String.raw`// O que ficou guardado com esta chave.
const [guardado] = await db.query<Envio>('SELECT id, peso FROM envios WHERE chave = $1', [chave])
// Mesma chave com outro corpo: nunca devolva o guardado como se fosse o novo pedido.
if (guardado.peso !== peso) throw new ErroHttp(422, 'Chave reutilizada', 'A chave já foi usada com outro peso.')
return guardado // repetição idêntica: a mesma resposta de antes`,
      note: 'No seu caso: compare valor_centavos, e o título do 422 é exatamente "Chave de idempotência reutilizada".',
    },
    docs: ['idempotencia', 'db-query'],
    check: { kind: 'file', path: 'src/db/pagamentos.ts', contains: ['ErroHttp(422', 'Chave de idempotência reutilizada'] },
  },
  {
    title: 'A rota responde 201, sempre',
    learn:
      'A rota entrega a chave e o valor à função do banco e responde 201 com o pagamento, tanto na primeira vez quanto na repetição: quem repete recebe a mesma resposta de antes. Registre a rota no index. Depois, na aba Requisição, mande POST com o cabeçalho Idempotency-Key duas vezes: o id não muda.',
    file: 'src/routes/pagamentos.ts',
    example: {
      file: 'modelo',
      code: String.raw`  // ... dentro do envios.post, depois de ler a chave e validar o corpo:
  const envio = await registrarEnvio(c.env.db, chave, corpo.peso)
  return c.json(envio, 201) // 201 também na repetição: a resposta é a original

// No index: import { envios } from './routes/envios'  e  app.route('/envios', envios)`,
      note: "No seu caso: processarPagamento(c.env.db, chave, corpo.valor_centavos). No index: importe de './routes/pagamentos' e monte em '/pagamentos'.",
    },
    docs: ['hono-json', 'hono-route'],
    check: { kind: 'file', path: 'src/index.ts', contains: ["from './routes/pagamentos'", "app.route('/pagamentos', pagamentos)"] },
    byFramework: {
      fetch: {
        example: {
          file: 'modelo',
          code: String.raw`  // ... dentro da função envios, depois de ler a chave e validar o corpo:
  const envio = await registrarEnvio(env.db, chave, corpo.peso)
  return Response.json(envio, { status: 201 }) // 201 também na repetição: a resposta é a original

// No index: import { envios } from './routes/envios'  e  const rotas = { cartoes, envios }`,
          note: "No seu caso: processarPagamento(env.db, chave, corpo.valor_centavos). No index: importe de './routes/pagamentos' e acrescente pagamentos ao fim de rotas.",
        },
        docs: ['fetch-json', 'fetch-rotear'],
        check: { kind: 'file', path: 'src/index.ts', contains: ["from './routes/pagamentos'", 'pagamentos}'] },
      },
    },
  },
]

const contas: Stage = {
  id: 'contas',
  title: 'Contas e validação',
  statement: 'Crie as rotas de contas (POST, GET e GET por id), com valores em centavos, validação com Zod e erros em problem+json.',
  steps: PASSOS_CONTAS,
  files: ['src/index.ts', 'src/env.ts', 'src/http.ts', 'src/validacao.ts', 'src/db/contas.ts', 'src/routes/contas.ts', 'migrations/001_contas.sql'],
  seed: CONTAS_SEED,
  tests: [
    {
      name: 'cria uma conta e lê pelo Location',
      sequential: true,
      requests: [
        {
          request: post('/contas', { titular: 'Daniel', saldo_centavos: 7500 }),
          expect: { status: 201, body: { titular: 'Daniel', saldo_centavos: 7500 } },
          save: { onde: 'header.location', id: 'body.id' },
        },
        {
          request: { path: '{{onde}}' },
          expect: { status: 200, body: { id: '{{id}}', titular: 'Daniel', saldo_centavos: 7500 } },
        },
      ],
      db: { sql: 'SELECT titular, saldo_centavos FROM contas WHERE id = $1', params: ['{{id}}'], rows: [{ titular: 'Daniel', saldo_centavos: 7500 }] },
    },
    {
      name: 'lista todas as contas em ordem de id',
      requests: [
        {
          request: { path: '/contas' },
          expect: {
            status: 200,
            body: [
              { id: 1, titular: 'Ana', saldo_centavos: 10000 },
              { id: 2, titular: 'Bruno', saldo_centavos: 5000 },
              { id: 3, titular: 'Carla', saldo_centavos: 0 },
            ],
          },
        },
      ],
    },
    {
      name: 'busca conta por id e rota inexistente responde 404',
      sequential: true,
      requests: [
        { request: { path: '/contas/1' }, expect: { status: 200, body: { id: 1, titular: 'Ana', saldo_centavos: 10000 } } },
        { request: { path: '/contas/999' }, expect: { status: 404, body: { status: 404 } } },
        { request: { path: '/contas/abc' }, expect: { status: 400, body: { status: 400 } } },
        { request: { path: '/contas/9999999999' }, expect: { status: 400, body: { status: 400 } } },
        { request: { path: '/inexistente' }, expect: { status: 404, body: { status: 404 } } },
      ],
    },
    {
      name: 'validação com zod rejeita dados inválidos com 400',
      sequential: true,
      requests: [
        { request: post('/contas', { titular: '', saldo_centavos: -100 }), expect: { status: 400, body: { status: 400 } } },
        { request: post('/contas', { titular: 'Eduardo', saldo_centavos: 10.5 }), expect: { status: 400, body: { status: 400 } } },
        { request: post('/contas', { titular: 'Eduardo', saldo_centavos: 3000000000 }), expect: { status: 400, body: { status: 400 } } },
      ],
      db: { sql: 'SELECT count(*)::int AS n FROM contas', rows: [{ n: 3 }] },
    },
  ],
  checklist: [
    { id: 'sql-parametrizado' },
    { id: 'camadas' },
    { id: 'sem-select-estrela' },
    { id: 'criado-201-location', request: post('/contas', { titular: 'Daniel', saldo_centavos: 7500 }) },
    { id: 'problem-json', request: { path: '/contas/999' } },
    { id: 'validacao-400', request: post('/contas', { titular: '', saldo_centavos: -100 }), fields: ['titular', 'saldo_centavos'] },
  ],
  hints: [
    'Veja como src/routes/health.ts e src/index.ts já estão organizados no projeto: copie o padrão new Hono + app.route; o banco chega em c.env.db. Para padronizar os erros no formato problem+json, use ErroHttp e problema de src/http.ts.',
    'Em src/validacao.ts, defina o schema com z.object({ titular: z.string().trim().min(1), saldo_centavos: z.number().int().min(0).max(2147483647) }) e capture os erros em safeParse (limitar a 2147483647 evita estouro do tipo int no banco).',
    'No Hono, responda c.header("Location", "/contas/" + criada.id) e c.json(criada, 201). Para erros ou rotas de busca, use idDe(c.req.param("id")) e achado(...) importados de src/http.ts.',
  ],
  explanation:
    'Guardar saldo em centavos inteiros elimina erros de arredondamento inerentes a números decimais de ponto flutuante. Validar na borda com Zod impede dados inválidos antes que toquem o banco de dados, e a RFC 9457 (problem+json) oferece uma estrutura consistente de erro para qualquer consumidor da API.',
  reference: { hono: referencia('hono', 1), fetch: referencia('fetch', 1) },
}

const transferencias: Stage = {
  id: 'transferencias',
  title: 'Transferências sem saldo negativo',
  statement: 'Crie POST /transferencias: debite e credite numa transação, sem deixar o saldo negativo, e responda 409 quando o saldo não bastar.',
  steps: PASSOS_TRANSFERENCIAS,
  files: [...contas.files, 'src/db/transferencias.ts', 'src/routes/transferencias.ts', 'migrations/002_transferencias.sql'],
  seed: CONTAS_SEED,
  tests: [
    {
      name: 'transfere valor entre contas e devolve o novo saldo',
      requests: [
        {
          request: post('/transferencias', { de: 1, para: 2, valor_centavos: 3000 }),
          expect: { status: 200, body: { de: 1, para: 2, valor_centavos: 3000, saldo_centavos: 7000 } },
        },
      ],
      db: {
        sql: 'SELECT saldo_centavos FROM contas ORDER BY id',
        rows: [{ saldo_centavos: 7000 }, { saldo_centavos: 8000 }, { saldo_centavos: 0 }],
      },
    },
    {
      name: 'saldo insuficiente responde 409',
      requests: [
        {
          request: post('/transferencias', { de: 3, para: 1, valor_centavos: 100 }),
          expect: { status: 409, body: { status: 409 } },
        },
      ],
      db: {
        sql: 'SELECT saldo_centavos FROM contas ORDER BY id',
        rows: [{ saldo_centavos: 10000 }, { saldo_centavos: 5000 }, { saldo_centavos: 0 }],
      },
    },
    {
      name: 'gasto duplo sequencial não deixa saldo negativo',
      requests: [
        { request: post('/transferencias', { de: 1, para: 2, valor_centavos: 6000 }), expect: { status: 200, body: { saldo_centavos: 4000 } } },
        { request: post('/transferencias', { de: 1, para: 3, valor_centavos: 6000 }), expect: { status: 409, body: { status: 409 } } },
      ],
      db: {
        sql: 'SELECT saldo_centavos FROM contas ORDER BY id',
        rows: [{ saldo_centavos: 4000 }, { saldo_centavos: 11000 }, { saldo_centavos: 0 }],
      },
    },
    {
      name: 'conta inexistente responde 404 e desfaz qualquer débito',
      sequential: true,
      requests: [
        { request: post('/transferencias', { de: 1, para: 999, valor_centavos: 1000 }), expect: { status: 404, body: { status: 404 } } },
        { request: post('/transferencias', { de: 999, para: 1, valor_centavos: 1000 }), expect: { status: 404, body: { status: 404 } } },
      ],
      db: {
        sql: 'SELECT saldo_centavos FROM contas ORDER BY id',
        rows: [{ saldo_centavos: 10000 }, { saldo_centavos: 5000 }, { saldo_centavos: 0 }],
      },
    },
    {
      name: 'dados inválidos ou mesma conta respondem 400',
      sequential: true,
      requests: [
        { request: post('/transferencias', { de: 1, para: 1, valor_centavos: 500 }), expect: { status: 400, body: { status: 400 } } },
        { request: post('/transferencias', { de: 1, para: 2, valor_centavos: -500 }), expect: { status: 400, body: { status: 400 } } },
        { request: post('/transferencias', { de: -1, para: 2, valor_centavos: 500 }), expect: { status: 400, body: { status: 400 } } },
        { request: post('/transferencias', { de: 1, para: 2, valor_centavos: 3000000000 }), expect: { status: 400, body: { status: 400 } } },
      ],
      db: {
        sql: 'SELECT saldo_centavos FROM contas ORDER BY id',
        rows: [{ saldo_centavos: 10000 }, { saldo_centavos: 5000 }, { saldo_centavos: 0 }],
      },
    },
  ],
  checklist: [
    { id: 'transacao' },
    { id: 'saldo-atomico' },
    { id: 'sql-parametrizado' },
    { id: 'camadas' },
    { id: 'sem-select-estrela' },
    { id: 'problem-json', request: post('/transferencias', { de: 3, para: 1, valor_centavos: 100 }) },
    { id: 'validacao-400', request: post('/transferencias', { de: -1, para: -2, valor_centavos: 0 }), fields: ['de', 'para', 'valor_centavos'] },
  ],
  hints: [
    'Crie src/db/transferencias.ts com a função transferir e conecte a rota POST /transferencias em src/routes/transferencias.ts.',
    'Use a cláusula WHERE saldo_centavos >= $1 no próprio UPDATE da conta de origem: se nenhuma linha for modificada (RETURNING vazio), o saldo era insuficiente (409) ou a conta não existe (404).',
    'Dentro de db.transaction(async (tx) => { ... }), se a conta de destino não existir lance um ErroHttp(404, "Conta não encontrada") para abortar a transação e desfazer o débito.',
  ],
  explanation:
    'O banco de dados no navegador (PGlite) executa uma transação por vez na mesma sessão, por isso a condição de corrida é ensinada e validada de forma estática no checklist. ' +
    'Em um PostgreSQL real no nível de isolamento padrão (READ COMMITTED), quando duas transações tentam alterar a mesma linha, a segunda aguarda o lock; quando a primeira conclui (COMMIT), a segunda reavalia a cláusula WHERE sobre a versão mais recente da linha (re-evaluation), fazendo o WHERE saldo_centavos >= $1 falhar se o saldo não for mais suficiente. ' +
    'Além disso, transferências simultâneas em sentidos opostos (A->B e B->A) podem causar deadlock; travar ambas as contas na mesma ordem (por exemplo, ordenando por id com SELECT id FROM contas WHERE id = ANY($1) ORDER BY id FOR UPDATE) elimina o risco de impasse.',
  reference: { hono: referencia('hono', 2), fetch: referencia('fetch', 2) },
}

const pagamentos: Stage = {
  id: 'pagamentos',
  title: 'Pagamento com Idempotency-Key',
  statement: 'Crie POST /pagamentos com Idempotency-Key: a mesma chave e o mesmo valor devolve o pagamento original, e valor diferente responde 422.',
  steps: PASSOS_PAGAMENTOS,
  files: [...transferencias.files, 'src/db/pagamentos.ts', 'src/routes/pagamentos.ts', 'migrations/003_pagamentos.sql'],
  seed: FINTECH_SEED,
  tests: [
    {
      name: 'processa novo pagamento e responde 201',
      requests: [
        {
          request: post('/pagamentos', { valor_centavos: 1500 }, { 'Idempotency-Key': 'pedido-42' }),
          expect: { status: 201, body: { id: 2, valor_centavos: 1500 } },
        },
      ],
      db: { sql: 'SELECT count(*)::int AS n FROM pagamentos', rows: [{ n: 2 }] },
    },
    {
      name: 'mesma chave de idempotência repete resposta sem cobrar novamente',
      requests: [
        {
          request: post('/pagamentos', { valor_centavos: 2500 }, { 'Idempotency-Key': 'pedido-41' }),
          expect: { status: 201, body: { id: 1, valor_centavos: 2500 } },
        },
      ],
      db: { sql: 'SELECT count(*)::int AS n FROM pagamentos', rows: [{ n: 1 }] },
    },
    {
      name: 'mesma chave de idempotência com valor diferente responde 422',
      requests: [
        {
          request: post('/pagamentos', { valor_centavos: 9999 }, { 'Idempotency-Key': 'pedido-41' }),
          expect: { status: 422, body: { status: 422, title: 'Chave de idempotência reutilizada' } },
        },
      ],
      db: { sql: 'SELECT count(*)::int AS n FROM pagamentos', rows: [{ n: 1 }] },
    },
    {
      name: 'replay com a mesma chave cobra apenas uma vez',
      requests: [
        { request: post('/pagamentos', { valor_centavos: 990 }, { 'Idempotency-Key': 'pedido-43' }), expect: { status: 201, body: { id: 2, valor_centavos: 990 } } },
        { request: post('/pagamentos', { valor_centavos: 990 }, { 'Idempotency-Key': 'pedido-43' }), expect: { status: 201, body: { id: 2, valor_centavos: 990 } } },
      ],
      db: { sql: 'SELECT count(*)::int AS n FROM pagamentos', rows: [{ n: 2 }] },
    },
    {
      name: 'sem Idempotency-Key ou valor inválido responde 400',
      sequential: true,
      requests: [
        { request: post('/pagamentos', { valor_centavos: 1000 }), expect: { status: 400, body: { status: 400 } } },
        { request: post('/pagamentos', { valor_centavos: -50 }, { 'Idempotency-Key': 'pedido-44' }), expect: { status: 400, body: { status: 400 } } },
        { request: post('/pagamentos', { valor_centavos: 3000000000 }, { 'Idempotency-Key': 'pedido-45' }), expect: { status: 400, body: { status: 400 } } },
      ],
      db: { sql: 'SELECT count(*)::int AS n FROM pagamentos', rows: [{ n: 1 }] },
    },
  ],
  checklist: [
    { id: 'idempotencia', request: post('/pagamentos', { valor_centavos: 1200 }, { 'Idempotency-Key': 'chave-idemp-check' }), sql: "SELECT id, chave, valor_centavos FROM pagamentos WHERE chave = 'chave-idemp-check'" },
    { id: 'sql-parametrizado' },
    { id: 'camadas' },
    { id: 'sem-select-estrela' },
    { id: 'problem-json', request: post('/pagamentos', { valor_centavos: 1000 }) },
    { id: 'validacao-400', request: post('/pagamentos', { valor_centavos: -50 }, { 'Idempotency-Key': 'pedido-err' }), fields: ['valor_centavos'] },
  ],
  hints: [
    'Obtenha a chave pelo cabeçalho (c.req.header("idempotency-key") no Hono ou req.headers.get("idempotency-key") no fetch puro) em src/routes/pagamentos.ts.',
    'Para evitar concorrência entre requisições simultâneas, use INSERT INTO pagamentos (chave, valor_centavos) VALUES ($1, $2) ON CONFLICT (chave) DO NOTHING RETURNING id, valor_centavos.',
    'Se o INSERT com ON CONFLICT não retornar linhas, a chave já existia: busque o registro com SELECT id, valor_centavos FROM pagamentos WHERE chave = $1. Se o valor_centavos for diferente do recebido, lance ErroHttp(422, "Chave de idempotência reutilizada"); se for igual, devolva o registro existente com 201.',
  ],
  explanation:
    'A restrição UNIQUE no banco aliada ao comando INSERT ... ON CONFLICT DO NOTHING resolve a concorrência na gravação: apenas uma requisição consegue inserir, enquanto a outra consulta o registro existente. ' +
    'Em caso de repetição (replay com a mesma chave e o mesmo valor), a API responde o mesmo status 201 com os dados originais. Isso é o comportamento correto de idempotência: a operação já ocorreu com sucesso e repetir a mesma resposta original tranquiliza o cliente sem cobrar duas vezes.',
  reference: { hono: referencia('hono', 3), fetch: referencia('fetch', 3) },
}

export const cursoBanco: ProjectCourse = {
  baseFiles: { 'src/http.ts': HTTP },
  id: 'banco',
  title: 'API do Banco',
  summary: 'Depois do básico: contas e transferências que não perdem dinheiro, com transações e concorrência.',
  stages: [contas, transferencias, pagamentos],
}
