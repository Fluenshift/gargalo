// Projeto 1 of the Oficina: the E-commerce orders API, in six stages (docs/specs/oficina-projetos.md).
// To plug it in, register `cursoPedidos` where the Projetos screen lists its courses.

import type { RequestSpec, TestStep } from '../exercise'
import type { CheckRef } from './checklist'
import { referencia } from './cursoPedidosRef'
import type { GuidedStep, ProjectCourse, Stage, StepCheck } from './stage'

const post = (path: string, body: unknown, headers?: Record<string, string>): RequestSpec => ({ method: 'POST', path, body, headers })
const bearer = (variable: string) => ({ Authorization: 'Bearer {{' + variable + '}}' })

/** Two products for the stages that need something to sell (ids 1 and 2). */
const PRODUTOS_SEED = "INSERT INTO produtos (nome, preco_centavos) VALUES ('Caneta', 250), ('Caderno', 1500)"
const CATALOGO_SEED = "INSERT INTO produtos (nome, preco_centavos) SELECT 'Produto ' || g, g * 100 FROM generate_series(1, 60) AS g"

const PEDIDO = {
  itens: [
    { produtoId: 1, quantidade: 2 },
    { produtoId: 2, quantidade: 1 },
  ],
}
const SEM_PEDIDOS = {
  sql: 'SELECT (SELECT count(*) FROM pedidos)::int AS pedidos, (SELECT count(*) FROM itens_pedido)::int AS itens',
  rows: [{ pedidos: 0, itens: 0 }],
}
const PRODUTO_RUIM = { nome: '', preco_centavos: -5 }

const cadastro = (email: string) => post('/usuarios', { email, senha: 'segredo123' })
const login = (email: string, senha = 'segredo123') => post('/login', { email, senha })

/** The first user is the admin, the second a client; both log in and keep their tokens as `admin` and `cliente`. */
const USUARIOS: TestStep[] = [
  { request: cadastro('ana@loja.com'), expect: { status: 201, body: { papel: 'admin' } } },
  { request: cadastro('beto@loja.com'), expect: { status: 201, body: { papel: 'cliente' } } },
  { request: login('ana@loja.com'), expect: { status: 200 }, save: { admin: 'body.token' } },
  { request: login('beto@loja.com'), expect: { status: 200 }, save: { cliente: 'body.token' } },
]

const itensDe = (...ids: number[]) => ids.map((id) => ({ id, nome: 'Produto ' + id, preco_centavos: id * 100 }))

// --- Guided steps (issue #137): one concept each, the pattern in code, the docs entry and a check. ---

const HEALTH_OK: StepCheck = { kind: 'request', path: '/health', status: 200, body: { status: 'ok' } }

// Primeiros passos starts from an empty project (only src/env.ts): every file is typed by the player, whole, in order.
// cursoPedidos.test.ts replays these blocks on blank() and expects every check and the stage to pass.
const INDEX_APP = String.raw`import { Hono } from 'hono'
import type { Env } from './env'

// O app recebe toda requisição. Env diz o que chega de fora: o banco.
const app = new Hono<{ Bindings: Env }>()

// O servidor usa o que o arquivo exporta por padrão.
export default app
`
const INDEX_APP_FETCH = String.raw`import type { Env } from './env'

export default {
  // O servidor chama fetch a cada requisição e espera um Response de volta.
  async fetch(req: Request, env: Env): Promise<Response> {
    // Só o caminho da URL: '/ola', sem domínio nem ?query.
    const { pathname } = new URL(req.url)
    // Nenhuma rota ainda: tudo responde 404.
    return Response.json({ erro: 'Rota não encontrada.' }, { status: 404 })
  },
}
`
const INDEX_INLINE = String.raw`import { Hono } from 'hono'
import type { Env } from './env'

const app = new Hono<{ Bindings: Env }>()

// novo: GET /ola responde este JSON. c é o contexto da requisição.
app.get('/ola', (c) => c.json({ mensagem: 'olá' }))

export default app
`
const INDEX_INLINE_FETCH = String.raw`import type { Env } from './env'

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url)
    // novo: uma rota é um if com o método e o caminho.
    if (req.method === 'GET' && pathname === '/ola') return Response.json({ mensagem: 'olá' })
    return Response.json({ erro: 'Rota não encontrada.' }, { status: 404 })
  },
}
`
const OLA = String.raw`import { Hono } from 'hono'
import type { Env } from '../env'

// Um roteador só para /ola; quem escolhe o prefixo é o index.
export const ola = new Hono<{ Bindings: Env }>()

// '/' aqui quer dizer a raiz do roteador: no app, vira GET /ola.
ola.get('/', (c) => c.json({ mensagem: 'olá' }))
`
const OLA_FETCH = String.raw`// Exportada com nome, para o index importar. Sem banco, nada a esperar: sem async.
export function ola(): Response {
  return Response.json({ mensagem: 'olá' })
}
`
const INDEX_ROUTE = String.raw`import { Hono } from 'hono'
import type { Env } from './env'
import { ola } from './routes/ola' // novo: importa o roteador

const app = new Hono<{ Bindings: Env }>()

// novo: tudo que começa com /ola vai para o roteador ola (a linha app.get saiu).
app.route('/ola', ola)

export default app
`
const INDEX_ROUTE_FETCH = String.raw`import type { Env } from './env'
import { ola } from './routes/ola' // novo: importa a função

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url)
    // novo: o if agora só chama a função de src/routes/ola.ts.
    if (req.method === 'GET' && pathname === '/ola') return ola()
    return Response.json({ erro: 'Rota não encontrada.' }, { status: 404 })
  },
}
`
const SAUDE = String.raw`import type { Env } from '../env'

// Todo SQL do projeto mora em src/db/; as rotas só chamam funções como esta.
export async function bancoResponde(db: Env['db']): Promise<void> {
  // A consulta mais simples que existe: se o banco responde, não lança erro.
  await db.query('SELECT 1')
}
`
const HEALTH_ROUTE = String.raw`import { Hono } from 'hono'
import { bancoResponde } from '../db/saude'
import type { Env } from '../env'

export const health = new Hono<{ Bindings: Env }>()

// async porque a rota espera o banco (await) antes de responder.
health.get('/', async (c) => {
  await bancoResponde(c.env.db) // c.env.db é o banco que o jogo entrega
  return c.json({ status: 'ok' })
})
`
const HEALTH_ROUTE_FETCH = String.raw`import { bancoResponde } from '../db/saude'
import type { Env } from '../env'

// async porque a rota espera o banco (await) antes de responder.
export async function health(env: Env): Promise<Response> {
  await bancoResponde(env.db) // env.db é o banco que o jogo entrega
  return Response.json({ status: 'ok' })
}
`
const INDEX_FULL = String.raw`import { Hono } from 'hono'
import type { Env } from './env'
import { health } from './routes/health' // novo
import { ola } from './routes/ola'

const app = new Hono<{ Bindings: Env }>()

app.route('/health', health) // novo
app.route('/ola', ola)

export default app
`
const INDEX_FULL_FETCH = String.raw`import type { Env } from './env'
import { health } from './routes/health' // novo
import { ola } from './routes/ola'

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url)
    if (req.method === 'GET' && pathname === '/health') return health(env) // novo
    if (req.method === 'GET' && pathname === '/ola') return ola()
    return Response.json({ erro: 'Rota não encontrada.' }, { status: 404 })
  },
}
`
const DIGITE = 'Os comentários (// …) explicam o código: digitá-los é opcional.'

const PASSOS_OLA: GuidedStep[] = [
  {
    title: 'Um projeto vazio',
    do: 'Leia o src/env.ts, aberto no editor: é o único arquivo que já vem pronto. Depois clique em Prosseguir.',
    learn:
      'Você vai escrever esta API do zero, um arquivo por vez, e este painel diz o que fazer em cada passo. O src/env.ts só descreve o [Env](env): o que o jogo entrega para sua API, que é o banco Postgres em db. Sem ele, o TypeScript não saberia o que db.query aceita.',
    file: 'src/env.ts',
  },
  {
    title: 'Crie o app: src/index.ts',
    do: 'Clique em Abrir src/index.ts (o arquivo é criado vazio) e digite o código abaixo.',
    learn:
      'Toda requisição entra por src/index.ts. new Hono() cria o [app](hono-app), e o servidor usa o que o arquivo exporta por padrão. Por enquanto o app não tem rota nenhuma.',
    file: 'src/index.ts',
    example: { file: 'src/index.ts', code: INDEX_APP, exact: true, note: DIGITE },
    docs: ['hono-app'],
    check: { kind: 'file', path: 'src/index.ts', contains: ['new Hono<{ Bindings: Env }>()', 'export default app'] },
    byFramework: {
      fetch: {
        learn:
          'Toda requisição entra por src/index.ts, que exporta um objeto com [fetch(req, env)](fetch-app). O servidor chama essa função a cada requisição e espera um Response de volta. Por enquanto, tudo responde 404.',
        example: { file: 'src/index.ts', code: INDEX_APP_FETCH, exact: true, note: DIGITE },
        docs: ['fetch-app'],
        check: { kind: 'file', path: 'src/index.ts', contains: ['async fetch(req: Request, env: Env)', 'new URL(req.url)'] },
      },
    },
  },
  {
    title: 'Sua primeira rota: GET /ola',
    do: 'Em src/index.ts, acrescente a linha marcada com "novo". Depois clique em Testar agora.',
    learn:
      'Uma rota liga um método e um caminho a uma função que responde. [app.get](hono-rotas) registra um GET, e [c.json](hono-json) responde JSON com status 200. Testar agora chama sua API e mostra a resposta na aba Requisição.',
    file: 'src/index.ts',
    example: { file: 'src/index.ts', code: INDEX_INLINE, exact: true },
    docs: ['hono-rotas', 'hono-json'],
    check: { kind: 'request', path: '/ola', status: 200, body: { mensagem: 'olá' } },
    byFramework: {
      fetch: {
        learn:
          'No fetch puro, uma rota é um if: método e caminho. [Response.json](fetch-json) responde JSON com status 200. Testar agora chama sua API e mostra a resposta na aba Requisição.',
        example: { file: 'src/index.ts', code: INDEX_INLINE_FETCH, exact: true },
        docs: ['fetch-rotear', 'fetch-json'],
      },
    },
  },
  {
    title: 'Uma rota por arquivo: src/routes/ola.ts',
    do: 'Clique em Abrir src/routes/ola.ts e digite o código abaixo.',
    learn:
      'Com dezenas de rotas, o index viraria uma lista enorme. Por isso cada recurso ganha seu arquivo em src/routes/, com um roteador próprio exportado com nome. O index só escolhe o prefixo.',
    file: 'src/routes/ola.ts',
    example: { file: 'src/routes/ola.ts', code: OLA, exact: true, note: DIGITE },
    docs: ['hono-route'],
    check: { kind: 'file', path: 'src/routes/ola.ts', contains: ['export const ola', "ola.get('/'"] },
    byFramework: {
      fetch: {
        learn:
          'Com dezenas de rotas, o index viraria uma lista enorme. Por isso cada rota ganha seu arquivo em src/routes/, com uma função exportada com nome que devolve o Response. O index só decide quando chamar.',
        example: { file: 'src/routes/ola.ts', code: OLA_FETCH, exact: true, note: DIGITE },
        docs: ['fetch-json'],
        check: { kind: 'file', path: 'src/routes/ola.ts', contains: ['export function ola', 'Response.json('] },
      },
    },
  },
  {
    title: 'Ligue o arquivo no index',
    do: 'Deixe src/index.ts igual ao código abaixo: importe ola e troque a linha app.get por app.route. Depois clique em Testar agora.',
    learn:
      "O roteador só responde depois de montado no app: [app.route](hono-route)('/ola', ola) soma o prefixo /ola ao '/' do roteador. Esquecer esse passo é a causa mais comum de 404.",
    file: 'src/index.ts',
    example: { file: 'src/index.ts', code: INDEX_ROUTE, exact: true },
    docs: ['hono-route'],
    check: { kind: 'request', path: '/ola', status: 200, body: { mensagem: 'olá' } },
    byFramework: {
      fetch: {
        do: 'Deixe src/index.ts igual ao código abaixo: importe ola e faça o if chamar ola(). Depois clique em Testar agora.',
        learn: 'O index só chama a sua função quando o if casa o método e o caminho. Esquecer o import ou o if é a causa mais comum de 404.',
        example: { file: 'src/index.ts', code: INDEX_ROUTE_FETCH, exact: true },
        docs: ['fetch-rotear'],
      },
    },
  },
  {
    title: 'O banco: src/db/saude.ts',
    do: 'Clique em Abrir src/db/saude.ts e digite o código abaixo.',
    learn:
      'Agora uma rota que usa o banco. O SQL não fica na rota: fica em src/db/, numa função que recebe o banco. Assim a rota cuida só de HTTP, e os testes conferem essa separação.',
    file: 'src/db/saude.ts',
    example: { file: 'src/db/saude.ts', code: SAUDE, exact: true, note: DIGITE },
    docs: ['db-query'],
    check: { kind: 'file', path: 'src/db/saude.ts', contains: ['export async function bancoResponde', "db.query('SELECT 1')"] },
  },
  {
    title: 'A rota /health',
    do: 'Clique em Abrir src/routes/health.ts e digite o código abaixo.',
    learn:
      'Toda API tem um GET /health: balanceadores o chamam para saber se a instância está viva. Esta rota espera o banco responder antes de dizer ok, e se o banco cair, ela falha junto.',
    file: 'src/routes/health.ts',
    example: { file: 'src/routes/health.ts', code: HEALTH_ROUTE, exact: true, note: DIGITE },
    docs: ['hono-rotas', 'env'],
    check: { kind: 'file', path: 'src/routes/health.ts', contains: ['export const health', 'await bancoResponde(c.env.db)'] },
    byFramework: {
      fetch: {
        example: { file: 'src/routes/health.ts', code: HEALTH_ROUTE_FETCH, exact: true, note: DIGITE },
        docs: ['fetch-json', 'env'],
        check: { kind: 'file', path: 'src/routes/health.ts', contains: ['export async function health', 'await bancoResponde(env.db)'] },
      },
    },
  },
  {
    title: 'Ligue /health no index',
    do: 'Acrescente as duas linhas marcadas com "novo" em src/index.ts. Depois clique em Testar agora.',
    learn: 'É o mesmo movimento do /ola: importar e montar no prefixo. Repare que o index continua curto, só ligando caminhos a arquivos.',
    file: 'src/index.ts',
    example: { file: 'src/index.ts', code: INDEX_FULL, exact: true },
    docs: ['hono-route'],
    check: HEALTH_OK,
    byFramework: {
      fetch: {
        learn: 'É o mesmo movimento do /ola: importar e escrever o if. A diferença é que health precisa do env, que o fetch recebe e repassa.',
        example: { file: 'src/index.ts', code: INDEX_FULL_FETCH, exact: true },
        docs: ['fetch-rotear'],
      },
    },
  },
  {
    title: 'Rode os testes da etapa',
    do: 'Clique em Rodar testes, logo abaixo deste quadro.',
    learn:
      'Os testes chamam GET /ola e GET /health num banco novo e conferem as respostas. Se algum falhar, a mensagem diz o que veio e o que era esperado. 404 quer dizer rota não ligada, e 500, erro no código (veja o Console).',
  },
]

