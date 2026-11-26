// Projeto 2 of the Oficina: Busca e paginação, in three stages.
// Based on the old exercises paginacao.ts and busca.ts.

import { HTTP, referencia } from './cursoBuscaRef'
import type { GuidedStep, ProjectCourse, Stage } from './stage'

const SEED_ESTAGIO_1 = `INSERT INTO produtos (id, nome, preco_centavos) VALUES
  (1, 'Teclado mecânico', 34990),
  (2, 'Teclado sem fio', 19990),
  (3, 'Tela 24 polegadas', 89990),
  (4, 'Fone de ouvido', 9990),
  (5, 'Fone sem fio', 24990);
SELECT setval('produtos_id_seq', 5);`

const PRODUTOS_1 = [
  { id: 1, nome: 'Teclado mecânico', preco_centavos: 34990 },
  { id: 2, nome: 'Teclado sem fio', preco_centavos: 19990 },
  { id: 3, nome: 'Tela 24 polegadas', preco_centavos: 89990 },
  { id: 4, nome: 'Fone de ouvido', preco_centavos: 9990 },
  { id: 5, nome: 'Fone sem fio', preco_centavos: 24990 },
]

const TOTAL_PAGINACAO = 60
const SEED_PAGINACAO = `INSERT INTO produtos (id, nome, preco_centavos)
  SELECT i * 3, 'Produto ' || (i * 3), i * 3 * 100
  FROM generate_series(1, ${TOTAL_PAGINACAO}) i
  ORDER BY (i * 37) % ${TOTAL_PAGINACAO};
SELECT setval('produtos_id_seq', ${TOTAL_PAGINACAO * 3});`

const produtoPaginado = (id: number) => ({ id, nome: 'Produto ' + id, preco_centavos: id * 100 })
const produtosPaginados = (fromIndex: number, toIndex: number) =>
  Array.from({ length: toIndex - fromIndex + 1 }, (_, i) => produtoPaginado((fromIndex + i) * 3))

const TOTAL_BUSCA = 2000
const WORDS = ['Camiseta', 'Caneca', 'Livro', 'Mochila', 'Garrafa', 'Caderno', 'Cabo', 'Capa', 'Tapete', 'Vela']
const COLORS = ['azul', 'verde', 'preta', 'branca', 'vermelha']
const sqlArray = (xs: string[]) => `ARRAY[${xs.map((x) => `'${x}'`).join(', ')}]`

const buscaNome = (i: number) => `${WORDS[i % 10]} ${COLORS[Math.floor(i / 10) % 5]} ${i}`
const buscaPreco = (i: number) => 990 + (i % 50) * 100
const buscaProduto = (i: number) => ({ id: i, nome: buscaNome(i), preco_centavos: buscaPreco(i) })

export const PRODUTOS_BUSCA_CA = (() => {
  const items: { id: number; nome: string; preco_centavos: number }[] = []
  for (let i = 6; i <= TOTAL_BUSCA; i++) {
    const nome = buscaNome(i)
    if (nome.toLowerCase().startsWith('ca')) {
      items.push(buscaProduto(i))
    }
  }
  items.sort((a, b) => (a.nome.toLowerCase() < b.nome.toLowerCase() ? -1 : a.nome.toLowerCase() > b.nome.toLowerCase() ? 1 : 0))
  return items.slice(0, 20)
})()

const SEED_BUSCA = `INSERT INTO produtos (id, nome, preco_centavos) VALUES
  (1, 'Teclado mecânico', 34990),
  (2, 'Teclado sem fio', 19990),
  (3, 'Tela 24 polegadas', 89990),
  (4, 'Fone de ouvido', 9990),
  (5, 'Fone sem fio', 24990);
INSERT INTO produtos (id, nome, preco_centavos)
  SELECT i, (${sqlArray(WORDS)})[1 + i % 10] || ' ' || (${sqlArray(COLORS)})[1 + i / 10 % 5] || ' ' || i, 990 + i % 50 * 100
  FROM generate_series(6, ${TOTAL_BUSCA}) i;
SELECT setval('produtos_id_seq', ${TOTAL_BUSCA});`

// --- Guided steps (issue #138): one concept each, the pattern in code on a stand-in table, the docs entry and a check. ---

