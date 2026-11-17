// Code challenges: the bottleneck is not in the drawing, it is in the code of one endpoint.
// Each option says what a request costs after the change, so the simulation shows the fix.

import type { CodeChallenge, Kind } from './sim/model'

const DATABASES: Kind[] = ['db', 'shard', 'replica']

/** Orders list each item with its own query: 1 + 20 queries per page. */
export const N_PLUS_ONE: CodeChallenge = {
  id: 'n-mais-um',
  class: 'read',
  title: 'Uma consulta por item',
  code: `// GET /pedidos/:id
async function verPedido(id: string) {
  const pedido = await db.query('SELECT * FROM pedidos WHERE id = $1', [id])
  // Um pedido tem uns 20 itens, e cada volta do for é uma ida ao banco.
  for (const item of pedido.itens) {
    item.produto = await db.query('SELECT * FROM produtos WHERE id = $1', [item.produtoId])
  }
  return pedido
}`,
  bug: [
    { kinds: DATABASES, classes: ['read', 'bot'], factor: 21 },
    { kinds: ['server'], classes: ['read', 'bot'], factor: 1, extraMs: 40 },
  ],
  options: [
    {
      id: 'where-in',
      label: 'Buscar todos os produtos de uma vez',
      code: `const ids = pedido.itens.map((i) => i.produtoId)
const produtos = await db.query('SELECT * FROM produtos WHERE id = ANY($1)', [ids])`,
      fixes: true,
      explanation: 'As 20 consultas viram 1. O banco recebe 2 consultas por página em vez de 21, e o servidor para de esperar 20 idas e voltas.',
      work: [{ kinds: DATABASES, classes: ['read', 'bot'], factor: 2 }],
    },
    {
      id: 'join',
      label: 'Trazer os produtos junto com um JOIN',
      code: `SELECT p.*, pr.* FROM pedidos p
JOIN itens i ON i.pedido_id = p.id
JOIN produtos pr ON pr.id = i.produto_id
WHERE p.id = $1`,
      fixes: true,
      explanation: 'Uma consulta só traz o pedido e os produtos. O banco faz um pouco mais de trabalho nela, mas é uma ida em vez de 21.',
      work: [{ kinds: DATABASES, classes: ['read', 'bot'], factor: 1.3, extraMs: 3 }],
    },
    {
      id: 'cache-item',
      label: 'Guardar cada produto no cache',
      code: `for (const item of pedido.itens) {
  item.produto = await cache.getOrSet(\`produto:\${item.produtoId}\`, () => buscarProduto(item.produtoId))
}`,
      fixes: false,
      explanation:
        'O laço continua: são 20 idas ao cache por página, que somam latência e estouram o cache, e cada produto que não está lá ainda vira uma consulta.',
      work: [
        { kinds: ['cache'], classes: ['read', 'bot'], factor: 21 },
        { kinds: DATABASES, classes: ['read', 'bot'], factor: 21 },
        { kinds: ['server'], classes: ['read', 'bot'], factor: 1, extraMs: 25 },
      ],
    },
    {
      id: 'pool',
      label: 'Aumentar o pool de conexões',
      code: `const db = new Pool({ max: 100 }) // antes: 20`,
      fixes: false,
      explanation: 'Mais conexões deixam mais consultas esperando ao mesmo tempo, mas o banco continua recebendo 21 por página. O gargalo é o número de consultas.',
      work: [
        { kinds: DATABASES, classes: ['read', 'bot'], factor: 21 },
        { kinds: ['server'], classes: ['read', 'bot'], factor: 1, extraMs: 40 },
      ],
    },
  ],
}