const PASSOS_HEALTH: GuidedStep[] = [
  {
    title: 'Por que existe o /health',
    do: 'Clique em Testar agora: o GET /health que você escreveu na etapa anterior deve responder 200.',
    learn:
      'Balanceadores e orquestradores chamam GET /health de tempos em tempos para saber se a instância está viva. A rota faz await bancoResponde(...) antes de responder: se o banco cair, ela falha junto e a instância sai de circulação. Você escreveu essa rota na etapa anterior; confirme que ela ainda responde.',
    file: 'src/routes/health.ts',
    docs: ['db-query'],
    check: HEALTH_OK,
  },
  {
    title: 'Um formato só para erros: problem+json',
    do: 'Leia o exemplo abaixo: é o formato que todo erro da sua API vai ter. Nada para digitar ainda.',
    learn:
      'Hoje cada erro sai de um jeito: o 404 do Hono é texto, e outra rota poderia responder { erro } ou { message }. [problem+json](problem-json) (RFC 9457) é o formato padrão: um Content-Type próprio e um corpo com type, title e status. Com um formato só, o cliente trata qualquer erro do mesmo jeito.',
    example: {
      code: String.raw`// Cabeçalho da resposta: Content-Type: application/problem+json
{
  "type": "about:blank",            // sem página própria sobre este erro
  "title": "Rota não encontrada",   // resumo curto, o mesmo para todo erro deste tipo
  "status": 404,                    // repete o status HTTP no corpo
  "detail": "GET /nada não existe"  // opcional: este caso em particular
}`,
    },
    docs: ['problem-json'],
    byFramework: {
      fetch: {
        learn:
          'Hoje cada erro sai de um jeito: o 404 do starter é { erro }, e outra rota poderia responder { message }. [problem+json](problem-json) (RFC 9457) é o formato padrão: um Content-Type próprio e um corpo com type, title e status. Com um formato só, o cliente trata qualquer erro do mesmo jeito.',
      },
    },
  },
  {
    title: 'Escreva problema() em src/http.ts',
    do: 'Clique em Abrir src/http.ts (o arquivo é criado vazio) e escreva a função problema(status, title, detail?), que devolve o Response de erro.',
    learn:
      'Os erros da API ficam num arquivo só, src/http.ts, e cada rota só chama a função. problema(status, title, detail?) devolve um [Response pronto](response-pronta), que serve no Hono e no fetch puro.',
    file: 'src/http.ts',
    example: {
      file: 'modelo',
      code: String.raw`// Uma função que monta a resposta: quem chama só passa os dados.
export function criado(corpo: unknown, local: string): Response {
  // Response.json(corpo, init): init leva o status e os cabeçalhos.
  return Response.json(corpo, { status: 201, headers: { Location: local } })
}`,
      note: "Escreva problema(status: number, title: string, detail?: string) no mesmo molde: o corpo é { type: 'about:blank', title, status, detail } e o cabeçalho é 'Content-Type': 'application/problem+json'.",
    },
    docs: ['problem-json', 'response-pronta'],
    check: { kind: 'file', path: 'src/http.ts', contains: ['export function problema', "'application/problem+json'"] },
  },
  {
    title: 'Lance erros com ErroHttp',
    do: 'Em src/http.ts, acrescente a classe ErroHttp, com status e title, que estende Error.',
    learn:
      'Às vezes o erro nasce longe da rota, numa função que ela chamou. Em vez de devolver o erro de mão em mão, você o [lança](erro-lancado) com throw, e um lugar só o transforma em resposta. ErroHttp é um Error que carrega o status e o title.',
    file: 'src/http.ts',
    example: {
      file: 'modelo',
      code: String.raw`// Um Error com um campo a mais: quem captura sabe o que aconteceu.
export class ErroDeCampo extends Error {
  campo: string

  constructor(campo: string, mensagem: string) {
    super(mensagem) // a mensagem fica em err.message
    this.campo = campo
  }
}

// Em qualquer lugar: throw new ErroDeCampo('preco', 'Preço negativo')`,
      note: 'Crie ErroHttp em src/http.ts com status e title; o detail opcional vai para super(detail ?? title) e vira err.message.',
    },
    docs: ['erro-lancado'],
    check: { kind: 'file', path: 'src/http.ts', contains: ['export class ErroHttp', 'extends Error'] },
  },
  {
    title: 'Converta qualquer erro: deErro()',
    do: 'Em src/http.ts, acrescente deErro(err): ErroHttp vira problema() com o status dele; qualquer outro erro vira 500.',
    learn:
      'deErro(err) recebe o que foi lançado e devolve a resposta certa. Um ErroHttp vira problema() com o status dele. Qualquer outro erro é um bug: vira 500 sem mostrar detalhes ao cliente, e o detalhe vai para o Console.',
    file: 'src/http.ts',
    example: {
      file: 'modelo',
      code: String.raw`// unknown: um throw pode lançar qualquer coisa.
export function mensagemDe(err: unknown): string {
  // instanceof confere a classe e libera os campos dela.
  if (err instanceof ErroDeCampo) return err.campo + ': ' + err.message
  console.error(err) // inesperado: registre para investigar
  return 'Algo deu errado.'
}`,
      note: "deErro(err: unknown): Response faz igual: ErroHttp vira problema(err.status, err.title, err.message); o resto vira problema(500, 'Erro interno').",
    },
    docs: ['erro-lancado'],
    check: { kind: 'file', path: 'src/http.ts', contains: ['export function deErro', 'instanceof ErroHttp', 'problema(500'] },
  },
  {
    title: 'Ligue os erros no index',
    do: "Em src/index.ts, importe problema e deErro de './http' e ligue os dois: rota não encontrada responde 404 e todo erro lançado passa por deErro.",
    learn:
      'O Hono tem dois ganchos: app.notFound roda quando nenhuma rota casou, e app.onError recebe todo erro lançado numa rota. Ligados às suas funções, todos os erros da API saem em problem+json, sem try/catch em cada rota.',
    file: 'src/index.ts',
    example: {
      file: 'src/index.ts',
      code: String.raw`// Nenhuma rota casou: responda você, em vez do texto padrão do Hono.
app.notFound((c) => c.json({ erro: 'não existe' }, 404))

// Todo throw de dentro de uma rota chega aqui.
app.onError((err, c) => c.json({ erro: err.message }, 500))

export default app // os ganchos vêm antes do export`,
      note: "Importe problema e deErro de './http'. O notFound devolve problema(404, 'Rota não encontrada'); o onError pode receber deErro direto, porque ela já recebe o erro e devolve um Response.",
    },
    docs: ['hono-notfound', 'hono-erros'],
    check: { kind: 'file', path: 'src/index.ts', contains: ['app.notFound(', 'app.onError(', 'deErro'] },
    byFramework: {
      fetch: {
        learn:
          'No fetch puro, o 404 é o return do fim: nenhum if casou. Um try/catch em volta dos ifs pega todo erro lançado numa rota. Assim, todos os erros da API saem em problem+json.',
        example: {
          file: 'src/index.ts',
          code: String.raw`async fetch(req: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(req.url)
  try {
    // return await: sem o await, o erro de uma rota async escapa do catch.
    if (req.method === 'GET' && pathname === '/health') return await health(env)
    return Response.json({ erro: 'não existe' }, { status: 404 }) // nenhum if casou
  } catch (err) {
    return Response.json({ erro: String(err) }, { status: 500 }) // todo throw chega aqui
  }
}`,
          note: "Importe problema e deErro de './http'. O return do fim vira problema(404, 'Rota não encontrada') e o catch devolve deErro(err).",
        },
        docs: ['fetch-rotear', 'erro-lancado'],
        check: { kind: 'file', path: 'src/index.ts', contains: ['problema(404', 'return await', 'catch', 'deErro('] },
      },
    },
  },
  {
    title: 'Teste o 404',
    do: 'Clique em Testar agora: GET /nada deve responder 404 com o corpo em problem+json. Depois, rode os testes da etapa.',
    learn:
      'Peça uma rota que não existe: deve vir 404 com o corpo em problem+json. Abra os headers da resposta: o Content-Type deve ser application/problem+json. Se vier texto ou { erro }, o 404 ainda não passa por problema().',
    docs: ['problem-json'],
    check: { kind: 'request', path: '/nada', status: 404, body: { status: 404 } },
  },
]