const PASSOS_LISTAGEM: GuidedStep[] = [
  {
    title: 'Conheça a tela',
    do: 'Clique em Testar agora: o projeto já responde GET /health. Os arquivos ficam à esquerda e este painel guia cada passo.',
    learn:
      'À esquerda ficam os arquivos do projeto; embaixo, o Banco (tabelas e migrações) e o Console (o que sua API registrou). Aqui à direita, a aba Requisição chama sua API como um navegador faria, e Rodar testes confere a etapa e dá até 3 estrelas. O projeto já responde GET /health: clique em Testar agora para ver.',
    check: { kind: 'request', path: '/health', status: 200, body: { status: 'ok' } },
  },
  {
    title: 'A porta de entrada: src/index.ts',
    do: 'Clique em Abrir src/index.ts e leia como o app liga cada caminho a um arquivo. Nada para digitar ainda.',
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
          'Toda requisição entra por src/index.ts, que exporta um objeto com [fetch(req, env)](fetch-app): o servidor chama essa função e espera um Response de volta. Lá, um if por rota olha o caminho e chama a função certa.',
        example: {
          file: 'src/index.ts',
          code: String.raw`import type { Env } from './env'
import { health } from './routes/health' // a função de /health, em outro arquivo

export default {
  // Chamada a cada requisição; precisa devolver um Response.
  async fetch(req: Request, env: Env): Promise<Response> {
    // Só o caminho da URL: '/health', sem domínio nem ?query.
    const { pathname } = new URL(req.url)
    // Uma rota é um if: o caminho e a função que responde.
    if (pathname === '/health') return health(env)
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
    do: 'Clique em Abrir src/routes/health.ts e leia: a rota GET /produtos que você vai escrever tem esta forma.',
    learn:
      'Uma rota recebe a requisição e devolve uma resposta; o SQL fica em src/db/, e a rota só chama. O banco chega em c.env.db, com o tipo [Env](env). [db.query](db-query) devolve as linhas como objetos.',
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
      note: 'A sua rota GET /produtos terá esta forma: chama uma função de src/db/ e devolve JSON.',
    },
    docs: ['hono-rotas', 'hono-json', 'env'],
    byFramework: {
      fetch: {
        learn:
          'Uma rota recebe a requisição e devolve uma resposta; o SQL fica em src/db/, e a rota só chama. O banco chega em env.db, com o tipo [Env](env). [db.query](db-query) devolve as linhas como objetos.',
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
          note: 'A sua rota GET /produtos terá esta forma: chama uma função de src/db/ e devolve JSON.',
        },
        docs: ['fetch-json', 'env'],
      },
    },
  },
  {
    title: 'O que o src/http.ts já traz',
    do: 'Clique em Abrir src/http.ts e leia as funções prontas: você vai usá-las, não editá-las.',
    learn:
      'Este curso começa com src/http.ts pronto, para você focar em listar e buscar. [ErroHttp e problema](http-helpers) montam erros em [problem+json](problem-json), e deErro transforma qualquer erro lançado numa resposta. Você vai lançar ErroHttp nas etapas seguintes, para recusar entradas inválidas.',
    file: 'src/http.ts',
    example: {
      file: 'modelo',
      code: String.raw`import { ErroHttp, problema } from './http'

// problema monta o Response de erro pronto: status, title e Content-Type problem+json.
const naoAchou = problema(404, 'Rota não encontrada')

// ErroHttp é para lançar: de qualquer lugar, com o status que a resposta deve ter.
throw new ErroHttp(400, 'Busca inválida', 'Informe o que buscar.')`,
      note: 'Você só vai usar essas funções; não precisa editar o arquivo.',
    },
    docs: ['http-helpers', 'problem-json'],
  },
  {
    title: 'O SQL: listarProdutos em src/db/produtos.ts',
    do: 'Clique em Abrir src/db/produtos.ts e escreva listarProdutos(db): id, nome e preco_centavos, em ordem de id.',
    learn:
      'SELECT * traz toda coluna: se a tabela ganhar um campo interno, ele vaza na resposta. Liste as colunas e fixe a ordem com ORDER BY, ou a lista muda de lugar entre consultas. A função só devolve linhas; o HTTP fica na rota.',
    file: 'src/db/produtos.ts',
    example: {
      file: 'modelo',
      code: String.raw`import type { Env } from '../env'

type Db = Env['db'] // o tipo do banco que a rota entrega

export interface Cliente {
  id: number
  nome: string
  email: string
}

// Uma função por consulta. db.query devolve as linhas como objetos.
export async function listarClientes(db: Db): Promise<Cliente[]> {
  // Colunas explícitas, nunca *. ORDER BY dá uma ordem previsível.
  return db.query<Cliente>('SELECT id, nome, email FROM clientes ORDER BY nome')
}`,
      note: 'No seu caso: a tabela produtos já existe em migrations/001_init.sql; o tipo é Produto { id, nome, preco_centavos } e a lista sai ordenada por id.',
    },
    docs: ['db-query'],
    check: { kind: 'file', path: 'src/db/produtos.ts', contains: ['SELECT id, nome, preco_centavos FROM produtos ORDER BY id'] },
  },
  {
    title: 'A rota GET /produtos',
    do: 'Clique em Abrir src/routes/produtos.ts e escreva GET /produtos, que devolve listarProdutos em JSON.',
    learn:
      'Crie o arquivo da rota em src/routes/. Ela chama listarProdutos e responde a lista em JSON; nada de SQL aqui. O arquivo exporta um roteador, e quem escolhe o caminho completo é o index.',
    file: 'src/routes/produtos.ts',
    example: {
      file: 'modelo',
      code: String.raw`import { Hono } from 'hono'
import { listarClientes } from '../db/clientes'
import type { Env } from '../env'

// Exportado com nome, para o index importar.
export const clientes = new Hono<{ Bindings: Env }>()

// GET na raiz do roteador. O await espera o banco; c.json responde 200.
clientes.get('/', async (c) => c.json(await listarClientes(c.env.db)))`,
      note: 'No seu caso: o roteador se chama produtos e a função é listarProdutos.',
    },
    docs: ['hono-rotas', 'hono-json'],
    check: { kind: 'file', path: 'src/routes/produtos.ts', contains: ["produtos.get('/'", 'listarProdutos('] },
    byFramework: {
      fetch: {
        learn:
          'Crie o arquivo da rota em src/routes/. Ela chama listarProdutos e responde a lista em JSON; nada de SQL aqui. O arquivo exporta uma função, e quem escolhe o caminho é o index.',
        example: {
          file: 'modelo',
          code: String.raw`import { listarClientes } from '../db/clientes'
import type { Env } from '../env'
import { problema } from '../http'

// Exportada com nome, para o index importar.
export async function clientes(req: Request, env: Env): Promise<Response> {
  // A função decide pelo método: o que não é GET não existe aqui.
  if (req.method !== 'GET') return problema(405, 'Método não permitido')
  // O await espera o banco; Response.json responde 200.
  return Response.json(await listarClientes(env.db))
}`,
          note: 'No seu caso: a função se chama produtos e chama listarProdutos.',
        },
        docs: ['fetch-json'],
        check: { kind: 'file', path: 'src/routes/produtos.ts', contains: ['export async function produtos', 'listarProdutos(env.db)'] },
      },
    },
  },
  {
    title: 'Registre a rota e padronize o 404',
    do: 'Em src/index.ts, ligue o caminho /produtos e faça a rota desconhecida responder 404 em problem+json.',
    learn:
      'O roteador só responde depois de montado no app. [app.notFound](hono-notfound) troca o texto "404 Not Found" do Hono por problem+json, e [app.onError](hono-erros) faz o mesmo com todo erro lançado. Sem isso, um ErroHttp viraria um 500 genérico.',
    file: 'src/index.ts',
    example: {
      file: 'src/index.ts',
      code: String.raw`import { clientes } from './routes/clientes' // 1. importe o roteador
import { deErro, problema } from './http'

const app = new Hono<{ Bindings: Env }>()

app.route('/health', health)
app.route('/clientes', clientes) // 2. monte no prefixo

// 3. Caminho sem dono: 404 em problem+json.
app.notFound(() => problema(404, 'Rota não encontrada'))
// 4. Todo erro lançado (ErroHttp ou bug) passa pelo deErro.
app.onError(deErro)`,
      note: "No seu caso: importe produtos de './routes/produtos' e monte em '/produtos'.",
    },
    docs: ['hono-route', 'hono-notfound', 'hono-erros'],
    check: { kind: 'file', path: 'src/index.ts', contains: ["from './routes/produtos'", "app.route('/produtos', produtos)", 'app.onError(deErro)'] },
    byFramework: {
      fetch: {
        learn:
          'A função só roda quando um if casa o caminho. Envolva a chamada em try/catch: o deErro transforma todo erro lançado em resposta, e o problema(404) troca o { erro } do starter por problem+json. Use return await: sem o await, o erro de uma rota async escapa do catch.',
        example: {
          file: 'src/index.ts',
          code: String.raw`import { clientes } from './routes/clientes' // 1. importe a função
import { deErro, problema } from './http'

// … dentro de fetch(req, env):
    const { pathname } = new URL(req.url)
    if (pathname === '/health') return health(env)
    if (pathname === '/clientes') { // 2. um if por rota
      try {
        return await clientes(req, env) // await: o erro de uma rota async cai no catch
      } catch (err) {
        return deErro(err) // ErroHttp vira o status dele; o resto vira 500
      }
    }
    return problema(404, 'Rota não encontrada') // nenhum if casou`,
          note: "No seu caso: importe produtos de './routes/produtos' e use pathname === '/produtos'.",
        },
        docs: ['fetch-rotear', 'erro-lancado', 'http-helpers'],
        check: { kind: 'file', path: 'src/index.ts', contains: ["from './routes/produtos'", "pathname === '/produtos'", 'deErro(', 'problema(404'] },
      },
    },
  },
  {
    title: 'Teste a listagem',
    do: 'Clique em Testar agora: GET /produtos deve responder 200 com a lista. Depois, rode os testes da etapa.',
    learn:
      'Teste à mão antes dos testes automáticos: o erro aparece mais cedo e mais claro. 404 quer dizer que a rota não foi registrada; 500, que o código lançou um erro (veja o Console). Com a lista na resposta, e um caminho desconhecido respondendo 404 em problem+json, rode os testes da etapa.',
    docs: ['problem-json'],
    check: {
      kind: 'request',
      path: '/produtos',
      status: 200,
      body: PRODUTOS_1,
    },
  },
]

