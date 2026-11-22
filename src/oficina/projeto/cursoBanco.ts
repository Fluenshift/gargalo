// Projeto Banco of the Oficina: guided project created from transferencia.ts and pagamento.ts.

import type { RequestSpec } from '../exercise'
import { referencia } from './cursoBancoRef'
import type { ProjectCourse, Stage } from './stage'

const post = (path: string, body: unknown, headers?: Record<string, string>): RequestSpec => ({ method: 'POST', path, body, headers })

const CONTAS_SEED = "INSERT INTO contas (titular, saldo_centavos) VALUES ('Ana', 10000), ('Bruno', 5000), ('Carla', 0)"
const FINTECH_SEED = `${CONTAS_SEED};\nINSERT INTO pagamentos (chave, valor_centavos) VALUES ('pedido-41', 2500)`

const contas: Stage = {
  id: 'contas',
  title: 'Contas e validação',
  statement:
    'Em sistemas financeiros, dinheiro nunca é armazenado em ponto flutuante (float) devido a imprecisões de arredondamento; valores monetários devem ser inteiros representando centavos. Além disso, validar entradas na borda com Zod e padronizar erros em problem+json (RFC 9457) evita que dados corrompidos cheguem ao banco e garante previsibilidade aos clientes da API.\n\n' +
    'Crie as rotas de contas em src/routes/contas.ts e o acesso ao banco em src/db/contas.ts (tabela contas em migrations/001_contas.sql, com id serial, titular text e saldo_centavos int não negativo).\n' +
    '- POST /contas: recebe { titular, saldo_centavos }, valida com Zod (titular não vazio e saldo_centavos inteiro entre 0 e 2147483647), grava a conta e responde 201 com cabeçalho Location (/contas/:id) e o corpo { id, titular, saldo_centavos }.\n' +
    '- GET /contas: lista todas as contas cadastradas ordenadas por id.\n' +
    '- GET /contas/:id: busca a conta pelo id (200 com a conta, 404 se não existir; id não numérico ou fora da faixa int4 responde 400 problem+json).\n' +
    '- Dados inválidos ou rotas inexistentes respondem 400 ou 404 em application/problem+json com type, title e status.',
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
  statement:
    'Quando duas transferências ocorrem simultaneamente a partir da mesma conta, ler o saldo na memória e depois atualizar gera uma condição de corrida (race condition): ambas leem o saldo antigo e debitam, deixando a conta com saldo negativo. Para garantir consistência financeira, débito e crédito precisam ocorrer dentro de uma transação, e a conferência de saldo deve ser atômica usando um UPDATE condicional ou SELECT ... FOR UPDATE.\n\n' +
    'Crie migrations/002_transferencias.sql com a tabela transferencias (id serial, de int, para int, valor_centavos int, criado_em timestamptz) e a rota POST /transferencias.\n' +
    '- POST /transferencias: recebe { de, para, valor_centavos }, valida com Zod (de e para inteiros positivos diferentes até 2147483647, valor_centavos inteiro positivo até 2147483647).\n' +
    '- Dentro de db.transaction, confira o saldo e debite na conta de origem, credite na conta de destino e grave a transferência.\n' +
    '- Se a conta de origem não tiver saldo suficiente, responda 409 (Conflict) no formato problem+json.\n' +
    '- Se a conta de origem ou de destino não existir, responda 404 problem+json e desfaça qualquer alteração.\n' +
    '- Em caso de sucesso, responda 200 com { de, para, valor_centavos, saldo_centavos }, sendo saldo_centavos o novo saldo da conta de origem.',
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
  statement:
    'Instabilidades de rede em operações de pagamento frequentemente levam clientes a repetir requisições. Sem proteção de idempotência, uma cobrança repetida cobra o cliente duas vezes. Com o cabeçalho Idempotency-Key, o servidor reconhece requisições idênticas já processadas e devolve a resposta original sem executar uma nova cobrança.\n\n' +
    'Crie migrations/003_pagamentos.sql com pagamentos (id serial, chave text UNIQUE, valor_centavos int, criado_em timestamptz) e a rota POST /pagamentos.\n' +
    '- POST /pagamentos: exige o cabeçalho Idempotency-Key e corpo { valor_centavos } (inteiro positivo até 2147483647). Sem o cabeçalho ou com valor inválido, responda 400 problem+json.\n' +
    '- Se for uma chave nova, grave o pagamento e responda 201 com { id, valor_centavos }.\n' +
    '- Se a chave já existir com o mesmo valor, devolva o pagamento existente com status 201 e o mesmo corpo, sem inserir um novo registro.\n' +
    '- Se a chave já existir com valor diferente, responda 422 problem+json ("Chave de idempotência reutilizada") e não crie nenhum registro.\n' +
    '- Duas requisições simultâneas com a mesma chave devem inserir apenas um pagamento e ambas receberem a mesma resposta 201.',
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
  id: 'banco',
  title: 'API do Banco',
  stages: [contas, transferencias, pagamentos],
}