const PASSOS_PRODUTOS: GuidedStep[] = [
  {
    title: 'Crie a tabela produtos',
    do: 'Clique em Abrir migrations/001_init.sql, digite o SQL abaixo e clique em Aplicar migrações, no painel Banco.',
    learn:
      'Uma [migração](sql-migracao) é um arquivo SQL que muda o banco, aplicado uma vez e em ordem pelo número do nome. Preço fica em centavos, num inteiro: dinheiro em número com vírgula erra nas contas. O CHECK faz o próprio banco recusar preço negativo.',
    file: 'migrations/001_init.sql',
    example: {
      file: 'migrations/001_init.sql',
      exact: true,
      code: String.raw`CREATE TABLE produtos (
  id serial PRIMARY KEY,           -- o banco numera sozinho: 1, 2, 3…
  nome text NOT NULL,
  preco_centavos int NOT NULL CHECK (preco_centavos >= 0)
);
`,
      note: 'Os comentários (-- …) explicam o SQL: digitá-los é opcional.',
    },
    docs: ['sql-migracao'],
    check: { kind: 'file', path: 'migrations/001_init.sql', contains: ['CREATE TABLE produtos', 'preco_centavos int NOT NULL'] },
  },
  {
    title: 'O que é um CRUD',
    do: 'Leia o exemplo: são as cinco rotas que você vai escrever nesta etapa, com o status de cada uma. Nada para digitar ainda.',
    learn:
      'CRUD são as quatro operações de um recurso: criar, ler, atualizar e apagar. Cada uma é um verbo HTTP mais um caminho, e o [status](status-http) conta o resultado: 201 criou, 204 apagou, 404 não achou. Aqui o recurso é o produto, guardado na tabela produtos.',
    example: {
      code: String.raw`// Recurso de exemplo: categorias.
// POST   /categorias      cria uma           -> 201, com o cabeçalho Location
// GET    /categorias      lista todas        -> 200
// GET    /categorias/7    lê a de id 7       -> 200, ou 404 se não existe
// PUT    /categorias/7    troca os dados     -> 200, ou 404
// DELETE /categorias/7    apaga              -> 204 (sem corpo), ou 404`,
      note: 'No seu caso: troque categorias por produtos; o corpo é { "nome": "Lápis", "preco_centavos": 150 }.',
    },
    docs: ['status-http'],
  },
  {
    title: 'Camada do banco: criarProduto',
    do: 'Clique em Abrir src/db/produtos.ts e escreva criarProduto(db, p): um INSERT em produtos com RETURNING id, nome, preco_centavos.',
    learn:
      'As rotas cuidam de HTTP; o SQL fica em src/db/, uma função por operação, e os testes conferem essa separação. Cada função recebe o db e roda [db.query](db-query), com os valores em $1, $2… e nunca colados no texto do SQL. [RETURNING](returning) devolve a linha gravada, com o id que o banco gerou, numa ida só.',
    file: 'src/db/produtos.ts',
    example: {
      file: 'modelo',
      code: String.raw`import type { Env } from '../env'

type Db = Env['db'] // o tipo do banco que as rotas recebem

export interface Categoria {
  id: number
  nome: string
}

// Recebe o db e os dados; devolve a linha criada.
export async function criarCategoria(db: Db, nome: string): Promise<Categoria> {
  // $1 recebe o valor de params; RETURNING devolve a linha com o id novo.
  const [criada] = await db.query<Categoria>('INSERT INTO categorias (nome) VALUES ($1) RETURNING id, nome', [nome])
  return criada // db.query devolve uma lista; o INSERT gerou uma linha só
}`,
      note: 'No seu caso: a tabela é produtos, a função é criarProduto(db, p) e os campos são nome e preco_centavos; RETURNING devolve id, nome, preco_centavos.',
    },
    docs: ['db-camada', 'db-query', 'returning'],
    check: { kind: 'file', path: 'src/db/produtos.ts', contains: ['export async function criarProduto', 'RETURNING'] },
  },
  {
    title: 'Ler, atualizar e apagar',
    do: 'Em src/db/produtos.ts, acrescente buscarProduto(db, id), listarProdutos(db), atualizarProduto(db, id, p) e removerProduto(db, id).',
    learn:
      'As outras operações seguem o molde. SELECT lista as colunas pelo nome, sem *, para a resposta não vazar uma coluna nova por acidente. UPDATE e DELETE também aceitam RETURNING: se nada voltou, a linha não existia, e a função devolve undefined para a rota responder 404.',
    file: 'src/db/produtos.ts',
    example: {
      file: 'modelo',
      code: String.raw`// SELECT com as colunas por nome; sem linha, a desestruturação dá undefined.
export async function buscarCategoria(db: Db, id: number): Promise<Categoria | undefined> {
  const [achada] = await db.query<Categoria>('SELECT id, nome FROM categorias WHERE id = $1', [id])
  return achada
}

// A lista, em ordem estável.
export function listarCategorias(db: Db): Promise<Categoria[]> {
  return db.query<Categoria>('SELECT id, nome FROM categorias ORDER BY id')
}

// DELETE ... RETURNING: voltou uma linha = existia; voltou nada = undefined.
export async function removerCategoria(db: Db, id: number): Promise<{ id: number } | undefined> {
  const [removida] = await db.query<{ id: number }>('DELETE FROM categorias WHERE id = $1 RETURNING id', [id])
  return removida
}`,
      note: 'No seu caso: escreva buscarProduto(db, id), listarProdutos(db), atualizarProduto(db, id, p) e removerProduto(db, id). O UPDATE tem a forma UPDATE … SET … WHERE id = $n RETURNING … e o produto vem na ordem do id.',
    },
    docs: ['db-colunas', 'returning'],
    check: { kind: 'file', path: 'src/db/produtos.ts', contains: ['buscarProduto', 'listarProdutos', 'atualizarProduto', 'removerProduto'] },
  },
  {
    title: 'idDe e achado em src/http.ts',
    do: 'Em src/http.ts, acrescente idDe(texto), que converte o id da URL ou lança 404, e achado(valor, nome), que lança 404 quando o valor não existe.',
    learn:
      'O id da URL chega como texto: /produtos/abc é um recurso que não existe, e deve dar 404, não 500. idDe(texto) converte e lança 404 se não for um número inteiro. achado(valor, nome) lança 404 quando a consulta devolveu undefined e, senão, devolve o valor. Os dois lançam o [ErroHttp](erro-lancado) do Health, então o onError já responde em problem+json.',
    file: 'src/http.ts',
    example: {
      file: 'modelo',
      code: String.raw`// O número da página vem como texto na URL; texto que não é número vira 400.
export function paginaDe(texto: string): number {
  const n = Number(texto) // Number('abc') é NaN, e Number.isInteger(NaN) é false
  if (!Number.isInteger(n)) throw new ErroHttp(400, 'Página inválida')
  return n
}

// Se a consulta não achou nada (undefined), lança; senão devolve o valor, agora sem o undefined.
export function obrigatorio<T>(valor: T | undefined, mensagem: string): T {
  if (valor === undefined) throw new ErroHttp(404, mensagem)
  return valor
}`,
      note: "No seu caso: idDe(texto: string): number lança ErroHttp(404, 'Recurso não encontrado'); achado<T>(valor: T | undefined, nome: string): T lança ErroHttp(404, nome + ' não encontrado').",
    },
    docs: ['achado-404', 'erro-lancado'],
    check: { kind: 'file', path: 'src/http.ts', contains: ['export function idDe', 'export function achado'] },
  },
  {
    title: 'POST /produtos e a lista',
    do: 'Clique em Abrir src/routes/produtos.ts e escreva as rotas POST /produtos (responde 201 com Location) e GET /produtos (a lista).',
    learn:
      'Um arquivo por recurso: src/routes/produtos.ts cria um roteador, exporta com nome, e o index escolhe o prefixo. O POST lê o [corpo JSON](hono-body), chama a função do banco e responde 201 com o produto. O cabeçalho [Location](hono-header-resposta) diz onde o recurso novo está, e o cliente não precisa adivinhar. GET na raiz devolve a lista.',
    file: 'src/routes/produtos.ts',
    example: {
      file: 'modelo',
      code: String.raw`import { Hono } from 'hono'
import { criarCategoria, listarCategorias } from '../db/categorias'
import type { Env } from '../env'

export const categorias = new Hono<{ Bindings: Env }>()

// GET /categorias: o banco devolve uma lista; c.json responde 200.
categorias.get('/', async (c) => c.json(await listarCategorias(c.env.db)))

categorias.post('/', async (c) => {
  // O corpo chega como JSON; o tipo diz o formato esperado.
  const { nome } = await c.req.json<{ nome: string }>()
  const criada = await criarCategoria(c.env.db, nome)
  // Location: onde achar o recurso novo.
  c.header('Location', '/categorias/' + criada.id)
  // 201 = criado.
  return c.json(criada, 201)
})`,
      note: 'No seu caso: o roteador é produtos, o corpo é { nome, preco_centavos } e as funções vêm de ../db/produtos. A entrada ainda não é validada: isso fica para uma etapa seguinte.',
    },
    docs: ['hono-route', 'hono-body', 'hono-header-resposta', 'hono-json'],
    check: { kind: 'file', path: 'src/routes/produtos.ts', contains: ['export const produtos', 'produtos.post(', '201', 'Location'] },
    byFramework: {
      fetch: {
        learn:
          'Um arquivo por recurso: src/routes/produtos.ts exporta uma função que recebe a requisição e o env e devolve um Response. Ela olha o método: o POST lê o [corpo JSON](fetch-body) e responde 201 com o produto. O cabeçalho [Location](fetch-json) diz onde o recurso novo está. GET sem id devolve a lista.',
        example: {
          file: 'modelo',
          code: String.raw`import { criarCategoria, listarCategorias } from '../db/categorias'
import type { Env } from '../env'
import { problema } from '../http'

// O index chama esta função para todo caminho que começa com /categorias; id vem do /7.
export async function categorias(req: Request, env: Env, id?: string): Promise<Response> {
  // GET /categorias: o banco devolve uma lista; Response.json responde 200.
  if (!id && req.method === 'GET') return Response.json(await listarCategorias(env.db))
  if (!id && req.method === 'POST') {
    // O corpo chega como JSON; o tipo diz o formato esperado.
    const { nome } = (await req.json()) as { nome: string }
    const criada = await criarCategoria(env.db, nome)
    // 201 = criado; Location diz onde achar o recurso novo.
    return Response.json(criada, { status: 201, headers: { Location: '/categorias/' + criada.id } })
  }
  return problema(405, 'Método não permitido')
}`,
          note: 'No seu caso: a função é produtos, o corpo é { nome, preco_centavos } e as funções vêm de ../db/produtos. As rotas com id entram no próximo passo.',
        },
        docs: ['fetch-body', 'fetch-json'],
        check: { kind: 'file', path: 'src/routes/produtos.ts', contains: ['export async function produtos', '201', 'Location'] },
      },
    },
  },
  {
    title: 'Ler, atualizar e apagar por id',
    do: 'Em src/routes/produtos.ts, acrescente GET, PUT e DELETE de /produtos/:id, passando o id por idDe e o resultado do banco por achado.',
    learn:
      'Uma rota com [:id](hono-param) casa qualquer valor naquela posição, e c.req.param("id") devolve texto. Passe o texto por idDe e o resultado do banco por achado: id ruim ou produto sem linha vira 404 sem if na rota. O DELETE responde 204, que por definição [não leva corpo](hono-sem-corpo).',
    file: 'src/routes/produtos.ts',
    example: {
      file: 'modelo',
      code: String.raw`// GET /categorias/7: param é texto; idDe converte e achado lança 404 se não achou.
categorias.get('/:id', async (c) => c.json(achado(await buscarCategoria(c.env.db, idDe(c.req.param('id'))), 'Categoria')))

// PUT /categorias/7: o mesmo caminho com outro verbo; troca os dados.
categorias.put('/:id', async (c) => {
  const { nome } = await c.req.json<{ nome: string }>()
  return c.json(achado(await atualizarCategoria(c.env.db, idDe(c.req.param('id')), nome), 'Categoria'))
})

// DELETE: se não existia, achado lança 404; se existia, 204 sem corpo.
categorias.delete('/:id', async (c) => {
  achado(await removerCategoria(c.env.db, idDe(c.req.param('id'))), 'Categoria')
  return c.body(null, 204)
})`,
      note: "No seu caso: GET, PUT e DELETE de '/:id' em produtos, com 'Produto' no achado; o PUT recebe { nome, preco_centavos }. idDe e achado vêm de '../http'.",
    },
    docs: ['hono-param', 'hono-sem-corpo', 'achado-404'],
    check: {
      kind: 'file',
      path: 'src/routes/produtos.ts',
      contains: ["produtos.get('/:id'", "produtos.put('/:id'", "produtos.delete('/:id'", 'achado(', 'idDe(', '204'],
    },
    byFramework: {
      fetch: {
        learn:
          'No fetch puro, o id chega como terceiro argumento da função. Com id e o método certo, o if escolhe a operação, e idDe e achado cuidam do 404. O DELETE responde 204 com new Response(null, { status: 204 }): 204 não leva [corpo](fetch-sem-corpo).',
        example: {
          file: 'modelo',
          code: String.raw`export async function categorias(req: Request, env: Env, id?: string): Promise<Response> {
  // … os ifs sem id do passo anterior …

  // GET /categorias/7: idDe converte o texto; achado lança 404 se não achou.
  if (id && req.method === 'GET') return Response.json(achado(await buscarCategoria(env.db, idDe(id)), 'Categoria'))
  if (id && req.method === 'PUT') {
    const { nome } = (await req.json()) as { nome: string }
    return Response.json(achado(await atualizarCategoria(env.db, idDe(id), nome), 'Categoria'))
  }
  if (id && req.method === 'DELETE') {
    achado(await removerCategoria(env.db, idDe(id)), 'Categoria') // lança 404 se não existia
    return new Response(null, { status: 204 }) // apagou: sem corpo
  }
  return problema(405, 'Método não permitido')
}`,
          note: "No seu caso: GET, PUT e DELETE com id em produtos, com 'Produto' no achado; o PUT recebe { nome, preco_centavos }. idDe e achado vêm de '../http'.",
        },
        docs: ['fetch-sem-corpo', 'achado-404'],
        check: { kind: 'file', path: 'src/routes/produtos.ts', contains: ["'PUT'", "'DELETE'", 'idDe(', 'achado(', 'status: 204'] },
      },
    },
  },
  {
    title: 'Registre /produtos no index',
    do: "Em src/index.ts, importe as rotas de './routes/produtos' e ligue o caminho /produtos, antes do tratamento de erros.",
    learn:
      'Como no /ola, o roteador só responde depois de montado no app: importe e use app.route com o prefixo. Esquecer esse passo é a causa mais comum de 404, mesmo com o arquivo certo.',
    file: 'src/index.ts',
    example: {
      file: 'src/index.ts',
      code: String.raw`import { categorias } from './routes/categorias' // 1. importe o roteador

app.route('/health', health)
app.route('/categorias', categorias) // 2. monte no prefixo: /categorias, /categorias/7…`,
      note: 'No seu caso: importe produtos de ./routes/produtos e monte em /produtos, antes do notFound e do onError.',
    },
    docs: ['hono-route'],
    check: { kind: 'file', path: 'src/index.ts', contains: ["from './routes/produtos'", "app.route('/produtos', produtos)"] },
    byFramework: {
      fetch: {
        learn:
          'O index precisa mandar /produtos e /produtos/7 para a mesma função, passando o id. Separar o caminho em pedaços resolve: o primeiro é o recurso e o segundo, o id. Mantenha o return await: sem ele, o erro lançado pela rota escapa do catch.',
        example: {
          file: 'src/index.ts',
          code: String.raw`import { categorias } from './routes/categorias' // 1. importe a função

// … dentro do try de fetch(req, env):
    // '/categorias/7'.split('/') é ['', 'categorias', '7']: o primeiro pedaço é vazio.
    const [, recurso, id] = pathname.split('/')
    // 2. um if por recurso; return await deixa o catch pegar o erro lançado.
    if (recurso === 'categorias') return await categorias(req, env, id)`,
          note: 'No seu caso: importe produtos de ./routes/produtos e use recurso === "produtos", junto do if do /health.',
        },
        docs: ['fetch-param', 'fetch-rotear'],
        check: { kind: 'file', path: 'src/index.ts', contains: ["from './routes/produtos'"] },
      },
    },
  },
  {
    title: 'Teste e rode os testes',
    do: 'Clique em Testar agora: GET /produtos/999 deve responder 404 em problem+json. Depois, rode os testes da etapa.',
    learn:
      'Teste à mão na aba Requisição: GET /produtos deve responder 200 com uma lista, e um id que não existe, como GET /produtos/999, deve responder 404 em problem+json. Crie um produto com POST e confira o Location e o 201. Com tudo certo, rode os testes da etapa.',
    docs: ['status-http'],
    check: { kind: 'request', path: '/produtos/999', status: 404, body: { status: 404 } },
  },
]