const PASSOS_PAGINACAO: GuidedStep[] = [
  {
    title: 'Por que não OFFSET',
    do: 'Leia o exemplo: com OFFSET, o banco lê e descarta tudo antes da página. Nada para digitar ainda.',
    learn:
      'Devolver tudo de uma vez enche a memória e a rede, então a lista vira páginas. Com OFFSET, o banco lê e joga fora todas as linhas anteriores: páginas fundas ficam lentas, e uma inserção no meio faz itens pularem ou repetirem. Com [cursor](paginacao-cursor), a consulta pede só o que vem depois do último id visto, direto pelo índice da chave primária.',
    example: {
      file: 'modelo',
      code: String.raw`-- OFFSET: para entregar a página 500, o banco lê e descarta 9.980 linhas.
SELECT id, titulo FROM posts ORDER BY id LIMIT 20 OFFSET 9980

-- CURSOR: o cliente devolve o último id que viu; o índice vai direto a ele.
SELECT id, titulo FROM posts WHERE id > $1 ORDER BY id LIMIT 20`,
      note: 'No seu caso: GET /produtos?limite=&cursor= usa a segunda forma, com id como cursor.',
    },
    docs: ['paginacao-cursor'],
  },
  {
    title: 'Query string vira número: zod com coerce',
    do: 'Em src/validacao.ts, escreva listaSchema com cursor (padrão 0) e limite (padrão 20), usando z.coerce.',
    learn:
      'cursor e limite chegam na URL como texto: "20" não é o número 20. O [z.coerce.number()](zod-coerce) converte antes de validar, e .default() preenche o que não veio. O que não é número, ou é negativo, o [schema](zod-schema) recusa.',
    file: 'src/validacao.ts',
    example: {
      file: 'modelo',
      code: String.raw`import { z } from 'zod'

export const buscaPostsSchema = z.object({
  pagina: z.coerce.number().int().min(1).default(1), // "3" vira 3; se não veio, 1
  tamanho: z.coerce.number().int().min(1).default(10), // se não veio, 10
})`,
      note: 'No seu caso: listaSchema, com cursor (inteiro a partir de 0, padrão 0) e limite (inteiro a partir de 1, padrão 20). O teto de 50 fica no banco, mais adiante.',
    },
    docs: ['zod-schema', 'zod-coerce'],
    check: { kind: 'file', path: 'src/validacao.ts', contains: ['export const listaSchema', 'z.coerce.number()', '.default(20)'] },
  },
  {
    title: 'Falhas viram 400: lerConsulta',
    do: 'Em src/validacao.ts, escreva lerConsulta(req, schema), que valida a query string e lança 400 quando ela não passa.',
    learn:
      'O schema precisa ver a query como um objeto: [Object.fromEntries](zod-validar) faz isso com searchParams. Se safeParse falhar, lance um ErroHttp 400 com a lista de campos no extra, e o deErro responde em problem+json. Uma função só, lerConsulta, serve a toda rota com query.',
    file: 'src/validacao.ts',
    example: {
      file: 'modelo',
      code: String.raw`import { ErroHttp } from './http'

export function lerPaginaPosts(req: Request) {
  // searchParams é a query; fromEntries a transforma em { pagina: '3', ... }.
  const consulta = Object.fromEntries(new URL(req.url).searchParams)
  const resultado = buscaPostsSchema.safeParse(consulta)
  if (resultado.success) return resultado.data // já convertido, com os padrões
  // Um item por campo errado: { campo, mensagem }.
  const erros = resultado.error.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message }))
  // O 4º argumento (extra) vai para o corpo do problem+json.
  throw new ErroHttp(400, 'Dados inválidos', 'Corrija os campos indicados.', { erros })
}`,
      note: 'No seu caso: lerConsulta(req, schema), que recebe o schema como argumento (<S extends z.ZodType>, devolvendo z.output<S>). No Hono, a Request é c.req.raw.',
    },
    docs: ['zod-validar', 'hono-query'],
    check: { kind: 'file', path: 'src/validacao.ts', contains: ['export function lerConsulta', 'safeParse', 'ErroHttp(400'] },
    byFramework: { fetch: { docs: ['zod-validar', 'fetch-query'] } },
  },
  {
    title: 'A consulta por cursor',
    do: 'Em src/db/produtos.ts, troque listarProdutos por listarProdutos(db, filtro): ids maiores que o cursor, em ordem, com LIMIT.',
    learn:
      '[WHERE id > $1](paginacao-cursor) pula tudo que o cliente já viu, usando o índice da chave primária, e LIMIT $2 corta a página. O ORDER BY id é obrigatório: sem ele, "depois do cursor" não quer dizer nada. O cursor da primeira página é 0.',
    file: 'src/db/produtos.ts',
    example: {
      file: 'modelo',
      code: String.raw`export async function listarPosts(db: Db, cursor: number, limite: number): Promise<Post[]> {
  return db.query<Post>(
    // id > cursor: só o que vem depois. ORDER BY id: a mesma ordem do cursor.
    'SELECT id, titulo FROM posts WHERE id > $1 ORDER BY id LIMIT $2',
    [cursor, limite], // $1 e $2, nunca texto colado no SQL
  )
}`,
      note: 'No seu caso: listarProdutos(db, filtro), com filtro { cursor, limite }; as colunas são id, nome, preco_centavos.',
    },
    docs: ['paginacao-cursor', 'db-query'],
    check: { kind: 'file', path: 'src/db/produtos.ts', contains: ['WHERE id > $1 ORDER BY id LIMIT $2'] },
  },
  {
    title: 'Um teto para o limite',
    do: 'Em src/db/produtos.ts, crie LIMITE_MAX = 50 e use Math.min(filtro.limite, LIMITE_MAX).',
    learn:
      'O cliente escolhe o limite, e ?limite=1000000 derrubaria o servidor. Aplique um teto no código, com Math.min: pediu mais de 50, recebe 50. O schema recusa o inválido, e o teto corrige o exagero.',
    file: 'src/db/produtos.ts',
    example: {
      file: 'modelo',
      code: String.raw`export const TAMANHO_MAX = 20 // o teto, num lugar só

// … dentro da função:
// Math.min fica com o menor: 1000 vira 20; 10 continua 10.
const tamanho = Math.min(filtro.tamanho, TAMANHO_MAX)`,
      note: 'No seu caso: o teto é 50 (LIMITE_MAX) e o valor pedido está em filtro.limite.',
    },
    docs: ['paginacao-cursor'],
    check: { kind: 'file', path: 'src/db/produtos.ts', contains: ['Math.min(', '= 50'] },
  },
  {
    title: 'Uma linha a mais: há próxima página?',
    do: 'Peça limite + 1 linhas e devolva { itens, proximoCursor }, com proximoCursor null quando não houver mais.',
    learn:
      'Para saber se há próxima página sem um COUNT(*) caro, peça limite + 1 linhas. Se vieram mais que o limite, existe próxima: devolva só o limite e use o id do último item como proximoCursor. Se não vieram, proximoCursor é null.',
    file: 'src/db/produtos.ts',
    example: {
      file: 'modelo',
      code: String.raw`const linhas = await db.query<Post>('... LIMIT $2', [cursor, tamanho + 1]) // pede uma a mais
const itens = linhas.slice(0, tamanho) // entrega só o que foi pedido
// Veio a linha extra = existe próxima página; o cursor é o último id entregue.
const proximo = linhas.length > tamanho ? itens[itens.length - 1].id : null
return { itens, proximo }`,
      note: 'No seu caso: passe [filtro.cursor, limite + 1], e devolva { itens, proximoCursor }.',
    },
    docs: ['paginacao-cursor'],
    check: { kind: 'file', path: 'src/db/produtos.ts', contains: ['proximoCursor', '.slice(0,'] },
  },
  {
    title: 'A rota entrega os parâmetros',
    do: 'Em src/routes/produtos.ts, faça GET /produtos passar lerConsulta(…, listaSchema) para listarProdutos.',
    learn:
      'A rota lê a query com lerConsulta, passa o filtro ao banco e responde { itens, proximoCursor }. Um cursor ou limite inválido lança 400 antes de tocar o banco, e o app o converte em problem+json.',
    file: 'src/routes/produtos.ts',
    example: {
      file: 'modelo',
      code: String.raw`// c.req.raw é a Request padrão que lerConsulta espera.
posts.get('/', async (c) => c.json(await listarPosts(c.env.db, lerConsulta(c.req.raw, buscaPostsSchema))))`,
      note: 'No seu caso: produtos.get e listaSchema; o filtro lido já vai direto para listarProdutos.',
    },
    docs: ['hono-query', 'hono-json'],
    check: { kind: 'file', path: 'src/routes/produtos.ts', contains: ['lerConsulta(', 'listaSchema'] },
    byFramework: {
      fetch: {
        example: {
          file: 'modelo',
          code: String.raw`// Aqui req já é a Request padrão, sem c.req.raw.
export async function posts(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'GET') return problema(405, 'Método não permitido')
  return Response.json(await listarPosts(env.db, lerConsulta(req, buscaPostsSchema)))
}`,
          note: 'No seu caso: a função produtos já existe; troque a chamada de listarProdutos pelo filtro lido por lerConsulta(req, listaSchema).',
        },
        docs: ['fetch-query', 'fetch-json'],
      },
    },
  },
  {
    title: 'Teste a primeira página',
    do: 'Clique em Testar agora: GET /produtos?limite=3 deve trazer 3 itens e um proximoCursor. Depois, rode os testes da etapa.',
    learn:
      'Com limite=3, a primeira página termina no id 9, porque os ids deste banco pulam de 3 em 3: proximoCursor é 9. Peça a seguinte com cursor=9. E confira os erros: limite=0 e cursor=-1 devem responder 400 em problem+json.',
    docs: ['paginacao-cursor'],
    check: { kind: 'request', path: '/produtos?limite=3', status: 200, body: { itens: produtosPaginados(1, 3), proximoCursor: 9 } },
  },
]

