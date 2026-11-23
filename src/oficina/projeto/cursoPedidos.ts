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

const PEDIDO = { itens: [{ produtoId: 1, quantidade: 2 }, { produtoId: 2, quantidade: 1 }] }
const SEM_PEDIDOS = { sql: 'SELECT (SELECT count(*) FROM pedidos)::int AS pedidos, (SELECT count(*) FROM itens_pedido)::int AS itens', rows: [{ pedidos: 0, itens: 0 }] }
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

const PASSOS_OLA: GuidedStep[] = [
  {
    title: 'Conheça a tela',
    learn:
      'À esquerda ficam os arquivos do projeto; embaixo, o Banco (tabelas e migrações) e o Console (o que sua API registrou). Aqui à direita, a aba Requisição chama sua API como um navegador faria, e Rodar testes confere a etapa e dá até 3 estrelas. O projeto já responde GET /health: clique em Testar agora para ver.',
    check: HEALTH_OK,
  },
  {
    title: 'A porta de entrada: src/index.ts',
    learn:
      'Toda requisição entra por src/index.ts. Lá, new Hono() cria o [app](hono-app) e app.route liga cada caminho ao arquivo que cuida dele. Um arquivo por recurso deixa o index curto e fácil de ler.',
    file: 'src/index.ts',
    example: {
      file: 'src/index.ts',
      code: String.raw`import { Hono } from 'hono'
import type { Env } from './env'
import { health } from './routes/health' // o roteador de /health, em outro arquivo

// O app recebe toda requisição. Env diz o que chega de fora: o banco.
const app = new Hono<{ Bindings: Env }>()

// Tudo que começa com /health vai para o roteador health.
app.route('/health', health)

// O servidor usa o que o arquivo exporta por padrão.
export default app`,
    },
    docs: ['hono-app', 'hono-route'],
    byFramework: {
      fetch: {
        learn:
          'Toda requisição entra por src/index.ts, que exporta um objeto com [fetch(req, env)](fetch-app): o servidor chama essa função e espera um Response de volta. Lá, um if por rota olha o método e o caminho e chama a função certa.',
        example: {
          file: 'src/index.ts',
          code: String.raw`import type { Env } from './env'
import { health } from './routes/health' // a função de /health, em outro arquivo

export default {
  // Chamada a cada requisição; precisa devolver um Response.
  async fetch(req: Request, env: Env): Promise<Response> {
    // Só o caminho da URL: '/health', sem domínio nem ?query.
    const { pathname } = new URL(req.url)
    // Uma rota é um if: método, caminho e a função que responde.
    if (req.method === 'GET' && pathname === '/health') return health(env)
    // Nenhum if casou.
    return Response.json({ erro: 'Rota não encontrada.' }, { status: 404 })
  },
}`,
        },
        docs: ['fetch-app', 'fetch-rotear'],
      },
    },
  },
  {
    title: 'Leia a rota /health',
    learn:
      'Uma rota recebe a requisição e devolve uma resposta. Repare que o SQL não está aqui: a rota chama src/db/saude.ts. Rotas cuidam de HTTP e src/db/ cuida do banco; os testes conferem essa separação.',
    file: 'src/routes/health.ts',
    example: {
      file: 'src/routes/health.ts',
      code: String.raw`import { Hono } from 'hono'
import { bancoResponde } from '../db/saude'
import type { Env } from '../env'

// Um roteador só para /health; o index escolhe o prefixo.
export const health = new Hono<{ Bindings: Env }>()

// GET na raiz do roteador = GET /health. c é o contexto da requisição.
health.get('/', async (c) => {
  // O SQL fica em src/db/; a rota só chama. c.env.db é o banco.
  await bancoResponde(c.env.db)
  // c.json responde JSON, com status 200.
  return c.json({ status: 'ok' })
})`,
      note: 'A sua rota /ola tem a mesma forma, mais simples: não usa o banco, então não precisa de async nem de await.',
    },
    docs: ['hono-rotas', 'hono-json'],
    byFramework: {
      fetch: {
        example: {
          file: 'src/routes/health.ts',
          code: String.raw`import { bancoResponde } from '../db/saude'
import type { Env } from '../env'

// Uma função por rota: o index chama quando o caminho casa.
export async function health(env: Env): Promise<Response> {
  // O SQL fica em src/db/; a rota só chama. env.db é o banco.
  await bancoResponde(env.db)
  // Response.json responde JSON, com status 200.
  return Response.json({ status: 'ok' })
}`,
          note: 'A sua rota /ola tem a mesma forma, mais simples: não usa o banco, então não precisa de async, await nem env.',
        },
        docs: ['fetch-json'],
      },
    },
  },
  {
    title: 'Crie src/routes/ola.ts',
    learn:
      'Cada recurso ganha seu arquivo em src/routes/. O arquivo cria um roteador (outro new Hono) e exporta com nome; quem decide o caminho completo é o index.',
    file: 'src/routes/ola.ts',
    example: {
      file: 'modelo',
      code: String.raw`import { Hono } from 'hono'
import type { Env } from '../env'

// Exportado com nome, para o index importar: import { versao } from './routes/versao'
export const versao = new Hono<{ Bindings: Env }>()

// Sem banco, a resposta sai na hora: sem async, sem await.
versao.get('/', (c) => c.json({ versao: '1.0' }))`,
      note: "No seu caso: o arquivo é src/routes/ola.ts, o roteador se chama ola e o objeto é { mensagem: 'olá' }.",
    },
    docs: ['hono-rotas', 'hono-json'],
    check: { kind: 'file', path: 'src/routes/ola.ts', contains: ['export const ola', "ola.get('/'"] },
    byFramework: {
      fetch: {
        learn: 'Cada recurso ganha seu arquivo em src/routes/. O arquivo exporta com nome uma função que devolve o Response; quem decide o caminho é o index.',
        example: {
          file: 'modelo',
          code: String.raw`// Exportada com nome, para o index importar: import { versao } from './routes/versao'
// Sem banco, nada a esperar: sem async, devolve o Response direto.
export function versao(): Response {
  return Response.json({ versao: '1.0' })
}`,
          note: "No seu caso: o arquivo é src/routes/ola.ts, a função se chama ola e o objeto é { mensagem: 'olá' }.",
        },
        docs: ['fetch-json'],
        check: { kind: 'file', path: 'src/routes/ola.ts', contains: ['export function ola', 'Response.json('] },
      },
    },
  },
  {
    title: 'Registre a rota no index',
    learn:
      "O roteador só responde depois de montado no app: app.route('/ola', ola) soma o prefixo /ola ao '/' do roteador. Esquecer esse passo é a causa mais comum de 404.",
    file: 'src/index.ts',
    example: {
      file: 'src/index.ts',
      code: String.raw`import { health } from './routes/health'
import { versao } from './routes/versao' // 1. importe o roteador

const app = new Hono<{ Bindings: Env }>()

app.route('/health', health)
app.route('/versao', versao) // 2. monte no prefixo: agora GET /versao responde`,
      note: "Faça o mesmo com ola: importe de './routes/ola' e monte em '/ola'.",
    },
    docs: ['hono-route'],
    check: { kind: 'file', path: 'src/index.ts', contains: ["from './routes/ola'", "app.route('/ola', ola)"] },
    byFramework: {
      fetch: {
        learn: 'O index só chama a sua função quando um if casa o método e o caminho. Ponha o if novo antes do return do fim: depois dele, nada mais roda.',
        example: {
          file: 'src/index.ts',
          code: String.raw`import { health } from './routes/health'
import { versao } from './routes/versao' // 1. importe a função

// … dentro de fetch(req, env):
    if (req.method === 'GET' && pathname === '/health') return health(env)
    if (req.method === 'GET' && pathname === '/versao') return versao() // 2. um if por rota
    return Response.json({ erro: 'Rota não encontrada.' }, { status: 404 })`,
          note: "Faça o mesmo com ola: importe de './routes/ola' e escreva o if de GET /ola.",
        },
        docs: ['fetch-rotear'],
        check: { kind: 'file', path: 'src/index.ts', contains: ["from './routes/ola'", "pathname === '/ola'"] },
      },
    },
  },
  {
    title: 'Teste a sua rota',
    learn:
      'Teste à mão antes dos testes automáticos: o erro aparece mais cedo e mais claro. 404 quer dizer que a rota não foi registrada; 500, que o código lançou um erro (veja o Console). Com 200 e a mensagem, rode os testes da etapa.',
    check: { kind: 'request', path: '/ola', status: 200, body: { mensagem: 'olá' } },
  },
]