const PASSOS_PEDIDOS: GuidedStep[] = [
  {
    title: 'Duas tabelas: pedido e itens',
    do: 'Clique em Abrir migrations/002_pedidos.sql, crie as tabelas pedidos e itens_pedido e clique em Aplicar migrações, no painel Banco.',
    learn:
      'Um pedido é um cabeçalho (id, total, data) e várias linhas, os itens. Cada item aponta para o pedido por uma [chave estrangeira](migracao-sql): o banco recusa um item de um pedido que não existe. O item guarda o preco_centavos do momento da compra, porque o catálogo muda e o pedido de ontem não pode mudar de valor.',
    file: 'migrations/002_pedidos.sql',
    example: {
      file: 'modelo',
      code: String.raw`-- O cabeçalho: uma linha por reserva.
CREATE TABLE reservas (
  id serial PRIMARY KEY,                           -- número gerado pelo banco
  total_centavos int NOT NULL DEFAULT 0,
  criada_em timestamptz NOT NULL DEFAULT now()     -- preenchido sozinho
);

-- As linhas: várias por reserva.
CREATE TABLE ingressos (
  id serial PRIMARY KEY,
  reserva_id int NOT NULL REFERENCES reservas (id), -- chave estrangeira: precisa existir
  evento_id int NOT NULL REFERENCES eventos (id),
  quantidade int NOT NULL CHECK (quantidade > 0),   -- o banco recusa 0 ou negativo
  preco_centavos int NOT NULL                       -- o preço copiado na hora da compra
);`,
      note: 'No seu caso: pedidos (id, total_centavos int padrão 0, criado_em) e itens_pedido (id, pedido_id REFERENCES pedidos, produto_id REFERENCES produtos, quantidade, preco_centavos). Salve e aplique a migração na aba Banco.',
    },
    docs: ['migracao-sql'],
    check: { kind: 'file', path: 'migrations/002_pedidos.sql', contains: ['CREATE TABLE pedidos', 'CREATE TABLE itens_pedido', 'REFERENCES pedidos'] },
  },
  {
    title: 'Transação: tudo ou nada',
    do: 'Leia o exemplo: ele mostra como várias escritas viram uma só. Nada para digitar ainda: o próximo passo usa isso.',
    learn:
      'Criar um pedido são várias escritas: o pedido e cada item. Se uma falhar no meio, sobra um pedido pela metade. Uma [transação](db-transaction) junta as escritas: se a função lançar um erro, o banco desfaz todas. Dentro dela use o tx que ela recebe, nunca o db, porque só o tx participa da transação.',
    example: {
      code: String.raw`// A transferência tira de uma conta e põe em outra. As duas escritas vão juntas.
await db.transaction(async (tx) => {
  await tx.query('UPDATE contas SET saldo = saldo - $1 WHERE id = $2', [valor, origem])
  const [destino] = await tx.query<{ id: number }>('SELECT id FROM contas WHERE id = $1', [destinoId])
  // Lançar aqui desfaz o UPDATE de cima, como se nunca tivesse rodado.
  if (!destino) throw new ErroHttp(422, 'Conta de destino não existe')
  await tx.query('UPDATE contas SET saldo = saldo + $1 WHERE id = $2', [valor, destinoId])
})`,
      note: 'No seu caso: as escritas são o INSERT do pedido e um INSERT por item. Ainda não escreva nada: o próximo passo monta a função.',
    },
    docs: ['db-transaction', 'erro-lancado'],
  },
  {
    title: 'criarPedido: cabeçalho e itens',
    do: 'Clique em Abrir src/db/pedidos.ts e escreva criarPedido(db, itens): dentro de db.transaction, insira o pedido e depois cada item, com o preço vindo de produtos.',
    learn:
      'A função recebe os itens ({ produtoId, quantidade }) e devolve o pedido criado. Dentro da transação: insira o pedido, depois percorra os itens e insira cada um. O preço vem de um SELECT em produtos e nunca do corpo, porque quem monta a requisição poderia mentir o preço. Some preço vezes quantidade num total e grave-o no pedido ao final.',
    file: 'src/db/pedidos.ts',
    example: {
      file: 'modelo',
      code: String.raw`export async function criarReserva(db: Db, ingressos: { eventoId: number; quantidade: number }[]): Promise<Reserva> {
  return db.transaction(async (tx) => {
    // 1. O cabeçalho primeiro, para ter o id.
    const [reserva] = await tx.query<{ id: number }>('INSERT INTO reservas DEFAULT VALUES RETURNING id')
    let total = 0
    for (const item of ingressos) {
      // 2. O preço vem do banco, não do cliente.
      const [evento] = await tx.query<{ preco_centavos: number }>('SELECT preco_centavos FROM eventos WHERE id = $1', [item.eventoId])
      // 3. Uma linha por item, com o preço copiado.
      await tx.query('INSERT INTO ingressos (reserva_id, evento_id, quantidade, preco_centavos) VALUES ($1, $2, $3, $4)', [reserva.id, item.eventoId, item.quantidade, evento.preco_centavos])
      total += evento.preco_centavos * item.quantidade
    }
    // 4. Grava o total e devolve a reserva.
    await tx.query('UPDATE reservas SET total_centavos = $1 WHERE id = $2', [total, reserva.id])
    return { id: reserva.id, total_centavos: total }
  })
}`,
      note: 'No seu caso: criarPedido(db, itens) em src/db/pedidos.ts, na tabela itens_pedido, com o preço vindo de produtos. Devolva { id, total_centavos, itens }, com itens = { produto_id, quantidade, preco_centavos }[]. Produto que não existe fica para o próximo passo.',
    },
    docs: ['db-transaction', 'db-query'],
    check: { kind: 'file', path: 'src/db/pedidos.ts', contains: ['export async function criarPedido', 'db.transaction', 'tx.query', 'itens_pedido'] },
  },
  {
    title: 'Produto inexistente: 422 na transação',
    do: 'Em criarPedido, logo depois do SELECT do produto, lance ErroHttp(422) quando ele não existir.',
    learn:
      'Se o SELECT do produto não achou linha, o item é inválido. Lance um [ErroHttp](erro-lancado) 422 de dentro da transação: o banco desfaz o pedido e os itens já gravados, e o onError responde em problem+json. 422 quer dizer "entendi o pedido, mas não consigo processar": o JSON está certo, o produto é que não existe.',
    file: 'src/db/pedidos.ts',
    example: {
      file: 'modelo',
      code: String.raw`const [evento] = await tx.query<{ preco_centavos: number }>('SELECT preco_centavos FROM eventos WHERE id = $1', [item.eventoId])
// Sem linha: lance antes de gravar o item. A transação desfaz a reserva inteira.
if (!evento) throw new ErroHttp(422, 'Evento inexistente', 'O evento ' + item.eventoId + ' não existe.')`,
      note: "No seu caso: logo depois do SELECT do produto, if (!produto) throw new ErroHttp(422, 'Produto inexistente', …). O ErroHttp vem de '../http'.",
    },
    docs: ['erro-lancado', 'status-http'],
    check: { kind: 'file', path: 'src/db/pedidos.ts', contains: ['ErroHttp(422', "from '../http'"] },
  },
  {
    title: 'buscarPedido: duas consultas',
    do: 'Em src/db/pedidos.ts, acrescente buscarPedido(db, id): busque o pedido e, se existir, os itens dele.',
    learn:
      'Ler um pedido junta duas tabelas. Primeiro busque o cabeçalho; sem linha, devolva undefined para a rota responder 404. Depois busque os itens daquele pedido, em ordem, e junte tudo num objeto só.',
    file: 'src/db/pedidos.ts',
    example: {
      file: 'modelo',
      code: String.raw`export async function buscarReserva(db: Db, id: number): Promise<Reserva | undefined> {
  const [reserva] = await db.query<{ id: number; total_centavos: number }>('SELECT id, total_centavos FROM reservas WHERE id = $1', [id])
  if (!reserva) return undefined // sem cabeçalho, não há o que juntar
  // As linhas daquela reserva, na ordem em que foram criadas.
  const ingressos = await db.query<Ingresso>('SELECT evento_id, quantidade, preco_centavos FROM ingressos WHERE reserva_id = $1 ORDER BY id', [id])
  return { ...reserva, ingressos } // copia os campos do cabeçalho e junta as linhas
}`,
      note: 'No seu caso: buscarPedido(db, id) devolve { id, total_centavos, itens }, com itens vindo de itens_pedido (produto_id, quantidade, preco_centavos).',
    },
    docs: ['db-query', 'db-colunas'],
    check: { kind: 'file', path: 'src/db/pedidos.ts', contains: ['export async function buscarPedido', 'FROM itens_pedido'] },
  },
  {
    title: 'As rotas de /pedidos',
    do: 'Clique em Abrir src/routes/pedidos.ts e escreva POST /pedidos (201 com Location) e GET /pedidos/:id (404 quando não existe).',
    learn:
      'São duas rotas, no mesmo molde dos produtos. POST /pedidos recebe { itens: [{ produtoId, quantidade }] }, chama criarPedido e responde 201 com Location; GET /pedidos/:id devolve o pedido, ou 404. O que muda é que o corpo traz uma lista, e o 422 já vem do banco: a rota não precisa de if para ele.',
    file: 'src/routes/pedidos.ts',
    example: {
      file: 'modelo',
      code: String.raw`export const reservas = new Hono<{ Bindings: Env }>()

reservas.post('/', async (c) => {
  // O corpo é um objeto com uma lista: { ingressos: [...] }.
  const { ingressos } = await c.req.json<{ ingressos: { eventoId: number; quantidade: number }[] }>()
  const criada = await criarReserva(c.env.db, ingressos) // pode lançar 422
  c.header('Location', '/reservas/' + criada.id)
  return c.json(criada, 201)
})

reservas.get('/:id', async (c) => c.json(achado(await buscarReserva(c.env.db, idDe(c.req.param('id'))), 'Reserva')))`,
      note: 'No seu caso: o roteador é pedidos, a lista se chama itens e cada item é { produtoId, quantidade }; o nome no achado é Pedido.',
    },
    docs: ['hono-route', 'hono-header-resposta', 'achado-404'],
    check: { kind: 'file', path: 'src/routes/pedidos.ts', contains: ['export const pedidos', 'pedidos.post(', "pedidos.get('/:id'", '201', 'Location'] },
    byFramework: {
      fetch: {
        example: {
          file: 'modelo',
          code: String.raw`export async function reservas(req: Request, env: Env, id?: string): Promise<Response> {
  if (!id && req.method === 'POST') {
    // O corpo é um objeto com uma lista: { ingressos: [...] }.
    const { ingressos } = (await req.json()) as { ingressos: { eventoId: number; quantidade: number }[] }
    const criada = await criarReserva(env.db, ingressos) // pode lançar 422
    return Response.json(criada, { status: 201, headers: { Location: '/reservas/' + criada.id } })
  }
  if (id && req.method === 'GET') return Response.json(achado(await buscarReserva(env.db, idDe(id)), 'Reserva'))
  return problema(405, 'Método não permitido')
}`,
          note: 'No seu caso: a função é pedidos, a lista se chama itens e cada item é { produtoId, quantidade }; o nome no achado é Pedido.',
        },
        docs: ['fetch-json', 'achado-404'],
        check: { kind: 'file', path: 'src/routes/pedidos.ts', contains: ['export async function pedidos', 'buscarPedido', '201', 'Location'] },
      },
    },
  },
  {
    title: 'Registre /pedidos no index',
    do: "Em src/index.ts, importe as rotas de './routes/pedidos' e ligue o caminho /pedidos.",
    learn: 'O roteador de pedidos também precisa ser montado no app, do mesmo jeito que o de produtos. Sem isso, POST /pedidos responde 404.',
    file: 'src/index.ts',
    example: {
      file: 'src/index.ts',
      code: String.raw`import { reservas } from './routes/reservas'

app.route('/categorias', categorias)
app.route('/reservas', reservas) // um roteador por recurso, cada um no seu prefixo`,
      note: 'No seu caso: importe pedidos de ./routes/pedidos e monte em /pedidos.',
    },
    docs: ['hono-route'],
    check: { kind: 'file', path: 'src/index.ts', contains: ["from './routes/pedidos'", "app.route('/pedidos', pedidos)"] },
    byFramework: {
      fetch: {
        learn:
          'O index separa o caminho em recurso e id e escolhe a função pelo recurso. Para pedidos, importe a função e acrescente o if, como fez com produtos.',
        example: {
          file: 'src/index.ts',
          code: String.raw`import { reservas } from './routes/reservas'

// … junto do if das categorias:
    if (recurso === 'reservas') return await reservas(req, env, id) // um if por recurso`,
          note: 'No seu caso: importe pedidos de ./routes/pedidos e use recurso === "pedidos".',
        },
        docs: ['fetch-param'],
        check: { kind: 'file', path: 'src/index.ts', contains: ["from './routes/pedidos'"] },
      },
    },
  },
  {
    title: 'Teste e rode os testes',
    do: 'Clique em Testar agora: GET /pedidos/999 deve responder 404. Depois, rode os testes da etapa.',
    learn:
      'Na aba Requisição, mande POST /pedidos com { "itens": [{ "produtoId": 1, "quantidade": 2 }] }, com os produtos já criados. Confira o 201, o Location e o total. Depois mande um produtoId que não existe: deve vir 422 e nenhum pedido novo na aba Banco. Então rode os testes.',
    docs: ['status-http'],
    check: { kind: 'request', path: '/pedidos/999', status: 404, body: { status: 404 } },
  },
]