const PASSOS_BUSCA: GuidedStep[] = [
  {
    title: 'Por que um índice funcional',
    do: 'Leia o exemplo: o índice precisa ser sobre a mesma expressão que a consulta usa. Nada para digitar ainda.',
    learn:
      'WHERE lower(nome) LIKE $1 em milhares de linhas obriga o banco a olhar linha por linha: um Seq Scan. Um [índice sobre lower(nome)](indice-prefixo) guarda os nomes já em minúsculas e ordenados, e a busca por prefixo vira um intervalo nele. text_pattern_ops é o que deixa o LIKE usar esse índice mesmo com a ordenação de idioma do banco.',
    example: {
      file: 'modelo',
      code: String.raw`-- Busca de clientes pelo começo do e-mail, sem diferenciar maiúsculas.
-- Sem índice na expressão, o banco lê todas as linhas (Seq Scan):
SELECT id, email FROM clientes WHERE lower(email) LIKE 'ana%'

-- Com um índice em lower(email), basta ir ao trecho 'ana' ... 'anb' dele.
-- Uma busca "no meio" (LIKE '%ana%') não tem trecho: não usa este índice.`,
      note: 'No seu caso: a coluna é nome, e a busca é pelo começo do nome em GET /produtos?busca=.',
    },
    docs: ['indice-prefixo'],
  },
  {
    title: 'A migração do índice',
    do: 'Clique em Abrir migrations/002_indice_busca.sql, crie o índice produtos_nome_idx sobre lower(nome) e clique em Aplicar migrações.',
    learn:
      'O índice nasce numa migração nova, e não editando a anterior: a 001 já rodou. A expressão do índice tem de ser a mesma da consulta: se o índice é em lower(nome), a consulta usa lower(nome). A classe text_pattern_ops vem depois da expressão.',
    file: 'migrations/002_indice_busca.sql',
    example: {
      file: 'modelo',
      code: String.raw`-- nome do índice, tabela e a EXPRESSÃO indexada (não a coluna pura).
-- text_pattern_ops: ordena caractere a caractere, o que o LIKE de prefixo precisa.
CREATE INDEX clientes_email_idx ON clientes (lower(email) text_pattern_ops);`,
      note: 'No seu caso: o índice se chama produtos_nome_idx, na tabela produtos, sobre lower(nome).',
    },
    docs: ['indice-prefixo', 'sql-migracao'],
    check: { kind: 'file', path: 'migrations/002_indice_busca.sql', contains: ['CREATE INDEX', 'lower(nome) text_pattern_ops'] },
  },
  {
    title: 'O prefixo: minúsculas e curingas escapados',
    do: 'Em src/db/produtos.ts, monte o padrão da busca: o termo em minúsculas, com % e _ escapados, e um % no fim.',
    learn:
      'Busca por começo de nome é LIKE com o termo seguido de %. Mas % e _ são curingas do LIKE: se o usuário digitar "%", casaria tudo. [Escape os curingas](like-prefixo) com uma barra e ponha o termo em minúsculas, para casar com lower(nome).',
    file: 'src/db/produtos.ts',
    example: {
      file: 'modelo',
      code: String.raw`// trim tira os espaços; toLowerCase casa com o lower(email) do índice.
// replace põe uma \ antes de \, % e _: viram texto comum no LIKE.
const prefixo = termo.trim().toLowerCase().replace(/[\\%_]/g, '\\$&') + '%'
// O % do fim é o único curinga: quer dizer "começa com".`,
      note: 'No seu caso: o termo é o parâmetro busca da função de busca, e o resultado vai para $1.',
    },
    docs: ['like-prefixo'],
    check: { kind: 'file', path: 'src/db/produtos.ts', contains: ['.toLowerCase()', '.replace(', "'%'"] },
  },
  {
    title: 'A consulta usa a expressão do índice',
    do: 'Em src/db/produtos.ts, escreva buscarProdutos(db, busca) com WHERE lower(nome) LIKE $1.',
    learn:
      'A consulta usa exatamente a expressão do índice: WHERE lower(nome) LIKE $1 e ORDER BY lower(nome). Assim o banco anda pelo índice já ordenado, sem outro passo de ordenação. LIMIT 20 mantém a resposta pequena.',
    file: 'src/db/produtos.ts',
    example: {
      file: 'modelo',
      code: String.raw`export async function buscarClientes(db: Db, termo: string): Promise<Cliente[]> {
  const prefixo = termo.trim().toLowerCase() + '%' // (o escape do passo anterior entra aqui)
  return db.query<Cliente>(
    // lower(email) aqui = lower(email) no índice; o ORDER BY aproveita a ordem dele.
    'SELECT id, nome, email FROM clientes WHERE lower(email) LIKE $1 ORDER BY lower(email) LIMIT 20',
    [prefixo], // o valor vai em params: nunca monte o LIKE colando texto
  )
}`,
      note: 'No seu caso: buscarProdutos(db, busca), com as colunas id, nome, preco_centavos.',
    },
    docs: ['indice-prefixo', 'db-query'],
    check: { kind: 'file', path: 'src/db/produtos.ts', contains: ['WHERE lower(nome) LIKE $1', 'ORDER BY lower(nome)', 'LIMIT 20'] },
  },
  {
    title: 'Busca ausente ou vazia',
    do: 'Em src/routes/produtos.ts, faça GET /produtos sem busca (ou com busca vazia) continuar listando como antes. Depois clique em Testar agora.',
    learn:
      'Sem ?busca, a rota lista como antes. Com ?busca= vazio, o cliente errou: responda 400, não a lista inteira. [Ausente é undefined](hono-query) e vazio é uma string vazia, então a rota precisa separar os dois casos.',
    file: 'src/routes/produtos.ts',
    example: {
      file: 'modelo',
      code: String.raw`clientes.get('/', async (c) => {
  const nome = c.req.query('nome') // undefined se ?nome não veio; '' se veio vazio
  if (nome !== undefined) { // veio: é uma busca
    // Vazio ou só espaços: 400 em problem+json, pelo app.onError.
    if (!nome.trim()) throw new ErroHttp(400, 'Busca inválida', 'Informe o que buscar.')
    // ... a resposta da busca vem no próximo passo
  }
  // Não veio: a listagem de antes.
  return c.json(await listarClientes(c.env.db, lerConsulta(c.req.raw, listaSchema)))
})`,
      note: 'No seu caso: o parâmetro é busca, e a listagem de antes continua como está.',
    },
    docs: ['hono-query', 'hono-erros'],
    check: { kind: 'request', path: '/produtos?busca=', status: 400, body: { status: 400 } },
    byFramework: {
      fetch: {
        learn:
          'Sem ?busca, a rota lista como antes. Com ?busca= vazio, o cliente errou: responda 400, não a lista inteira. [searchParams.has](fetch-query) diz se o parâmetro veio, e get devolve o texto (vazio, se veio sem valor).',
        example: {
          file: 'modelo',
          code: String.raw`export async function clientes(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url)
  if (url.searchParams.has('nome')) { // veio: é uma busca (mesmo vazia)
    const nome = url.searchParams.get('nome') ?? ''
    // Vazio ou só espaços: o index captura o throw e o deErro responde 400.
    if (!nome.trim()) throw new ErroHttp(400, 'Busca inválida', 'Informe o que buscar.')
    // ... a resposta da busca vem no próximo passo
  }
  // Não veio: a listagem de antes.
  return Response.json(await listarClientes(env.db, lerConsulta(req, listaSchema)))
}`,
          note: 'No seu caso: o parâmetro é busca, e a listagem de antes continua como está.',
        },
        docs: ['fetch-query', 'erro-lancado'],
      },
    },
  },
  {
    title: 'Responda { produtos }',
    do: 'Com busca preenchida, a rota responde { produtos } com o resultado de buscarProdutos. Clique em Testar agora.',
    learn:
      'Com a busca válida, chame o banco e responda { produtos: [...] }: um objeto, e não o array puro. Ele se distingue da lista paginada, que responde { itens, proximoCursor }. O prefixo já chega escapado do banco, então a rota não trata curingas.',
    file: 'src/routes/produtos.ts',
    example: {
      file: 'modelo',
      code: String.raw`    // dentro do if (nome !== undefined), depois da checagem de vazio:
    const encontrados = await buscarClientes(c.env.db, nome)
    return c.json({ clientes: encontrados }) // um objeto com o nome do recurso`,
      note: 'No seu caso: buscarProdutos(c.env.db, busca) e a chave é produtos.',
    },
    docs: ['hono-json'],
    check: {
      kind: 'request',
      path: '/produtos?busca=tecl',
      status: 200,
      body: {
        produtos: [
          { id: 1, nome: 'Teclado mecânico', preco_centavos: 34990 },
          { id: 2, nome: 'Teclado sem fio', preco_centavos: 19990 },
        ],
      },
    },
    byFramework: {
      fetch: {
        example: {
          file: 'modelo',
          code: String.raw`    // dentro do if (url.searchParams.has('nome')), depois da checagem de vazio:
    const encontrados = await buscarClientes(env.db, nome)
    return Response.json({ clientes: encontrados }) // um objeto com o nome do recurso`,
          note: 'No seu caso: buscarProdutos(env.db, busca) e a chave é produtos.',
        },
        docs: ['fetch-json'],
      },
    },
  },
  {
    title: 'Curingas literais e testes',
    do: 'Clique em Testar agora: busca=% deve procurar o caractere %, não tudo. Depois, rode os testes da etapa.',
    learn:
      'Teste o caso difícil: ?busca=%25 é o texto "%" (a URL escreve % como %25). Com os curingas soltos, listaria tudo; escapados, não acha nenhum produto cujo nome comece com "%". Quando passar, rode os testes: eles também conferem que o índice existe no banco.',
    docs: ['like-prefixo'],
    check: { kind: 'request', path: '/produtos?busca=%25', status: 200, body: { produtos: [] } },
  },
]