/** The catalogue endpoint answers every product at once. */
export const NO_PAGINATION: CodeChallenge = {
  id: 'sem-paginacao',
  class: 'read',
  title: 'O catálogo inteiro numa resposta',
  code: `// GET /produtos
async function listarProdutos() {
  // Devolve os 5.000 produtos da categoria, e a tela mostra 50.
  const produtos = await db.query('SELECT * FROM produtos WHERE categoria = $1', [categoria])
  return JSON.stringify(produtos)
}`,
  bug: [
    { kinds: ['server'], classes: ['read', 'bot'], factor: 4, extraMs: 150 },
    { kinds: DATABASES, classes: ['read', 'bot'], factor: 3, extraMs: 30 },
  ],
  options: [
    {
      id: 'limit',
      label: 'Paginar com LIMIT e um cursor',
      code: `SELECT * FROM produtos
WHERE categoria = $1 AND id > $2
ORDER BY id LIMIT 50`,
      fixes: true,
      explanation: 'Cada página traz 50 produtos. O banco lê pouco, o servidor monta um JSON pequeno, e a próxima página continua de onde a outra parou.',
      work: [],
    },
    {
      id: 'gzip',
      label: 'Comprimir a resposta com gzip',
      code: `app.use(compression())`,
      fixes: false,
      explanation: 'A resposta fica menor na rede, mas o banco ainda lê 5.000 linhas e o servidor ainda monta o JSON inteiro, agora com o custo de comprimir por cima.',
      work: [
        { kinds: ['server'], classes: ['read', 'bot'], factor: 4.4, extraMs: 160 },
        { kinds: DATABASES, classes: ['read', 'bot'], factor: 3, extraMs: 30 },
      ],
    },
    {
      id: 'cache-lista',
      label: 'Guardar a lista inteira no cache',
      code: `const produtos = await cache.getOrSet(\`categoria:\${categoria}\`, () => buscarTodos(categoria))
return JSON.stringify(produtos)`,
      fixes: false,
      explanation: 'O banco descansa, mas cada requisição ainda transforma 5.000 produtos em JSON. O servidor continua sendo o gargalo.',
      work: [{ kinds: ['server'], classes: ['read', 'bot'], factor: 4, extraMs: 150 }],
    },
  ],
}

/** The statement query scans the whole table: there is no index on the account. */
export const NO_INDEX: CodeChallenge = {
  id: 'sem-indice',
  class: 'read',
  title: 'Extrato sem índice',
  code: `// GET /contas/:id/extrato
async function extrato(contaId: string) {
  // 40 milhões de lançamentos, e nenhum índice em conta_id: o banco lê a tabela toda.
  return db.query('SELECT * FROM lancamentos WHERE conta_id = $1 ORDER BY criado_em DESC', [contaId])
}`,
  bug: [{ kinds: DATABASES, classes: ['read', 'bot'], factor: 8, extraMs: 60 }],
  options: [
    {
      id: 'indice',
      label: 'Criar um índice em (conta_id, criado_em)',
      code: `CREATE INDEX lancamentos_conta_data ON lancamentos (conta_id, criado_em DESC)`,
      fixes: true,
      explanation: 'O banco vai direto aos lançamentos da conta, já na ordem. Cada escrita fica um pouco mais cara, porque também atualiza o índice.',
      work: [{ kinds: DATABASES, classes: ['write'], factor: 1.1 }],
    },
    {
      id: 'limit',
      label: 'Trazer só os 50 últimos com LIMIT',
      code: `SELECT * FROM lancamentos WHERE conta_id = $1 ORDER BY criado_em DESC LIMIT 50`,
      fixes: false,
      explanation: 'Sem índice o banco ainda precisa achar e ordenar todos os lançamentos da conta antes de cortar em 50. Lê quase a mesma coisa.',
      work: [{ kinds: DATABASES, classes: ['read', 'bot'], factor: 7, extraMs: 50 }],
    },
    {
      id: 'colunas',
      label: 'Selecionar só as colunas usadas',
      code: `SELECT valor, descricao, criado_em FROM lancamentos WHERE conta_id = $1 ORDER BY criado_em DESC`,
      fixes: false,
      explanation: 'A resposta fica menor, mas o problema é achar as linhas: o banco continua varrendo a tabela inteira.',
      work: [{ kinds: DATABASES, classes: ['read', 'bot'], factor: 8, extraMs: 55 }],
    },
  ],
}