const PASSOS_HEALTH: GuidedStep[] = [
  {
    title: 'Por que existe o /health',
    learn:
      'Balanceadores e orquestradores chamam GET /health de tempos em tempos para saber se a instância está viva. A rota faz await bancoResponde(...) antes de responder: se o banco cair, ela falha junto e a instância sai de circulação. O starter já tem essa rota; confirme que ela responde.',
    file: 'src/routes/health.ts',
    docs: ['db-query'],
    check: HEALTH_OK,
  },
  {
    title: 'Um formato só para erros: problem+json',
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
    learn:
      'Peça uma rota que não existe: deve vir 404 com o corpo em problem+json. Abra os headers da resposta: o Content-Type deve ser application/problem+json. Se vier texto ou { erro }, o 404 ainda não passa por problema().',
    docs: ['problem-json'],
    check: { kind: 'request', path: '/nada', status: 404, body: { status: 404 } },
  },
]

const primeirosPassos: Stage = {
  id: 'primeiros-passos',
  title: 'Primeiros passos',
  statement: 'Conheça a tela e o projeto inicial, depois crie sua primeira rota: GET /ola, que responde 200 com { "mensagem": "olá" }.',
  steps: PASSOS_OLA,
  files: ['src/index.ts', 'src/routes/ola.ts', 'src/env.ts', 'migrations/001_init.sql'],
  tests: [
    { name: 'GET /ola responde 200 com a mensagem', requests: [{ request: { path: '/ola' }, expect: { status: 200, body: { mensagem: 'olá' } } }] },
    { name: 'GET /health continua respondendo ok', requests: [{ request: { path: '/health' }, expect: { status: 200, body: { status: 'ok' } } }] },
  ],
  checklist: [{ id: 'camadas' }],
  hints: [
    'Abra src/routes/health.ts: sua rota nova é parecida. Crie src/routes/ola.ts e registre-a em src/index.ts.',
    'Em src/routes/ola.ts exporte um roteador com uma rota GET na raiz que responde JSON; em src/index.ts, app.route("/ola", ola). No fetch puro, um if para o caminho /ola.',
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
  files: ['src/index.ts', 'src/routes/health.ts', 'src/db/saude.ts', 'src/env.ts', 'src/http.ts', 'migrations/001_init.sql'],
  tests: [
    { name: 'GET /health responde ok', requests: [{ request: { path: '/health' }, expect: { status: 200, body: { status: 'ok' } } }] },
    { name: 'rota que não existe responde 404', requests: [{ request: { path: '/nada' }, expect: { status: 404, body: { status: 404 } } }] },
  ],
  checklist: [{ id: 'camadas' }, { id: 'problem-json', request: { path: '/nada' } }],
  hints: [
    'O starter já responde /health. O que falta é o 404: toda rota desconhecida cai no mesmo lugar.',
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
    'As rotas ficam em src/routes/produtos.ts e o SQL em src/db/produtos.ts (uma função por operação). As rotas só cuidam de HTTP; o banco fica em src/db/.\n' +
    '1. Crie src/db/produtos.ts com funções criarProduto, buscarProduto, listarProdutos, atualizarProduto e removerProduto. Use INSERT … RETURNING, SELECT com colunas explícitas (id, nome, preco_centavos) e DELETE/UPDATE … RETURNING para saber se a linha existia.\n' +
    '2. Crie src/routes/produtos.ts com as rotas: POST /produtos cria e responde 201 com o cabeçalho Location (/produtos/:id) e o produto no corpo; GET /produtos lista em ordem de id; GET /produtos/:id lê; PUT /produtos/:id atualiza (200); DELETE /produtos/:id remove (204). Produto inexistente responde 404 problem+json.\n' +
    '3. Registre em src/index.ts: no Hono, app.route("/produtos", produtos); no fetch puro, desvie pelo pathname e passe o id como parâmetro.\n' +
    '4. Teste na aba Requisição: POST /produtos com { "nome": "Lápis", "preco_centavos": 150 } deve responder 201 com Location.\n' +
    '5. Clique em Rodar testes.',
  files: [...health.files, 'src/routes/produtos.ts', 'src/db/produtos.ts'],
  seed: PRODUTOS_SEED,
  tests: [
    {
      name: 'cria e lê pelo Location',
      sequential: true,
      requests: [
        { request: post('/produtos', { nome: 'Lápis', preco_centavos: 150 }), expect: { status: 201, body: { nome: 'Lápis', preco_centavos: 150 } }, save: { onde: 'header.location', id: 'body.id' } },
        { request: { path: '{{onde}}' }, expect: { status: 200, body: { id: '{{id}}', nome: 'Lápis', preco_centavos: 150 } } },
      ],
      db: { sql: 'SELECT nome, preco_centavos FROM produtos WHERE id = $1', params: ['{{id}}'], rows: [{ nome: 'Lápis', preco_centavos: 150 }] },
    },
    {
      name: 'lista os produtos em ordem de id',
      requests: [{ request: { path: '/produtos' }, expect: { status: 200, body: [{ id: 1, nome: 'Caneta', preco_centavos: 250 }, { id: 2, nome: 'Caderno', preco_centavos: 1500 }] } }],
    },
    {
      name: 'atualiza um produto',
      requests: [{ request: { method: 'PUT', path: '/produtos/1', body: { nome: 'Caneta azul', preco_centavos: 300 } }, expect: { status: 200, body: { id: 1, nome: 'Caneta azul', preco_centavos: 300 } } }],
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
    "INSERT … RETURNING id, nome, preco_centavos devolve a linha criada numa ida só ao banco; UPDATE e DELETE também aceitam RETURNING, e sem linha de volta o produto não existia (404).",
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
    '1. Crie migrations/002_pedidos.sql com duas tabelas: pedidos (id serial PRIMARY KEY, total_centavos int, criado_em timestamptz DEFAULT now()) e itens_pedido (id serial, pedido_id int REFERENCES pedidos(id), produto_id int, quantidade int, preco_centavos int). Aplique na aba Banco.\n' +
    '2. Crie src/db/pedidos.ts com criarPedido e buscarPedido. criarPedido usa uma transação (db.transaction(async (tx) => { … })) para: inserir o pedido, buscar o preço de cada produto (SELECT preco_centavos), inserir cada item e calcular o total. Transação significa que todas as escritas acontecem juntas ou nenhuma acontece; se um produto não existir, lance um erro dentro da transação — ela desfaz tudo.\n' +
    '3. Crie src/routes/pedidos.ts: POST /pedidos recebe { itens: [{ produtoId, quantidade }] }, chama criarPedido e responde 201 com Location (/pedidos/:id). Se algum produto não existe, responde 422. GET /pedidos/:id devolve { id, total_centavos, itens }.\n' +
    '4. Registre em src/index.ts: app.route("/pedidos", pedidos) no Hono, ou adicione os casos no fetch puro.\n' +
    '5. Teste na aba Requisição e clique em Rodar testes.',
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
            body: { id: '{{id}}', total_centavos: 2000, itens: [{ produto_id: 1, quantidade: 2, preco_centavos: 250 }, { produto_id: 2, quantidade: 1, preco_centavos: 1500 }] },
          },
        },
      ],
      db: { sql: 'SELECT produto_id, quantidade, preco_centavos FROM itens_pedido ORDER BY id', rows: [{ produto_id: 1, quantidade: 2, preco_centavos: 250 }, { produto_id: 2, quantidade: 1, preco_centavos: 1500 }] },
    },
    {
      name: 'produto inexistente desfaz o pedido inteiro',
      requests: [{ request: post('/pedidos', { itens: [{ produtoId: 1, quantidade: 1 }, { produtoId: 999, quantidade: 1 }] }), expect: { status: 422 } }],
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
    '1. Crie src/validacao.ts com zod (já é uma dependência do projeto). Descreva a entrada de cada rota com z.object: produtoSchema exige nome: z.string().min(1) e preco_centavos: z.number().int().min(0); pedidoSchema exige itens: z.array(…).min(1) com produtoId e quantidade inteiros maiores que zero. zod é uma biblioteca de validação de tipos em tempo de execução.\n' +
    '2. Escreva lerCorpo(req, schema): lê o corpo JSON com req.json(), passa pelo schema.safeParse(dados) — que não lança, mas devolve { success, data } ou { success: false, error } — e lança new ErroHttp(400, "Dados inválidos", "Corrija os campos indicados.", { erros }), onde erros é a lista { campo, mensagem } montada de error.issues.\n' +
    '3. Substitua await c.req.json() (ou await req.json()) por await lerCorpo(c.req.raw, produtoSchema) nas rotas de produto e por lerCorpo para pedidos. Entrada inválida responde 400 problem+json com erros: [{ campo, mensagem }] sem chegar ao banco.\n' +
    '4. Confirme que todo erro da API já sai em problem+json (via app.onError/deErro no Hono ou try/catch no fetch puro).\n' +
    '5. Teste na aba Requisição: POST /produtos com { "nome": "", "preco_centavos": -1 } deve responder 400 citando nome e preco_centavos. Clique em Rodar testes.',
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
    "Descreva a forma da entrada uma vez: z.object({ nome: z.string().min(1), preco_centavos: z.number().int().min(0) }). Números vindos do JSON são number, não string.",
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
  statement:
    '1. Abra src/db/produtos.ts e substitua listarProdutos: a nova assinatura recebe um objeto filtro com cursor (padrão 0), limite (padrão 20), q (texto), preco_min e preco_max. A consulta usa WHERE id > $cursor ORDER BY id LIMIT $n — cursor é a paginação por cursor (não OFFSET): não pula itens se alguém criar ou apagar no meio. Leia uma linha a mais que o limite; se ela existir, há próxima página. Limite máximo: Math.min(limite, 50).\n' +
    '2. Em src/validacao.ts, adicione listaSchema com z.coerce.number() para cursor, limite, preco_min e preco_max (z.coerce converte strings de query string para número). Adicione também lerConsulta(req, schema) que lê new URL(req.url).searchParams.\n' +
    '3. Abra src/routes/produtos.ts e passe lerConsulta(req, listaSchema) para listarProdutos. GET /produtos agora devolve { itens, proximoCursor } (null na última página). Limite menor que 1 responde 400.\n' +
    '4. Registre os filtros opcionais: q (ILIKE), preco_min e preco_max são opcionais; use ($2::text IS NULL OR nome ILIKE $2) para filtrar sem mudar a consulta quando o filtro não veio.\n' +
    '5. Teste na aba Requisição: GET /produtos?limite=3 deve devolver 3 itens com proximoCursor. Clique em Rodar testes.',
  files: [...validacao.files],
  seed: CATALOGO_SEED,
  tests: [
    {
      name: 'páginas por cursor sem pular nem repetir',
      sequential: true,
      requests: [
        { request: { path: '/produtos?limite=3' }, expect: { status: 200, body: { itens: itensDe(1, 2, 3), proximoCursor: 3 } }, save: { c: 'body.proximoCursor' } },
        { request: { path: '/produtos?limite=3&cursor={{c}}' }, expect: { status: 200, body: { itens: itensDe(4, 5, 6), proximoCursor: 6 } } },
      ],
    },
    { name: 'a última página não tem próximo cursor', requests: [{ request: { path: '/produtos?limite=10&cursor=58' }, expect: { status: 200, body: { itens: itensDe(59, 60), proximoCursor: null } } }] },
    {
      name: 'filtra por preço',
      requests: [{ request: { path: '/produtos?preco_min=200&preco_max=300' }, expect: { status: 200, body: { itens: itensDe(2, 3), proximoCursor: null } } }],
    },
    { name: 'filtra por nome', requests: [{ request: { path: '/produtos?q=produto%206' }, expect: { status: 200, body: { itens: itensDe(6, 60), proximoCursor: null } } }] },
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
    'Crie migrations/003_usuarios.sql com usuarios (id, email único, senha_hash, papel: cliente ou admin). POST /usuarios cadastra { email, senha } (senha com 8 caracteres ou mais): 201 com { id, email, papel }, 409 se o e-mail já existe; o primeiro usuário vira admin, os outros clientes. A senha é gravada só com hash e sal. POST /login devolve { token, expiraEm } (token assinado, que expira) ou 401 problem+json. Escrever em /produtos exige admin; /pedidos exige login. Sem token ou token inválido: 401; token válido sem permissão: 403. Nenhuma resposta traz senha nem senha_hash.',
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
    { id: 'auth-401-403', before: USUARIOS, anonymous: post('/produtos', { nome: 'Lápis', preco_centavos: 150 }), forbidden: post('/produtos', { nome: 'Lápis', preco_centavos: 150 }, bearer('cliente')) },
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
  stages: [primeirosPassos, health, produtos, pedidos, validacao, paginacao, auth],
}