const listagem: Stage = {
  id: 'listagem',
  title: 'Listagem simples de produtos',
  statement: 'Crie GET /produtos, que lista { id, nome, preco_centavos } em ordem de id, e faça rotas desconhecidas responderem 404 em problem+json.',
  steps: PASSOS_LISTAGEM,
  files: [
    'src/index.ts',
    'src/routes/health.ts',
    'src/routes/produtos.ts',
    'src/db/saude.ts',
    'src/db/produtos.ts',
    'src/env.ts',
    'src/http.ts',
    'migrations/001_init.sql',
  ],
  seed: SEED_ESTAGIO_1,
  tests: [
    {
      name: 'lista os produtos em ordem de id',
      requests: [{ request: { path: '/produtos' }, expect: { status: 200, body: PRODUTOS_1 } }],
    },
    {
      name: 'rota inexistente responde 404',
      requests: [{ request: { path: '/nada' }, expect: { status: 404, body: { status: 404 } } }],
    },
  ],
  checklist: [{ id: 'camadas' }, { id: 'sem-select-estrela' }, { id: 'sql-parametrizado' }, { id: 'problem-json', request: { path: '/nada' } }],
  hints: [
    'Consulte src/routes/health.ts e src/index.ts para ver como estruturar rotas: copie o padrão new Hono + app.route; o banco chega em c.env.db. Para responder erros como 404 no formato problem+json, use o helper problema (ou ErroHttp) de src/http.ts.',
    'No banco, monte SELECT id, nome, preco_centavos FROM produtos ORDER BY id. Na rota Hono, use c.json(await listarProdutos(c.env.db)) (ou Response.json(await listarProdutos(env.db)) no fetch puro).',
    'Em src/db/produtos.ts, exporte export async function listarProdutos(db: Db): Promise<Produto[]> { return db.query<Produto>("SELECT id, nome, preco_centavos FROM produtos ORDER BY id") } e chame-o em produtos.get("/", ...).',
  ],
  explanation:
    'Listar apenas as colunas necessárias protege a API contra vazamentos acidentais e reduz o tráfego de dados. Manter as consultas SQL isoladas em módulos de banco (src/db/) desacopla a regra de acesso a dados da camada de transporte HTTP, facilitando testes e futuras manutenções.',
  reference: { hono: referencia('hono', 1), fetch: referencia('fetch', 1) },
}

