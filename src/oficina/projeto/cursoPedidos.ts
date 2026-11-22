// Projeto 1 of the Oficina: the E-commerce orders API, in six stages (docs/specs/oficina-projetos.md).
// To plug it in, register `cursoPedidos` where the Projetos screen lists its courses.

import type { RequestSpec, TestStep } from '../exercise'
import type { CheckRef } from './checklist'
import { referencia } from './cursoPedidosRef'
import type { ProjectCourse, Stage } from './stage'

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

const health: Stage = {
  id: 'health',
  title: 'Health check',
  statement:
    'GET /health responde 200 com { "status": "ok" } depois de falar com o banco (SELECT 1). Qualquer rota que não existe responde 404 no formato problem+json (RFC 9457): Content-Type application/problem+json, com type, title e status.',
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
    'Rotas de produtos, com o SQL num módulo em src/db/ e as rotas só cuidando de HTTP: POST /produtos cria (201, Location e o produto no corpo), GET /produtos lista por id, GET /produtos/:id lê, PUT /produtos/:id troca nome e preço (200) e DELETE /produtos/:id remove (204). Produto que não existe responde 404 problem+json. Colunas: id, nome, preco_centavos.',
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
    'Crie as tabelas em migrations/002_pedidos.sql: pedidos (id, total_centavos, criado_em) e itens_pedido (id, pedido_id, produto_id, quantidade, preco_centavos). POST /pedidos recebe { itens: [{ produtoId, quantidade }] }, grava o pedido e os itens copiando o preço atual de cada produto, calcula o total e responde 201 com Location. Se algum produto não existe, responde 422 e nada fica gravado. GET /pedidos/:id devolve o pedido com { id, total_centavos, itens: [{ produto_id, quantidade, preco_centavos }] }.',
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
    'Valide a entrada na borda com zod, em src/validacao.ts. POST e PUT de produto exigem nome não vazio e preco_centavos inteiro maior ou igual a zero; POST /pedidos exige ao menos um item com produtoId e quantidade inteiros maiores que zero. Entrada inválida responde 400 problem+json, com a lista de campos inválidos em erros: [{ campo, mensagem }], sem chegar ao banco. Todo erro da API sai em problem+json.',
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
    'GET /produtos passa a devolver { itens, proximoCursor }: paginado por cursor (id), parâmetros cursor (padrão 0) e limite (padrão 20, no máximo 50: um limite maior vira 50; limite menor que 1 é 400). proximoCursor é o id do último item da página, ou null na última. Filtros: q (parte do nome, sem diferenciar maiúsculas), preco_min e preco_max (em centavos, inclusive). Valide os parâmetros com zod.',
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
  stages: [health, produtos, pedidos, validacao, paginacao, auth],
}