const PASSOS_VALIDACAO: GuidedStep[] = [
  {
    title: 'Por que validar na borda',
    do: 'Leia o exemplo: é o 400 que a sua API vai devolver para um corpo inválido. Nada para digitar ainda.',
    learn:
      'O corpo que chega pode ter qualquer coisa: campo faltando, número escrito como texto, lista vazia. Sem validar, isso chega ao banco e vira um 500 sem explicação, ou grava lixo. Validar na borda, na entrada da rota, devolve um [400](status-http) dizendo qual campo errou, e nada é gravado.',
    example: {
      code: String.raw`// POST /categorias com { "nome": "" }
//   sem validar -> grava uma categoria sem nome (ou um 500 do banco)
//   validando   -> 400, a resposta diz qual campo errou, e o banco nem é chamado`,
      note: 'No seu caso: POST /produtos com { "nome": "", "preco_centavos": -1 } deve responder 400 citando os dois campos.',
    },
    docs: ['status-http'],
  },
  {
    title: 'Descreva a entrada com zod',
    do: 'Clique em Abrir src/validacao.ts e escreva produtoSchema e pedidoSchema com z.object.',
    learn:
      '[zod](zod-schema) descreve a forma de um dado e confere, em tempo de execução, se ele tem essa forma. z.object descreve um objeto, e cada campo é um tipo com regras encadeadas, como z.string().min(1). Escreva um schema por entrada da API.',
    file: 'src/validacao.ts',
    example: {
      file: 'modelo',
      code: String.raw`import { z } from 'zod'

// z.object descreve o objeto; cada campo é um tipo com regras encadeadas.
export const categoriaSchema = z.object({
  nome: z.string().min(1),          // texto com pelo menos 1 caractere
  ordem: z.number().int().min(0),   // inteiro, nunca negativo
  tags: z.array(z.string()).min(1), // lista de textos, com pelo menos 1
})`,
      note: 'No seu caso: produtoSchema tem nome (texto, mínimo 1) e preco_centavos (inteiro, mínimo 0); pedidoSchema tem itens, uma lista (mínimo 1) de objetos com produtoId e quantidade, inteiros de no mínimo 1.',
    },
    docs: ['zod-schema'],
    check: { kind: 'file', path: 'src/validacao.ts', contains: ["from 'zod'", 'export const produtoSchema', 'export const pedidoSchema', 'z.object('] },
  },
  {
    title: 'ErroHttp com campos extras',
    do: 'Em src/http.ts, dê ao ErroHttp e ao problema() um último argumento extra, cujos campos entram no corpo da resposta.',
    learn:
      'O 400 precisa dizer quais campos erraram, e um title só não basta. Dê ao ErroHttp um quarto argumento, extra: um objeto cujos campos entram no corpo da resposta. problema() também recebe o extra e o espalha no corpo com o spread, e deErro repassa o err.extra.',
    file: 'src/http.ts',
    example: {
      file: 'modelo',
      code: String.raw`// Um dado a mais no erro: o corpo da resposta ganha esses campos.
export class ErroDeLimite extends Error {
  extra: Record<string, unknown>

  constructor(mensagem: string, extra: Record<string, unknown> = {}) { // = {} deixa opcional
    super(mensagem)
    this.extra = extra
  }
}

// O spread copia cada campo de um objeto para dentro de outro.
const extra = { restante: 0 }
const corpo = { title: 'Limite', status: 429, ...extra } // { title, status, restante }`,
      note: 'No seu caso: ErroHttp(status, title, detail?, extra = {}) guarda this.extra; problema(status, title, detail?, extra = {}) coloca ...extra no corpo; e deErro chama problema(err.status, err.title, err.message, err.extra).',
    },
    docs: ['erro-lancado', 'problem-json'],
    check: { kind: 'file', path: 'src/http.ts', contains: ['...extra', 'err.extra'] },
  },
  {
    title: 'validar(): safeParse e o 400',
    do: 'Em src/validacao.ts, escreva validar(dados, schema): com safeParse, devolve os dados ou lança ErroHttp(400) listando os campos errados.',
    learn:
      '[schema.safeParse(dados)](zod-safeparse) não lança: devolve { success: true, data } ou { success: false, error }. Os campos errados estão em error.issues, cada um com path (onde) e message (o quê). Transforme isso numa lista { campo, mensagem } e lance o ErroHttp 400 levando essa lista em extra.',
    file: 'src/validacao.ts',
    example: {
      file: 'modelo',
      code: String.raw`import { z } from 'zod'

// Devolve o dado já tipado, ou lança um Error listando os problemas.
function conferir<S extends z.ZodType>(dados: unknown, schema: S): z.output<S> {
  const r = schema.safeParse(dados) // não lança: devolve um resultado
  if (r.success) return r.data      // deu certo: data tem o tipo do schema
  // r.error.issues: um item por problema, com path (['nome']) e message.
  const problemas = r.error.issues.map((i) => i.path.join('.') + ': ' + i.message)
  throw new Error(problemas.join('; '))
}`,
      note: "No seu caso: a função se chama validar e não precisa ser exportada. No lugar do Error, lance new ErroHttp(400, 'Dados inválidos', 'Corrija os campos indicados.', { erros }), com erros = issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message })).",
    },
    docs: ['zod-safeparse'],
    check: { kind: 'file', path: 'src/validacao.ts', contains: ['safeParse', 'ErroHttp(400', 'issues', 'campo'] },
  },
  {
    title: 'lerCorpo(req, schema)',
    do: 'Em src/validacao.ts, escreva lerCorpo(req, schema): lê o JSON do corpo (corpo inválido vira undefined) e chama validar.',
    learn:
      'As rotas não vão repetir isso: uma função só lê o corpo e valida. req.json() lança se o corpo não for JSON; troque esse erro por undefined com .catch e deixe o schema recusar. Assim, tudo que chega à rota já foi validado.',
    file: 'src/validacao.ts',
    example: {
      file: 'modelo',
      code: String.raw`// Lê o corpo e confere num passo só; devolve o dado com o tipo do schema.
export async function lerEntrada<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  // .catch troca o erro de JSON inválido por undefined, que o schema também recusa.
  const dados = await req.json().catch(() => undefined)
  return conferir(dados, schema)
}`,
      note: 'No seu caso: lerCorpo(req, schema), usando a função validar do passo anterior. Ela recebe um Request nos dois frameworks (no Hono, c.req.raw).',
    },
    docs: ['zod-safeparse'],
    check: { kind: 'file', path: 'src/validacao.ts', contains: ['export async function lerCorpo', '.catch('] },
    byFramework: {
      hono: { docs: ['zod-safeparse', 'hono-body'] },
      fetch: { docs: ['zod-safeparse', 'fetch-body'] },
    },
  },
  {
    title: 'Valide os produtos',
    do: 'Em src/routes/produtos.ts, troque a leitura crua do corpo por lerCorpo(…, produtoSchema) no POST e no PUT.',
    learn:
      'Troque a leitura crua pela validada: onde havia await c.req.json(), use await lerCorpo(c.req.raw, produtoSchema). Se o corpo for inválido, a função lança antes do banco, e o app.onError que você ligou no Health responde o 400 em problem+json. A rota não ganha nenhum try/catch.',
    file: 'src/routes/produtos.ts',
    example: {
      file: 'modelo',
      code: String.raw`categorias.post('/', async (c) => {
  // Antes: const { nome } = await c.req.json<{ nome: string }>()
  // Agora: valida; se o corpo for ruim, lança 400 aqui e o resto não roda.
  const { nome } = await lerCorpo(c.req.raw, categoriaSchema)
  const criada = await criarCategoria(c.env.db, nome)
  return c.json(criada, 201)
})`,
      note: "No seu caso: o POST e o PUT de produtos usam lerCorpo(c.req.raw, produtoSchema). Importe lerCorpo e produtoSchema de '../validacao'.",
    },
    docs: ['hono-body', 'zod-safeparse'],
    check: { kind: 'file', path: 'src/routes/produtos.ts', contains: ['lerCorpo(', 'produtoSchema'] },
    byFramework: {
      fetch: {
        example: {
          file: 'modelo',
          code: String.raw`if (!id && req.method === 'POST') {
  // Antes: const { nome } = (await req.json()) as { nome: string }
  // Agora: valida; se o corpo for ruim, lança 400 aqui e o resto não roda.
  const { nome } = await lerCorpo(req, categoriaSchema)
  const criada = await criarCategoria(env.db, nome)
  return Response.json(criada, { status: 201, headers: { Location: '/categorias/' + criada.id } })
}`,
          note: "No seu caso: o POST e o PUT de produtos usam lerCorpo(req, produtoSchema). Importe lerCorpo e produtoSchema de '../validacao'.",
        },
        docs: ['fetch-body', 'zod-safeparse'],
      },
    },
  },
  {
    title: 'Valide os pedidos: 400 e 422',
    do: 'Em src/routes/pedidos.ts, troque a leitura crua do corpo por lerCorpo(…, pedidoSchema).',
    learn:
      'Pedidos também: o schema descreve a lista de itens, e uma lista vazia ou uma quantidade 0 vira 400 antes de abrir a transação. O 422 de produto inexistente continua vindo do banco, porque é outro problema: a forma estava certa.',
    file: 'src/routes/pedidos.ts',
    example: {
      code: String.raw`// Forma errada: a validação recusa, na borda.        -> 400
//   { "ingressos": [] }                                   lista vazia
//   { "ingressos": [{ "eventoId": 1, "quantidade": 0 }] } quantidade 0
// Forma certa, mas o evento não existe: o banco recusa.  -> 422
//   { "ingressos": [{ "eventoId": 999, "quantidade": 1 }] }`,
      note: 'No seu caso: em src/routes/pedidos.ts, troque a leitura do corpo por lerCorpo(…, pedidoSchema) e use o resultado como antes.',
    },
    docs: ['status-http', 'zod-schema'],
    check: { kind: 'file', path: 'src/routes/pedidos.ts', contains: ['lerCorpo(', 'pedidoSchema'] },
  },
  {
    title: 'Teste e rode os testes',
    do: 'Clique em Testar agora: o POST /produtos inválido deve responder 400 citando os campos. Depois, rode os testes da etapa.',
    learn:
      'Na aba Requisição, mande POST /produtos com { "nome": "", "preco_centavos": -1 }: deve vir 400 citando os dois campos em erros. Sem corpo nenhum também dá 400, e um corpo válido continua dando 201. Se vier 500, a validação ainda não roda antes do banco.',
    docs: ['problem-json'],
    check: {
      kind: 'request',
      method: 'POST',
      path: '/produtos',
      send: { body: { nome: '', preco_centavos: -1 } },
      status: 400,
      body: { status: 400 },
      before: [{ request: post('/produtos', { nome: 'Lápis', preco_centavos: 150 }), expect: { status: 201 } }],
    },
  },
]

const PASSOS_PAGINACAO: GuidedStep[] = [
  {
    title: 'Por que paginar: o cursor',
    do: 'Leia o exemplo: GET /produtos vai passar a devolver { itens, proximoCursor }. Nada para digitar ainda.',
    learn:
      'Uma lista sem limite cresce com a tabela: com um milhão de produtos, GET /produtos devolveria um milhão. Paginar é devolver um pedaço por vez. Na [paginação por cursor](paginacao-cursor), o cliente diz "me dê N itens depois do id X". Diferente de OFFSET, ela não pula nem repete itens quando alguém cria ou apaga no meio, e custa o mesmo na página 1 e na 1000.',
    example: {
      code: String.raw`// 1ª página:  GET /comentarios?limite=3            -> { itens: [#1, #2, #3], proximoCursor: 3 }
// 2ª página:  GET /comentarios?limite=3&cursor=3   -> { itens: [#4, #5, #6], proximoCursor: 6 }
// Última:     GET /comentarios?limite=3&cursor=9   -> { itens: [#10], proximoCursor: null }
// proximoCursor é o id do último item entregue; null quer dizer que acabou.`,
      note: 'No seu caso: GET /produtos passa a devolver { itens, proximoCursor } em vez de uma lista.',
    },
    docs: ['paginacao-cursor'],
  },
  {
    title: 'A consulta por cursor',
    do: 'Em src/db/produtos.ts, troque listarProdutos por listarProdutos(db, filtro): ids maiores que o cursor, em ordem, com LIMIT de uma linha a mais.',
    learn:
      'A consulta pede só os ids maiores que o cursor, em ordem, com LIMIT. Peça uma linha a mais que o limite: se ela vier, há próxima página, e você devolve só o limite. O proximoCursor é o id do último item devolvido, ou null quando não sobrou nada.',
    file: 'src/db/produtos.ts',
    example: {
      file: 'modelo',
      code: String.raw`export async function listarComentarios(db: Db, cursor: number, limite: number): Promise<{ itens: Comentario[]; proximoCursor: number | null }> {
  // limite + 1: a linha extra só serve para saber se existe próxima página.
  const linhas = await db.query<Comentario>('SELECT id, texto FROM comentarios WHERE id > $1 ORDER BY id LIMIT $2', [cursor, limite + 1])
  const itens = linhas.slice(0, limite) // descarta a linha extra
  return { itens, proximoCursor: linhas.length > limite ? itens[limite - 1].id : null }
}`,
      note: 'No seu caso: substitua listarProdutos em src/db/produtos.ts. Ela recebe (db, filtro), com um objeto filtro que tem cursor e limite (os outros campos entram nos próximos passos), e devolve { itens, proximoCursor }.',
    },
    docs: ['paginacao-cursor', 'db-colunas'],
    check: { kind: 'file', path: 'src/db/produtos.ts', contains: ['WHERE id > $1', 'proximoCursor', 'LIMIT'] },
  },
  {
    title: 'Limite máximo',
    do: 'Em src/db/produtos.ts, crie export const LIMITE_MAX = 50 e use Math.min(filtro.limite, LIMITE_MAX) na consulta.',
    learn:
      'Sem teto, o cliente pede limite=1000000 e a lista volta inteira. Defina uma constante e use Math.min(limite, teto): o menor dos dois vale. O teto fica no módulo do banco, para valer não importa quem chame.',
    file: 'src/db/produtos.ts',
    example: {
      file: 'modelo',
      code: String.raw`export const TETO = 100 // o máximo que qualquer cliente pode pedir

// Math.min devolve o menor: pediu 1000000, leva 100; pediu 5, leva 5.
const limite = Math.min(pedido, TETO)`,
      note: 'No seu caso: export const LIMITE_MAX = 50 e, no começo de listarProdutos, const limite = Math.min(filtro.limite, LIMITE_MAX); use esse limite na consulta.',
    },
    docs: ['paginacao-cursor'],
    check: { kind: 'file', path: 'src/db/produtos.ts', contains: ['LIMITE_MAX = 50', 'Math.min('] },
  },
  {
    title: 'Filtros opcionais numa consulta só',
    do: 'Na mesma consulta, acrescente os filtros q, preco_min e preco_max, cada um valendo tudo quando vier null.',
    learn:
      'q, preco_min e preco_max podem vir ou não. Uma consulta só dá conta: ($2::text IS NULL OR nome ILIKE $2) vale tudo quando o parâmetro é null e filtra quando ele veio. Os valores seguem em params, e o texto de busca ganha % nas pontas para casar um pedaço do nome.',
    file: 'src/db/produtos.ts',
    example: {
      file: 'modelo',
      code: String.raw`// Cada filtro: com o parâmetro NULL a condição é sempre verdadeira; com valor, filtra.
const sql = 'SELECT id, texto FROM comentarios WHERE id > $1 AND ($2::text IS NULL OR autor ILIKE $2) AND ($3::int IS NULL OR nota >= $3) ORDER BY id LIMIT $4'
const params = [cursor, autor ? '%' + autor + '%' : null, notaMin ?? null, limite + 1]
// ILIKE compara sem diferença de maiúsculas; % casa qualquer trecho.`,
      note: 'No seu caso: q filtra nome com ILIKE; preco_min e preco_max filtram preco_centavos com >= e <=. Os filtros que não vieram vão como null.',
    },
    docs: ['filtro-opcional'],
    check: { kind: 'file', path: 'src/db/produtos.ts', contains: ['ILIKE', 'IS NULL OR', 'preco_centavos >='] },
  },
  {
    title: 'Ler a query string com zod',
    do: 'Em src/validacao.ts, escreva listaSchema (com z.coerce) e lerConsulta(req, schema), no molde de lerCorpo.',
    learn:
      'Tudo que vem na URL é texto, até limite=3. [z.coerce.number()](zod-coerce) converte o texto em número antes de validar, e default dá o valor quando o parâmetro não veio. Com min(1) no limite, limite=0 vira 400, como no corpo.',
    file: 'src/validacao.ts',
    example: {
      file: 'modelo',
      code: String.raw`// Query string -> objeto: ?pagina=2&tamanho=10 vira { pagina: '2', tamanho: '10' }, tudo texto.
const params = Object.fromEntries(new URL(req.url).searchParams)

export const paginaSchema = z.object({
  pagina: z.coerce.number().int().min(1).default(1), // '2' vira 2; ausente vira 1
  tamanho: z.coerce.number().int().min(1).default(10),
  busca: z.string().optional(), // opcional: pode ficar undefined
})`,
      note: 'No seu caso: listaSchema com cursor (padrão 0, mínimo 0), limite (padrão 20, mínimo 1), q opcional, e preco_min e preco_max opcionais (inteiros). Escreva também lerConsulta(req, schema), no molde de lerCorpo, mas com os parâmetros da URL no lugar do corpo.',
    },
    docs: ['zod-coerce', 'zod-safeparse'],
    check: {
      kind: 'file',
      path: 'src/validacao.ts',
      contains: ['export const listaSchema', 'z.coerce.number()', 'export function lerConsulta', 'searchParams'],
    },
  },
  {
    title: 'A rota devolve itens e proximoCursor',
    do: 'Em src/routes/produtos.ts, faça o GET da lista chamar listarProdutos com lerConsulta(…, listaSchema).',
    learn:
      'A rota só junta as peças: lê os parâmetros validados e entrega ao banco. O corpo da resposta agora é o objeto { itens, proximoCursor }, que a função do banco já devolve montado. Parâmetro inválido lança 400 antes de chegar ao SQL.',
    file: 'src/routes/produtos.ts',
    example: {
      file: 'modelo',
      code: String.raw`// Lê os parâmetros validados e repassa ao banco; o resultado já é { itens, proximoCursor }.
comentarios.get('/', async (c) => c.json(await listarComentarios(c.env.db, lerConsulta(c.req.raw, paginaSchema))))`,
      note: "No seu caso: listarProdutos(c.env.db, lerConsulta(c.req.raw, listaSchema)). Importe lerConsulta e listaSchema de '../validacao'.",
    },
    docs: ['hono-query', 'zod-coerce'],
    check: { kind: 'file', path: 'src/routes/produtos.ts', contains: ['lerConsulta(', 'listaSchema'] },
    byFramework: {
      fetch: {
        example: {
          file: 'modelo',
          code: String.raw`// Lê os parâmetros validados e repassa ao banco; o resultado já é { itens, proximoCursor }.
if (!id && req.method === 'GET') return Response.json(await listarComentarios(env.db, lerConsulta(req, paginaSchema)))`,
          note: "No seu caso: listarProdutos(db, lerConsulta(req, listaSchema)). Importe lerConsulta e listaSchema de '../validacao'.",
        },
        docs: ['fetch-query', 'zod-coerce'],
      },
    },
  },
  {
    title: 'Teste e rode os testes',
    do: 'Com quatro produtos ou mais cadastrados, clique em Testar agora: GET /produtos?limite=3 deve trazer 3 itens e um proximoCursor. Depois, rode os testes.',
    learn:
      'Com pelo menos quatro produtos cadastrados, GET /produtos?limite=3 deve trazer 3 itens e um proximoCursor. Passe esse valor como cursor= para ver a página seguinte, sem repetir itens. limite=0 deve dar 400. Então rode os testes.',
    docs: ['paginacao-cursor'],
    check: { kind: 'request', path: '/produtos?limite=3', status: 200, body: { proximoCursor: 3 } },
  },
]