const paginacao: Stage = {
  id: 'paginacao',
  title: 'Paginação por cursor',
  statement: 'Pagine GET /produtos por cursor, sem OFFSET: ?limite= (padrão 20, teto 50) e ?cursor=, respondendo { itens, proximoCursor }.',
  steps: PASSOS_PAGINACAO,
  files: [...listagem.files, 'src/validacao.ts'],
  seed: SEED_PAGINACAO,
  tests: [
    {
      name: 'páginas por cursor sem pular nem repetir',
      sequential: true,
      requests: [
        {
          request: { path: '/produtos?limite=3' },
          expect: { status: 200, body: { itens: produtosPaginados(1, 3), proximoCursor: 9 } },
          save: { c: 'body.proximoCursor' },
        },
        {
          request: { path: '/produtos?limite=3&cursor={{c}}' },
          expect: { status: 200, body: { itens: produtosPaginados(4, 6), proximoCursor: 18 } },
        },
      ],
    },
    {
      name: 'a última página tem proximoCursor null',
      requests: [
        {
          request: { path: '/produtos?limite=5&cursor=174' },
          expect: { status: 200, body: { itens: produtosPaginados(59, 60), proximoCursor: null } },
        },
      ],
    },
    {
      name: 'limite padrão é 20',
      requests: [
        {
          request: { path: '/produtos' },
          expect: { status: 200, body: { itens: produtosPaginados(1, 20), proximoCursor: 60 } },
        },
      ],
    },
    {
      name: 'limite inválido responde 400',
      requests: [
        {
          request: { path: '/produtos?limite=0' },
          expect: { status: 400, body: { status: 400 } },
        },
      ],
    },
    {
      name: 'cursor inválido responde 400',
      requests: [
        {
          request: { path: '/produtos?cursor=-1' },
          expect: { status: 400, body: { status: 400 } },
        },
      ],
    },
    {
      name: 'limite acima do teto é limitado a 50',
      requests: [
        {
          request: { path: '/produtos?limite=1000' },
          expect: { status: 200, body: { itens: produtosPaginados(1, 50), proximoCursor: 150 } },
        },
      ],
    },
  ],
  checklist: [
    { id: 'paginacao-cursor', path: '/produtos?limite=1000', max: 50 },
    { id: 'problem-json', request: { path: '/produtos?limite=0' } },
    { id: 'camadas' },
    { id: 'sem-select-estrela' },
    { id: 'sql-parametrizado' },
  ],
  hints: [
    'Atualize src/db/produtos.ts para receber os parâmetros de paginação e crie a validação com zod em src/validacao.ts.',
    'Para saber se há uma próxima página sem fazer um COUNT(*) custoso, consulte limite + 1 linhas no banco: se vierem mais linhas que o limite, há próxima página e o proximoCursor é o id do último item retornado.',
    'No banco: SELECT id, nome, preco_centavos FROM produtos WHERE id > $1 ORDER BY id LIMIT $2 passando [filtro.cursor, limite + 1]. Aplique Math.min(filtro.limite, LIMITE_MAX) e limite o retorno com linhas.slice(0, limite).',
  ],
  explanation:
    'A paginação por cursor oferece custo O(log n + limite) independente da profundidade da página, pois desce diretamente pelo índice da chave primária (B-Tree) e varre apenas o número de itens solicitado. Além disso, buscar uma linha extra (limite + 1) descobre se existe uma próxima página em uma única consulta, eliminando COUNT(*) redundantes.',
  reference: { hono: referencia('hono', 2), fetch: referencia('fetch', 2) },
}

