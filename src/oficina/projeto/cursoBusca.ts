// Projeto 2 of the Oficina: Busca e paginação, in three stages.
// Based on the old exercises paginacao.ts and busca.ts.

import { referencia } from './cursoBuscaRef'
import type { ProjectCourse, Stage } from './stage'

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

const listagem: Stage = {
  id: 'listagem',
  title: 'Listagem simples de produtos',
  statement:
    'Uma API que expõe dados para o cliente precisa listar recursos de forma previsível, segura e eficiente. Usar SELECT * traz colunas desnecessárias, gasta largura de banda e corre o risco de vazar campos internos ou quebrar contratos caso a tabela mude no futuro. ' +
    'Em GET /produtos, responda 200 com a lista de produtos em JSON [{ id, nome, preco_centavos }], ordenados por id crescente. ' +
    'A consulta ao banco deve selecionar explicitamente apenas as colunas id, nome, preco_centavos (sem SELECT *) e ficar isolada em src/db/produtos.ts, mantendo as rotas apenas com o tratamento HTTP. Qualquer rota inexistente deve responder 404 no formato problem+json (RFC 9457).',
  files: ['src/index.ts', 'src/routes/health.ts', 'src/routes/produtos.ts', 'src/db/saude.ts', 'src/db/produtos.ts', 'src/env.ts', 'src/http.ts', 'migrations/001_init.sql'],
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
  checklist: [
    { id: 'camadas' },
    { id: 'sem-select-estrela' },
    { id: 'sql-parametrizado' },
    { id: 'problem-json', request: { path: '/nada' } },
  ],
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
  statement:
    'Conforme o volume de dados cresce, devolver todos os registros de uma só vez satura a memória do servidor e a rede do cliente. A paginação por OFFSET é problemática: o banco precisa varrer e descartar todas as linhas anteriores, tornando páginas fundas lentas e suscetíveis a pular ou repetir itens caso ocorram inserções simultâneas. ' +
    'Com paginação por cursor (chave), a consulta busca diretamente WHERE id > $1 ORDER BY id LIMIT $2, aproveitando o índice da chave primária. ' +
    'Em GET /produtos?limite=&cursor=, devolva 200 com { "itens": [{ id, nome, preco_centavos }], "proximoCursor": number | null }. ' +
    'O parâmetro cursor define a partir de qual id buscar (padrão 0; se for menor que 0 ou inválido, responda 400 problem+json). O parâmetro limite define a quantidade máxima de itens na página (padrão 20, com teto máximo de 50: se o cliente pedir mais de 50, devolva 50; se for menor que 1 ou inválido, responda 400 problem+json). ' +
    'proximoCursor é o id do último item da página atual, ou null caso seja a última página.',
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
  statement:
    'Fazer buscas textuais com WHERE lower(nome) LIKE $1 em tabelas com milhares de linhas obriga o banco a realizar uma varredura sequencial (Seq Scan), inspecionando cada linha e causando gargalos de latência. Criar um índice funcional sobre a expressão (CREATE INDEX ... ON produtos (lower(nome) text_pattern_ops)) permite que o banco faça uma busca por intervalo no índice (Index Scan), respondendo em poucos milissegundos. ' +
    'Crie a migração migrations/002_indice_busca.sql com o comando CREATE INDEX produtos_nome_idx ON produtos (lower(nome) text_pattern_ops);. ' +
    'Em GET /produtos?busca=, responda 200 com até 20 produtos cujo nome comece com o termo pesquisado, sem diferenciar maiúsculas de minúsculas, ordenados pelo nome em minúsculas: { "produtos": [{ id, nome, preco_centavos }] }. ' +
    'Caracteres curinga do SQL (% e _) devem ser tratados como texto literal. Se busca vier vazio (?busca=), responda 400 no formato problem+json; sem o parâmetro, a rota continua listando como na etapa anterior.',
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
          expect: { status: 200, body: { itens: [{ id: 1, nome: 'Teclado mecânico', preco_centavos: 34990 }, { id: 2, nome: 'Teclado sem fio', preco_centavos: 19990 }, { id: 3, nome: 'Tela 24 polegadas', preco_centavos: 89990 }], proximoCursor: 3 } },
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
  id: 'busca',
  title: 'Busca e paginação',
  stages: [listagem, paginacao, busca],
}