const PASSOS_AUTH: GuidedStep[] = [
  {
    title: 'Quem é você? E o que pode?',
    do: 'Leia o exemplo: são as regras de acesso que você vai aplicar nesta etapa. Nada para digitar ainda.',
    learn:
      '[Autenticação](auth-401-403) é provar quem você é; autorização é o que você pode fazer. 401 quer dizer "não sei quem é você" (sem token, token inválido ou vencido), e 403, "sei quem é, mas não pode" (token válido, papel errado). O cliente reage diferente a cada um: 401 pede login, 403 avisa que falta permissão. Aqui há dois papéis: admin escreve em /produtos, e qualquer usuário logado faz pedidos.',
    example: {
      code: String.raw`// POST /categorias  sem Authorization          -> 401  (não sei quem é)
// POST /categorias  com o token de um cliente  -> 403  (sei quem é, mas não pode)
// POST /categorias  com o token de um admin    -> 201  (passou)
// GET  /categorias  (a leitura é pública)      -> 200`,
      note: 'No seu caso: POST, PUT e DELETE de /produtos exigem admin; todas as rotas de /pedidos exigem login; GET /produtos continua público.',
    },
    docs: ['auth-401-403', 'status-http'],
  },
  {
    title: 'A tabela usuarios',
    do: 'Clique em Abrir migrations/003_usuarios.sql, crie a tabela usuarios (e-mail único, papel e senha_hash) e clique em Aplicar migrações.',
    learn:
      'Um usuário tem e-mail único, papel e o hash da senha, nunca a senha. UNIQUE faz o banco recusar um e-mail repetido, e CHECK limita o papel aos valores permitidos. O papel padrão é cliente.',
    file: 'migrations/003_usuarios.sql',
    example: {
      file: 'modelo',
      code: String.raw`CREATE TABLE membros (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,   -- o banco recusa um e-mail que já existe
  senha_hash text NOT NULL,     -- só o hash; a senha nunca é gravada
  nivel text NOT NULL DEFAULT 'comum' CHECK (nivel IN ('comum', 'moderador')) -- só estes valores
);`,
      note: "No seu caso: a tabela é usuarios, a coluna é papel, o padrão é 'cliente' e os valores são 'cliente' e 'admin'. Salve e aplique na aba Banco.",
    },
    docs: ['migracao-sql'],
    check: { kind: 'file', path: 'migrations/003_usuarios.sql', contains: ['CREATE TABLE usuarios', 'UNIQUE', 'senha_hash', 'CHECK'] },
  },
  {
    title: 'Hash da senha com sal',
    do: 'Clique em Abrir src/auth.ts e escreva hashSenha(senha) e confereSenha(senha, guardado).',
    learn:
      'Se o banco vazar, as senhas não podem vazar junto. Um [hash](hash-senha) é uma conta de mão única: dá para conferir uma senha, mas não recuperá-la. O sal, um texto aleatório por usuário, faz senhas iguais terem hashes diferentes. Grave "sal:hash" e, para conferir, refaça o hash com o mesmo sal.',
    file: 'src/auth.ts',
    example: {
      file: 'modelo',
      code: String.raw`const texto = new TextEncoder() // texto -> bytes
const hex = (bytes: ArrayBuffer | Uint8Array) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

// PBKDF2 é um hash feito para ser lento: dificulta adivinhar por força bruta.
async function derivarPin(pin: string, sal: Uint8Array): Promise<string> {
  const chave = await crypto.subtle.importKey('raw', texto.encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: 100_000 }, chave, 256)
  return hex(bits)
}

export async function hashPin(pin: string): Promise<string> {
  const sal = crypto.getRandomValues(new Uint8Array(16)) // aleatório, um por usuário
  return hex(sal) + ':' + (await derivarPin(pin, sal))   // guarda sal e hash juntos
}`,
      note: "No seu caso: hashSenha(senha) e confereSenha(senha, guardado). confereSenha separa o guardado no ':', volta o sal de hex para bytes, refaz o hash e compara com o que estava guardado.",
    },
    docs: ['hash-senha'],
    check: {
      kind: 'file',
      path: 'src/auth.ts',
      contains: ['export async function hashSenha', 'export async function confereSenha', 'PBKDF2', 'getRandomValues'],
    },
  },
  {
    title: 'Cadastro no banco: criarUsuario',
    do: 'Clique em Abrir src/db/usuarios.ts e escreva criarUsuario(db, email, senhaHash) com ON CONFLICT DO NOTHING, devolvendo { id, email, papel }.',
    learn:
      'E-mail repetido deve virar 409, e a forma mais segura de saber é deixar o banco decidir. [ON CONFLICT DO NOTHING](on-conflict) ignora o INSERT que violaria o UNIQUE, e o RETURNING volta vazio: a função devolve undefined e a rota responde 409. Conferir antes com um SELECT deixa uma brecha, porque dois cadastros simultâneos passam os dois.',
    file: 'src/db/usuarios.ts',
    example: {
      file: 'modelo',
      code: String.raw`// Devolve o membro criado, ou undefined se o e-mail já existia.
export async function criarMembro(db: Db, email: string, senhaHash: string): Promise<Membro | undefined> {
  const [membro] = await db.query<Membro>(
    // ON CONFLICT (email) DO NOTHING: em vez de erro, o INSERT é ignorado e RETURNING volta vazio.
    'INSERT INTO membros (email, senha_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING RETURNING id, email, nivel',
    [email, senhaHash],
  )
  return membro
}`,
      note: "No seu caso: criarUsuario(db, email, senhaHash) devolve { id, email, papel }, nunca o senha_hash. O primeiro usuário vira admin: no lugar de um papel fixo, use CASE WHEN EXISTS (SELECT 1 FROM usuarios) THEN 'cliente' ELSE 'admin' END. Escreva também buscarCredenciais(db, email), que devolve ainda o senha_hash, para o login.",
    },
    docs: ['on-conflict', 'db-query'],
    check: {
      kind: 'file',
      path: 'src/db/usuarios.ts',
      contains: ['export async function criarUsuario', 'ON CONFLICT', 'EXISTS', 'export async function buscarCredenciais'],
    },
  },
  {
    title: 'Token assinado: criarToken',
    do: 'Em src/auth.ts, escreva criarToken(usuario), que devolve { token, expiraEm }.',
    learn:
      'Depois do login, o cliente precisa provar quem é a cada requisição sem enviar a senha de novo. O [token](token-assinado) é "dados.assinatura": os dados (id, papel, validade) em base64 e o HMAC deles com um segredo que só o servidor conhece. Quem mexer nos dados não consegue refazer a assinatura. A validade vai dentro dos dados, então o token expira.',
    file: 'src/auth.ts',
    example: {
      file: 'modelo',
      code: String.raw`const SEGREDO = 'troque-isto-em-producao' // só o servidor sabe; em produção vem do ambiente

// HMAC: uma assinatura que só quem tem o segredo sabe calcular.
async function assinar(dados: string): Promise<string> {
  const chave = await crypto.subtle.importKey('raw', texto.encode(SEGREDO), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', chave, texto.encode(dados)))))
}

export async function criarConvite(email: string): Promise<string> {
  const exp = Date.now() + 3_600_000                  // vale por 1 hora, em milissegundos
  const dados = btoa(JSON.stringify({ email, exp }))  // JSON em base64
  return dados + '.' + (await assinar(dados))         // dados.assinatura
}`,
      note: 'No seu caso: criarToken(usuario: { id: number; papel: string }) devolve { token, expiraEm }, com os dados { sub: usuario.id, papel, exp } e expiraEm em ISO (new Date(exp).toISOString()).',
    },
    docs: ['token-assinado'],
    check: { kind: 'file', path: 'src/auth.ts', contains: ['export async function criarToken', 'HMAC', 'expiraEm'] },
  },
  {
    title: 'exigir(): 401 e 403',
    do: 'Em src/auth.ts, escreva exigir(req, papel?): sem token válido lança 401; com o papel errado, 403.',
    learn:
      'exigir(req, papel?) é o porteiro da API. Sem o cabeçalho Authorization: Bearer, com assinatura que não confere ou com token vencido, lança [ErroHttp 401](auth-401-403). Token válido com papel errado lança 403. Se tudo certo, devolve a sessão: quem é o usuário.',
    file: 'src/auth.ts',
    example: {
      file: 'modelo',
      code: String.raw`export async function conferirConvite(req: Request): Promise<{ email: string }> {
  // O cabeçalho vem como 'Bearer <token>': separe nos espaços.
  const [tipo, token] = (req.headers.get('Authorization') ?? '').split(' ')
  if (tipo !== 'Bearer' || !token) throw new ErroHttp(401, 'Envie o convite')
  const [dados, assinatura] = token.split('.')
  // Refaça a assinatura: se não for igual, alguém alterou os dados.
  if (!dados || assinatura !== (await assinar(dados))) throw new ErroHttp(401, 'Convite inválido')
  const convite = JSON.parse(atob(dados)) // lança se o texto for lixo
  if (!(convite.exp > Date.now())) throw new ErroHttp(401, 'Convite vencido')
  return convite
}`,
      note: "No seu caso: exigir(req, papel?: 'admin'). Depois de conferir a validade, se um papel foi pedido e a sessão tem outro, lance ErroHttp(403, 'Sem permissão'). O JSON.parse e o atob podem lançar com lixo: envolva num try/catch e lance 401 'Token inválido'.",
    },
    docs: ['auth-401-403', 'token-assinado'],
    check: { kind: 'file', path: 'src/auth.ts', contains: ['export async function exigir', 'ErroHttp(401', 'ErroHttp(403', 'Bearer'] },
  },
  {
    title: 'Rotas de cadastro e login',
    do: 'Clique em Abrir src/routes/usuarios.ts, escreva POST /usuarios e POST /login, ligue os dois caminhos no index e clique em Testar agora.',
    learn:
      'POST /usuarios valida { email, senha } (senha com 8 caracteres ou mais), grava só o hash e responde 201 com { id, email, papel }; e-mail repetido responde 409. POST /login busca o usuário pelo e-mail, confere a senha e devolve o token. Senha errada e e-mail desconhecido respondem o mesmo 401, para não revelar quais e-mails existem.',
    file: 'src/routes/usuarios.ts',
    example: {
      file: 'modelo',
      code: String.raw`export const membros = new Hono<{ Bindings: Env }>()

membros.post('/', async (c) => {
  const { email, senha } = await lerCorpo(c.req.raw, cadastroSchema) // 400 se inválido
  // Grava só o hash; undefined quer dizer que o e-mail já existia.
  const criado = await criarMembro(c.env.db, email, await hashSenha(senha))
  if (!criado) throw new ErroHttp(409, 'E-mail já cadastrado')
  return c.json(criado, 201) // nunca devolva senha nem hash
})`,
      note: "No seu caso: dois roteadores em src/routes/usuarios.ts, usuarios (POST /usuarios) e login (POST /login: buscarCredenciais, confereSenha, criarToken; qualquer falha é ErroHttp(401, 'Credenciais inválidas')). Antes, escreva cadastroSchema (z.email() e senha z.string().min(8)) e loginSchema em src/validacao.ts; depois registre usuarios e login no index.",
    },
    docs: ['hono-route', 'on-conflict', 'zod-schema'],
    check: {
      kind: 'request',
      method: 'POST',
      path: '/login',
      send: { body: { email: 'ana@loja.com', senha: 'segredo123' } },
      status: 200,
      absent: ['senha', 'senha_hash'],
      before: [
        { request: cadastro('ana@loja.com'), expect: { status: 201, body: { email: 'ana@loja.com', papel: 'admin' }, absent: ['senha', 'senha_hash'] } },
      ],
    },
    byFramework: {
      fetch: {
        example: {
          file: 'modelo',
          code: String.raw`export async function membros(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return problema(405, 'Método não permitido')
  const { email, senha } = await lerCorpo(req, cadastroSchema) // 400 se inválido
  // Grava só o hash; undefined quer dizer que o e-mail já existia.
  const criado = await criarMembro(env.db, email, await hashSenha(senha))
  if (!criado) throw new ErroHttp(409, 'E-mail já cadastrado')
  return Response.json(criado, { status: 201 }) // nunca devolva senha nem hash
}`,
          note: "No seu caso: duas funções em src/routes/usuarios.ts, usuarios (POST /usuarios) e login (POST /login: buscarCredenciais, confereSenha, criarToken; qualquer falha é ErroHttp(401, 'Credenciais inválidas')). Antes, escreva cadastroSchema (z.email() e senha z.string().min(8)) e loginSchema em src/validacao.ts; depois registre os recursos 'usuarios' e 'login' no index.",
        },
        docs: ['fetch-param', 'on-conflict', 'zod-schema'],
      },
    },
  },
  {
    title: 'Proteja as rotas e teste',
    do: 'Chame exigir antes das rotas: admin no POST, PUT e DELETE de produtos, login em todas as de pedidos. Depois clique em Testar agora e rode os testes.',
    learn:
      'Com exigir pronto, proteger é chamá-lo antes do handler. No Hono, um [middleware](hono-middleware) roda antes e, se lançar, o handler nem começa: use("*") vale para todo o roteador, e um soAdmin por rota fica nas escritas de produtos. GET /produtos continua sem token. Depois teste sem token: deve vir 401.',
    file: 'src/routes/produtos.ts',
    example: {
      file: 'modelo',
      code: String.raw`import type { MiddlewareHandler } from 'hono'

// Middleware: roda antes do handler. Se lançar, o handler não roda e o onError responde.
const soAdmin: MiddlewareHandler = async (c, next) => {
  await exigir(c.req.raw, 'admin') // lança 401 ou 403
  await next()                     // tudo certo: segue para o handler
}

// Só esta rota exige admin; as outras ficam como estavam.
categorias.post('/', soAdmin, async (c) => { … })

// use('*') vale para todas as rotas deste roteador.
reservas.use('*', async (c, next) => {
  await exigir(c.req.raw)
  await next()
})`,
      note: "No seu caso: em src/routes/produtos.ts, soAdmin no POST, PUT e DELETE; em src/routes/pedidos.ts, o use('*') com exigir(c.req.raw). Importe exigir de '../auth'.",
    },
    docs: ['hono-middleware', 'auth-401-403'],
    // Ends on a write to produtos with the admin's token: on the dev database "Testar agora" uses, Ana is the first user
    // when the course is followed, while products 1 and 2 (which an order needs) may not exist there.
    check: {
      kind: 'request',
      method: 'POST',
      path: '/produtos',
      send: { body: { nome: 'Lápis', preco_centavos: 150 }, headers: bearer('token') },
      status: 201,
      body: { nome: 'Lápis', preco_centavos: 150 },
      before: [
        { request: cadastro('ana@loja.com'), expect: { status: 201 } },
        { request: login('ana@loja.com'), expect: { status: 200 }, save: { token: 'body.token' } },
        { request: post('/pedidos', PEDIDO), expect: { status: 401 } },
        { request: post('/produtos', { nome: 'Lápis', preco_centavos: 150 }), expect: { status: 401 } },
      ],
    },
    byFramework: {
      fetch: {
        learn:
          'Com exigir pronto, proteger é chamá-lo antes do resto da função da rota: await exigir(req) para exigir login, await exigir(req, "admin") para exigir admin. Se lançar, o resto da função nem roda, e o try/catch do index responde o 401 ou o 403. Em produtos, só as escritas levam a linha, e GET continua sem token. Depois teste sem token: deve vir 401.',
        example: {
          file: 'modelo',
          code: String.raw`export async function categorias(req: Request, env: Env, id?: string): Promise<Response> {
  // Leitura pública: nenhuma linha de exigir.
  if (!id && req.method === 'GET') return Response.json(await listarCategorias(env.db))
  if (!id && req.method === 'POST') {
    await exigir(req, 'admin') // lança 401 ou 403; o que vem abaixo só roda se passou
    // … lê o corpo e cria …
  }
  // … o mesmo nas outras escritas …
}

export async function reservas(req: Request, env: Env, id?: string): Promise<Response> {
  await exigir(req) // toda rota de reservas exige login: uma linha no começo
  // …
}`,
          note: "No seu caso: em src/routes/produtos.ts, exigir(req, 'admin') no POST, PUT e DELETE; em src/routes/pedidos.ts, exigir(req) na primeira linha. Importe exigir de '../auth'.",
        },
        docs: ['auth-401-403', 'erro-lancado'],
      },
    },
  },
]