const busca: Stage = {
  id: 'busca',
  title: 'Busca por texto com índice',
  statement: 'Em GET /produtos?busca=, busque por prefixo do nome, sem diferenciar maiúsculas, apoiada em um índice lower(nome) text_pattern_ops.',
  steps: PASSOS_BUSCA,
  files: [...paginacao.files, 'migrations/002_indice_busca.sql'],
  seed: SEED_BUSCA,
  tests: [
    {
      name: 'acha pelo começo do nome',
      requests: [
        {
          request: { path: '/produtos?busca=tecl' },
          expect: {
            status: 200,
            body: {
              produtos: [
                { id: 1, nome: 'Teclado mecânico', preco_centavos: 34990 },
                { id: 2, nome: 'Teclado sem fio', preco_centavos: 19990 },
              ],
            },
          },
        },
      ],
    },
    {
      name: 'não diferencia maiúsculas de minúsculas',
      requests: [
        {
          request: { path: '/produtos?busca=FONE' },
          expect: {
            status: 200,
            body: {
              produtos: [
                { id: 4, nome: 'Fone de ouvido', preco_centavos: 9990 },
                { id: 5, nome: 'Fone sem fio', preco_centavos: 24990 },
              ],
            },
          },
        },
      ],
    },
    {
      name: 'busca vazia responde 400',
      requests: [
        {
          request: { path: '/produtos?busca=' },
          expect: { status: 400, body: { status: 400 } },
        },
      ],
    },
    {
      name: 'curingas % e _ são tratados como texto literal',
      requests: [
        {
          request: { path: '/produtos?busca=%25' },
          expect: { status: 200, body: { produtos: [] } },
        },
        {
          request: { path: '/produtos?busca=_' },
          expect: { status: 200, body: { produtos: [] } },
        },
      ],
    },
    {
      name: 'termo no meio da palavra retorna vazio',
      requests: [
        {
          request: { path: '/produtos?busca=sem' },
          expect: { status: 200, body: { produtos: [] } },
        },
      ],
    },
    {
      name: 'busca por prefixo retorna exatamente 20 resultados ordenados',
      requests: [
        {
          request: { path: '/produtos?busca=ca' },
          expect: {
            status: 200,
            body: {
              produtos: PRODUTOS_BUSCA_CA,
            },
          },
        },
      ],
    },
    {
      name: 'sem o parâmetro busca lista os produtos como na etapa anterior',
      requests: [
        {
          request: { path: '/produtos?limite=3' },
          expect: {
            status: 200,
            body: {
              itens: [
                { id: 1, nome: 'Teclado mecânico', preco_centavos: 34990 },
                { id: 2, nome: 'Teclado sem fio', preco_centavos: 19990 },
                { id: 3, nome: 'Tela 24 polegadas', preco_centavos: 89990 },
              ],
              proximoCursor: 3,
            },
          },
        },
      ],
    },
    {
      name: 'cria o índice no banco via migração',
      requests: [
        {
          request: { path: '/produtos?busca=tecl' },
          expect: { status: 200 },
        },
      ],
      db: {
        sql: "SELECT count(*)::int AS n FROM pg_indexes WHERE tablename = 'produtos' AND indexname = 'produtos_nome_idx'",
        rows: [{ n: 1 }],
      },
    },
  ],
  checklist: [
    { id: 'problem-json', request: { path: '/produtos?busca=' } },
    { id: 'camadas' },
    { id: 'sem-select-estrela' },
    { id: 'sql-parametrizado' },
    { id: 'paginacao-cursor', path: '/produtos?limite=1000', max: 50 },
    { id: 'indice-busca' },
  ],
  hints: [
    'Crie o arquivo migrations/002_indice_busca.sql com o CREATE INDEX e adicione a função de busca em src/db/produtos.ts.',
    'O índice em lower(nome) só é aproveitado se a consulta usar exatamente a mesma expressão: WHERE lower(nome) LIKE $1 ORDER BY lower(nome) LIMIT 20. Lembre-se de escapar % e _ no prefixo.',
    'Na migração: CREATE INDEX produtos_nome_idx ON produtos (lower(nome) text_pattern_ops);. Na busca: escape curingas com busca.trim().toLowerCase().replace(/[\\\\%_]/g, "\\\\$&") + "%" e lance ErroHttp(400, ...) se a busca estiver vazia.',
  ],
  explanation:
    'Índices em expressões como lower(nome) mantêm uma árvore ordenada dos valores calculados, permitindo que buscas por prefixo (LIKE "abc%") encontrem rapidamente o intervalo desejado. Em collations como pt_BR ou en_US, o índice B-Tree padrão não atende a buscas LIKE por prefixo; a classe de operadores text_pattern_ops faz a ordenação caractere por caractere (C locale), permitindo a busca por intervalo no índice. Sem o índice, toda busca percorreria todas as páginas da tabela no disco. A ordem ORDER BY lower(nome) aproveita a própria ordenação do índice B-Tree, dispensando um passo extra de ordenação em memória.',
  reference: { hono: referencia('hono', 3), fetch: referencia('fetch', 3) },
}

export const cursoBusca: ProjectCourse = {
  baseFiles: { 'src/http.ts': HTTP },
  id: 'busca',
  title: 'Busca e paginação',
  summary: 'Depois do básico: listas grandes com paginação por cursor e busca por texto com índice.',
  stages: [listagem, paginacao, busca],
}