const primeirosPassos: Stage = {
  id: 'primeiros-passos',
  title: 'Primeiros passos',
  statement: 'Do zero: crie o app, a rota GET /ola, que responde { "mensagem": "olá" }, e o GET /health, que confere o banco.',
  steps: PASSOS_OLA,
  files: ['src/index.ts', 'src/routes/ola.ts', 'src/routes/health.ts', 'src/db/saude.ts', 'src/env.ts'],
  tests: [
    { name: 'GET /ola responde 200 com a mensagem', requests: [{ request: { path: '/ola' }, expect: { status: 200, body: { mensagem: 'olá' } } }] },
    { name: 'GET /health continua respondendo ok', requests: [{ request: { path: '/health' }, expect: { status: 200, body: { status: 'ok' } } }] },
  ],
  checklist: [{ id: 'camadas' }],
  hints: [
    'Siga os passos ao lado na ordem: cada um traz o código inteiro do arquivo. Confira cada passo antes de prosseguir.',
    'Em src/routes/ola.ts exporte um roteador com uma rota GET na raiz que responde JSON; em src/index.ts, app.route("/ola", ola) e app.route("/health", health). No fetch puro, um if para cada caminho.',
    'Hono: export const ola = new Hono<{ Bindings: Env }>() e ola.get("/", (c) => c.json({ mensagem: "olá" })). Fetch puro: Response.json({ mensagem: "olá" }).',
  ],
  explanation:
    'GET /ola é a menor rota possível: sem banco, sem validação. Serve para ver o ciclo completo (criar a rota, registrar, chamar, testar) antes das etapas seguintes, que usam o mesmo caminho com mais regras.',
  reference: { hono: referencia('hono', 0), fetch: referencia('fetch', 0) },
}

const health: Stage = {
  id: 'health',
  title: 'Health check',
  statement: 'Padronize os erros da API em problem+json: crie src/http.ts e faça toda rota desconhecida responder 404 nesse formato.',
  steps: PASSOS_HEALTH,
  files: ['src/index.ts', 'src/routes/health.ts', 'src/db/saude.ts', 'src/env.ts', 'src/http.ts'],
  tests: [
    { name: 'GET /health responde ok', requests: [{ request: { path: '/health' }, expect: { status: 200, body: { status: 'ok' } } }] },
    { name: 'rota que não existe responde 404', requests: [{ request: { path: '/nada' }, expect: { status: 404, body: { status: 404 } } }] },
  ],
  checklist: [{ id: 'camadas' }, { id: 'problem-json', request: { path: '/nada' } }],
  hints: [
    'O /health da etapa anterior já responde. O que falta é o 404: toda rota desconhecida cai no mesmo lugar.',
    'No Hono, app.notFound(() => …) e app.onError(…) cuidam das respostas de erro; no fetch puro, o fim do roteador devolve o 404.',
    "Monte o erro numa função só: Response.json({ type: 'about:blank', title, status }, { status, headers: { 'Content-Type': 'application/problem+json' } }).",
  ],
  explanation:
    'Health check é a primeira rota de toda API: balanceador e orquestrador a chamam para saber se a instância vive e alcança o banco. E um formato de erro único, desde a primeira rota, evita que cada endpoint invente o seu.',
  reference: { hono: referencia('hono', 1), fetch: referencia('fetch', 1) },
}

const produtos: Stage = {
  id: 'produtos',
  title: 'CRUD de produtos',
  statement:
    'Crie o CRUD de produtos: o SQL em src/db/produtos.ts e as rotas em src/routes/produtos.ts, com 201 e Location ao criar, 204 ao apagar e 404 para o que não existe.',
  steps: PASSOS_PRODUTOS,
  files: [...health.files, 'migrations/001_init.sql', 'src/routes/produtos.ts', 'src/db/produtos.ts'],
  seed: PRODUTOS_SEED,
  tests: [
    {
      name: 'cria e lê pelo Location',
      sequential: true,
      requests: [
        {
          request: post('/produtos', { nome: 'Lápis', preco_centavos: 150 }),
          expect: { status: 201, body: { nome: 'Lápis', preco_centavos: 150 } },
          save: { onde: 'header.location', id: 'body.id' },
        },
        { request: { path: '{{onde}}' }, expect: { status: 200, body: { id: '{{id}}', nome: 'Lápis', preco_centavos: 150 } } },
      ],
      db: { sql: 'SELECT nome, preco_centavos FROM produtos WHERE id = $1', params: ['{{id}}'], rows: [{ nome: 'Lápis', preco_centavos: 150 }] },
    },
    {
      name: 'lista os produtos em ordem de id',
      requests: [
        {
          request: { path: '/produtos' },
          expect: {
            status: 200,
            body: [
              { id: 1, nome: 'Caneta', preco_centavos: 250 },
              { id: 2, nome: 'Caderno', preco_centavos: 1500 },
            ],
          },
        },
      ],
    },
    {
      name: 'atualiza um produto',
      requests: [
        {
          request: { method: 'PUT', path: '/produtos/1', body: { nome: 'Caneta azul', preco_centavos: 300 } },
          expect: { status: 200, body: { id: 1, nome: 'Caneta azul', preco_centavos: 300 } },
        },
      ],
      db: { sql: 'SELECT nome, preco_centavos FROM produtos WHERE id = 1', rows: [{ nome: 'Caneta azul', preco_centavos: 300 }] },
    },
    {
      name: 'remove um produto',
      sequential: true,
      requests: [
        { request: { method: 'DELETE', path: '/produtos/1' }, expect: { status: 204 } },
        { request: { path: '/produtos/1' }, expect: { status: 404 } },
      ],
    },
    {
      name: 'produto que não existe responde 404',
      sequential: true,
      requests: [
        { request: { path: '/produtos/999' }, expect: { status: 404 } },
        { request: { method: 'PUT', path: '/produtos/999', body: { nome: 'x', preco_centavos: 1 } }, expect: { status: 404 } },
        { request: { method: 'DELETE', path: '/produtos/999' }, expect: { status: 404 } },
      ],
    },
  ],
  checklist: [
    { id: 'sql-parametrizado' },
    { id: 'camadas' },
    { id: 'sem-select-estrela' },
    { id: 'criado-201-location', request: post('/produtos', { nome: 'Lápis', preco_centavos: 150 }) },
    { id: 'problem-json', request: { path: '/produtos/999' } },
  ],
  hints: [
    'Comece pelo banco: um módulo src/db/produtos.ts com uma função por operação (criar, buscar, listar, atualizar, remover). As rotas só chamam essas funções.',
    'INSERT … RETURNING id, nome, preco_centavos devolve a linha criada numa ida só ao banco; UPDATE e DELETE também aceitam RETURNING, e sem linha de volta o produto não existia (404).',
    "Para o 201: c.header('Location', '/produtos/' + id) e c.json(criado, 201) no Hono; Response.json(criado, { status: 201, headers: { Location } }) no fetch puro. O 204 não leva corpo.",
  ],
  explanation:
    'CRUD é o vocabulário básico de uma API REST: o verbo diz a ação, o status diz o resultado (201 criou, 204 apagou sem devolver nada, 404 não achou) e o Location diz onde o recurso novo está. Manter o SQL em src/db/ deixa as rotas pequenas e o banco fácil de testar.',
  reference: { hono: referencia('hono', 2), fetch: referencia('fetch', 2) },
}

const pedidos: Stage = {
  id: 'pedidos',
  title: 'Pedidos com transação',
  statement:
    'Crie pedidos com itens gravados numa transação: POST /pedidos responde 201 com o total, produto inexistente responde 422 sem gravar nada, e GET /pedidos/:id lê o pedido.',
  steps: PASSOS_PEDIDOS,
  files: [...produtos.files, 'src/routes/pedidos.ts', 'src/db/pedidos.ts', 'migrations/002_pedidos.sql'],
  seed: PRODUTOS_SEED,
  tests: [
    {
      name: 'cria o pedido e calcula o total',
      sequential: true,
      requests: [
        { request: post('/pedidos', PEDIDO), expect: { status: 201, body: { total_centavos: 2000 } }, save: { onde: 'header.location', id: 'body.id' } },
        {
          request: { path: '{{onde}}' },
          expect: {
            status: 200,
            body: {
              id: '{{id}}',
              total_centavos: 2000,
              itens: [
                { produto_id: 1, quantidade: 2, preco_centavos: 250 },
                { produto_id: 2, quantidade: 1, preco_centavos: 1500 },
              ],
            },
          },
        },
      ],
      db: {
        sql: 'SELECT produto_id, quantidade, preco_centavos FROM itens_pedido ORDER BY id',
        rows: [
          { produto_id: 1, quantidade: 2, preco_centavos: 250 },
          { produto_id: 2, quantidade: 1, preco_centavos: 1500 },
        ],
      },
    },
    {
      name: 'produto inexistente desfaz o pedido inteiro',
      requests: [
        {
          request: post('/pedidos', {
            itens: [
              { produtoId: 1, quantidade: 1 },
              { produtoId: 999, quantidade: 1 },
            ],
          }),
          expect: { status: 422 },
        },
      ],
      db: SEM_PEDIDOS,
    },
    { name: 'pedido que não existe responde 404', requests: [{ request: { path: '/pedidos/999' }, expect: { status: 404 } }] },
  ],
  checklist: [
    { id: 'transacao' },
    { id: 'sql-parametrizado' },
    { id: 'camadas' },
    { id: 'sem-select-estrela' },
    { id: 'criado-201-location', request: post('/pedidos', PEDIDO) },
    { id: 'problem-json', request: { path: '/pedidos/999' } },
  ],
  hints: [
    'O pedido tem duas escritas (pedidos e itens_pedido). Se a segunda falhar, a primeira não pode ficar: as duas vão juntas ou nenhuma vai.',
    'db.transaction(async (tx) => { … }) desfaz tudo se a função lançar um erro. Dentro dela use tx.query, nunca db.query.',
    'Para o 422, lance o erro dentro da transação quando o SELECT do produto não achar linha. O preço do item vem desse SELECT, não do pedido do cliente.',
  ],
  explanation:
    'Transação é o que faz um pedido existir inteiro ou não existir. O preço é copiado para o item porque o catálogo muda: o pedido de ontem não pode mudar de valor quando o produto reajusta.',
  reference: { hono: referencia('hono', 3), fetch: referencia('fetch', 3) },
}

const validacao: Stage = {
  id: 'validacao',
  title: 'Validação com zod e problem+json',
  statement:
    'Valide a entrada com zod: corpo inválido em produtos e pedidos responde 400 em problem+json, listando os campos errados, antes de chegar ao banco.',
  steps: PASSOS_VALIDACAO,
  files: [...pedidos.files, 'src/validacao.ts'],
  seed: PRODUTOS_SEED,
  tests: [
    {
      name: 'produto inválido responde 400 com os campos',
      sequential: true,
      requests: [
        { request: post('/produtos', PRODUTO_RUIM), expect: { status: 400, body: { status: 400 } } },
        { request: post('/produtos', { nome: 'Lápis', preco_centavos: 9.5 }), expect: { status: 400 } },
        { request: { method: 'PUT', path: '/produtos/1', body: { nome: 'Caneta' } }, expect: { status: 400 } },
      ],
      db: { sql: 'SELECT count(*)::int AS n FROM produtos', rows: [{ n: 2 }] },
    },
    {
      name: 'pedido inválido responde 400 e não grava nada',
      sequential: true,
      requests: [
        { request: post('/pedidos', { itens: [{ produtoId: 1, quantidade: 0 }] }), expect: { status: 400 } },
        { request: post('/pedidos', { itens: [] }), expect: { status: 400 } },
      ],
      db: SEM_PEDIDOS,
    },
    { name: 'entrada válida continua passando', requests: [{ request: post('/produtos', { nome: 'Lápis', preco_centavos: 150 }), expect: { status: 201 } }] },
    { name: 'o 404 também sai em problem+json', requests: [{ request: { path: '/produtos/999' }, expect: { status: 404, body: { status: 404 } } }] },
  ],
  checklist: [
    { id: 'validacao-400', request: post('/produtos', PRODUTO_RUIM), fields: ['nome', 'preco_centavos'] },
    { id: 'problem-json', request: post('/pedidos', { itens: [] }) },
    { id: 'sql-parametrizado' },
    { id: 'camadas' },
    { id: 'sem-select-estrela' },
    { id: 'transacao' },
  ],
  hints: [
    'Descreva a forma da entrada uma vez: z.object({ nome: z.string().min(1), preco_centavos: z.number().int().min(0) }). Números vindos do JSON são number, não string.',
    'schema.safeParse(corpo) não lança: devolve { success, data } ou { success: false, error }. Os campos errados estão em error.issues, cada um com path e message.',
    'Valide antes de chamar o banco, numa função só (lerCorpo(req, schema)) usada por todas as rotas, e lance o 400 por ali: um app.onError (ou try/catch no fetch puro) o transforma em problem+json.',
  ],
  explanation:
    'Validar na borda faz o erro do cliente virar 400 com a causa, em vez de 500 vindo do banco. O schema também vira a documentação do que a rota aceita, e um formato de erro único deixa o cliente tratar qualquer falha do mesmo jeito.',
  reference: { hono: referencia('hono', 4), fetch: referencia('fetch', 4) },
}

const paginacao: Stage = {
  id: 'paginacao',
  title: 'Paginação e filtros',
  statement: 'Pagine GET /produtos por cursor, com limite máximo e filtros opcionais por nome e preço: a resposta vira { itens, proximoCursor }.',
  steps: PASSOS_PAGINACAO,
  files: [...validacao.files],
  seed: CATALOGO_SEED,
  tests: [
    {
      name: 'páginas por cursor sem pular nem repetir',
      sequential: true,
      requests: [
        {
          request: { path: '/produtos?limite=3' },
          expect: { status: 200, body: { itens: itensDe(1, 2, 3), proximoCursor: 3 } },
          save: { c: 'body.proximoCursor' },
        },
        { request: { path: '/produtos?limite=3&cursor={{c}}' }, expect: { status: 200, body: { itens: itensDe(4, 5, 6), proximoCursor: 6 } } },
      ],
    },
    {
      name: 'a última página não tem próximo cursor',
      requests: [{ request: { path: '/produtos?limite=10&cursor=58' }, expect: { status: 200, body: { itens: itensDe(59, 60), proximoCursor: null } } }],
    },
    {
      name: 'filtra por preço',
      requests: [{ request: { path: '/produtos?preco_min=200&preco_max=300' }, expect: { status: 200, body: { itens: itensDe(2, 3), proximoCursor: null } } }],
    },
    {
      name: 'filtra por nome',
      requests: [{ request: { path: '/produtos?q=produto%206' }, expect: { status: 200, body: { itens: itensDe(6, 60), proximoCursor: null } } }],
    },
    { name: 'limite inválido responde 400', requests: [{ request: { path: '/produtos?limite=0' }, expect: { status: 400 } }] },
  ],
  checklist: [
    { id: 'paginacao-cursor', path: '/produtos?limite=1000', max: 50 },
    { id: 'problem-json', request: { path: '/produtos?limite=0' } },
    { id: 'sql-parametrizado' },
    { id: 'camadas' },
    { id: 'sem-select-estrela' },
  ],
  hints: [
    'Cursor é "o id do último item que você viu": WHERE id > $1 ORDER BY id LIMIT n. Diferente de OFFSET, não pula nem repete itens quando alguém cria ou apaga no meio.',
    'Leia uma linha a mais que o limite: se ela veio, existe próxima página, e o cursor é o id do último item que você devolve.',
    'Filtros opcionais cabem numa consulta só: ($2::text IS NULL OR nome ILIKE $2). Limite o tamanho com Math.min(limite, 50) no módulo do banco, e converta os parâmetros com z.coerce.number().',
  ],
  explanation:
    'Sem limite máximo, um pedido de um milhão de linhas derruba o banco. O cursor mantém a página estável e custa o mesmo na página 1 e na 1000, o que OFFSET não faz.',
  reference: { hono: referencia('hono', 5), fetch: referencia('fetch', 5) },
}

const auth: Stage = {
  id: 'auth',
  title: 'Autenticação',
  statement:
    'Proteja a API: cadastro e login com senha em hash e token assinado, só admin escreve em produtos, pedidos exigem login, e a falta de token ou permissão responde 401 ou 403.',
  steps: PASSOS_AUTH,
  files: [...paginacao.files, 'src/auth.ts', 'src/db/usuarios.ts', 'src/routes/usuarios.ts', 'migrations/003_usuarios.sql'],
  seed: PRODUTOS_SEED,
  tests: [
    {
      name: 'o primeiro cadastro é admin e e-mail repetido responde 409',
      sequential: true,
      requests: [
        { request: cadastro('ana@loja.com'), expect: { status: 201, body: { email: 'ana@loja.com', papel: 'admin' } } },
        { request: cadastro('beto@loja.com'), expect: { status: 201, body: { papel: 'cliente' } } },
        { request: cadastro('ana@loja.com'), expect: { status: 409 } },
      ],
    },
    {
      name: 'login devolve token e senha errada responde 401',
      sequential: true,
      requests: [
        { request: cadastro('ana@loja.com'), expect: { status: 201 } },
        { request: login('ana@loja.com'), expect: { status: 200 } },
        { request: login('ana@loja.com', 'senha-errada'), expect: { status: 401 } },
        { request: login('ninguem@loja.com'), expect: { status: 401 } },
      ],
    },
    {
      name: 'escrever em produtos: sem token 401, cliente 403, admin passa',
      sequential: true,
      requests: [
        ...USUARIOS,
        { request: post('/produtos', { nome: 'Lápis', preco_centavos: 150 }), expect: { status: 401 } },
        { request: post('/produtos', { nome: 'Lápis', preco_centavos: 150 }, bearer('cliente')), expect: { status: 403 } },
        { request: { method: 'DELETE', path: '/produtos/1', headers: bearer('cliente') }, expect: { status: 403 } },
        { request: post('/produtos', { nome: 'Lápis', preco_centavos: 150 }, bearer('admin')), expect: { status: 201 } },
        { request: { path: '/produtos/1' }, expect: { status: 200 } },
      ],
    },
    {
      name: 'pedido exige login',
      sequential: true,
      requests: [
        ...USUARIOS,
        { request: post('/pedidos', PEDIDO), expect: { status: 401 } },
        { request: post('/pedidos', PEDIDO, bearer('cliente')), expect: { status: 201, body: { total_centavos: 2000 } }, save: { onde: 'header.location' } },
        { request: { path: '{{onde}}', headers: bearer('cliente') }, expect: { status: 200 } },
        { request: { path: '{{onde}}' }, expect: { status: 401 } },
      ],
    },
    { name: 'cadastro inválido responde 400', requests: [{ request: post('/usuarios', { email: 'ruim', senha: '1' }), expect: { status: 400 } }] },
  ],
  checklist: [
    { id: 'senha-hash', request: cadastro('ana@loja.com'), password: 'segredo123', sql: 'SELECT * FROM usuarios' },
    {
      id: 'auth-401-403',
      before: USUARIOS,
      anonymous: post('/produtos', { nome: 'Lápis', preco_centavos: 150 }),
      forbidden: post('/produtos', { nome: 'Lápis', preco_centavos: 150 }, bearer('cliente')),
    },
    { id: 'sem-vazar-campos', requests: [cadastro('ana@loja.com'), login('ana@loja.com')], fields: ['senha', 'senha_hash'] },
    { id: 'validacao-400', request: post('/usuarios', { email: 'ruim', senha: '1' }), fields: ['email', 'senha'] },
    { id: 'problem-json', request: login('ninguem@loja.com') },
    { id: 'sql-parametrizado' },
    { id: 'camadas' },
    { id: 'sem-select-estrela' },
  ] as CheckRef[],
  hints: [
    'Senha nunca vai para o banco como veio. Derive um hash com crypto.subtle (importKey + deriveBits com PBKDF2), com um sal aleatório por usuário, e grave sal e hash.',
    'O token é "dados.assinatura": um JSON com o id, o papel e a expiração, e a assinatura HMAC dele com um segredo só do servidor. Para validar, refaça a assinatura e confira a expiração.',
    '401 é "quem é você?" (sem token, token inválido ou vencido); 403 é "sei quem é, mas não pode" (token válido, papel errado). Faça a checagem num lugar só, antes do handler: no Hono, um middleware.',
  ],
  explanation:
    'Autenticação responde "quem é você?" e autorização responde "o que você pode?": 401 e 403 existem para o cliente reagir diferente a cada um. O hash com sal protege as senhas se o banco vazar, e o token que expira limita o estrago se ele vazar.',
  reference: { hono: referencia('hono', 6), fetch: referencia('fetch', 6) },
}

export const cursoPedidos: ProjectCourse = {
  id: 'ecommerce',
  title: 'API de pedidos do E-commerce',
  summary: 'Para começar: um projeto vazio, guiado passo a passo, da primeira rota a pedidos, validação e login.',
  stages: [primeirosPassos, health, produtos, pedidos, validacao, paginacao, auth],
  blank: true,
}
