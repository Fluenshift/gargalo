// Code challenges: the bottleneck is not in the drawing, it is in the code of one endpoint.
// Each option says what a request costs after the change, so the simulation shows the fix.

import type { CodeChallenge, Kind, Work } from './sim/model'

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
      explanation:
        'Mais conexões deixam mais consultas esperando ao mesmo tempo, mas o banco continua recebendo 21 por página. O gargalo é o número de consultas.',
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
      explanation:
        'A resposta fica menor na rede, mas o banco ainda lê 5.000 linhas e o servidor ainda monta o JSON inteiro, agora com o custo de comprimir por cima.',
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

/** The service builds its own database client, so nothing else can be plugged in. */
export const HIDDEN_CLIENT: CodeChallenge = {
  id: 'cliente-escondido',
  class: 'read',
  title: 'Réplica que ninguém usa',
  code: `// GET /produtos/:id
class ProdutoService {
  // O serviço cria a própria conexão, e ela aponta sempre para o primário.
  private db = new PostgresClient(process.env.DB_PRIMARIO)

  async buscar(id: string) {
    return this.db.query('SELECT * FROM produtos WHERE id = $1', [id])
  }
}`,
  bug: [],
  locks: {
    links: [{ from: 'server', to: ['replica', 'cache'] }],
    reason: 'O código do servidor cria a conexão com o banco por dentro. Para ligar a outra peça, o serviço precisa receber a dependência.',
  },
  options: [
    {
      id: 'injecao',
      label: 'Receber leitura e escrita no construtor',
      code: `class ProdutoService {
  constructor(
    private leitura: Leitor,   // réplica, cache, o que quem monta escolher
    private escrita: Escritor, // o primário
  ) {}

  async buscar(id: string) {
    return this.leitura.query('SELECT * FROM produtos WHERE id = $1', [id])
  }
}`,
      fixes: true,
      explanation:
        'Injeção de dependência: o serviço não sabe mais quem está do outro lado. Quem monta a aplicação decide, então dá para pôr um cache na frente da réplica sem mexer no serviço.',
      work: [],
      allows: [{ from: 'server', to: ['replica', 'cache'] }],
    },
    {
      id: 'if-leitura',
      label: 'Criar o cliente da réplica dentro do método',
      code: `async buscar(id: string) {
  const db = ehLeitura ? new ReplicaClient(process.env.DB_REPLICA) : this.db
  return db.query('SELECT * FROM produtos WHERE id = $1', [id])
}`,
      fixes: false,
      explanation:
        'Resolve a réplica hoje, mas o serviço continua escolhendo sozinho com quem fala. Pôr o cache na frente vira outro if, e cada troca nova também. Aqui a réplica sozinha não dá conta das leituras.',
      work: [],
      allows: [{ from: 'server', to: ['replica'] }],
    },
    {
      id: 'singleton',
      label: 'Transformar o cliente num singleton global',
      code: `export const db = new PostgresClient(process.env.DB_PRIMARIO)

class ProdutoService {
  async buscar(id: string) {
    return db.query('SELECT * FROM produtos WHERE id = $1', [id])
  }
}`,
      fixes: false,
      explanation: 'A conexão fica compartilhada, mas continua escondida e apontando para o primário. Nada de fora consegue trocar o que o serviço usa.',
      work: [],
    },
  ],
}

/** The in-house load balancer hands the same share to every server, old or new. */
export const FIXED_ROUND_ROBIN: CodeChallenge = {
  id: 'round-robin-fixo',
  class: 'read',
  title: 'O servidor velho',
  code: `// O load balancer é código da casa.
class Balanceador {
  private proximo = 0

  escolher(servidores: Servidor[]) {
    // Um de cada vez, na ordem: a máquina velha recebe tanto quanto as novas.
    this.proximo = (this.proximo + 1) % servidores.length
    return servidores[this.proximo]
  }
}`,
  bug: [],
  options: [
    {
      id: 'strategy',
      label: 'Extrair uma interface Estrategia e injetar a escolhida',
      code: `interface Estrategia {
  escolher(servidores: Servidor[]): Servidor
}

class MenosConexoes implements Estrategia {
  escolher(servidores: Servidor[]) {
    return minBy(servidores, (s) => s.conexoes / s.capacidade)
  }
}

class Balanceador {
  constructor(private estrategia: Estrategia) {}
  escolher(servidores: Servidor[]) {
    return this.estrategia.escolher(servidores)
  }
}`,
      fixes: true,
      explanation:
        'Strategy: o algoritmo vira uma peça trocável e o balanceador não muda mais. Agora o Load Balancer mostra o seletor: escolha menos conexões, que manda para cada servidor na medida do que ele aguenta.',
      work: [],
      settings: ['balance'],
    },
    {
      id: 'if-velho',
      label: 'Pôr um if para o servidor velho no escolher',
      code: `escolher(servidores: Servidor[]) {
  this.proximo = (this.proximo + 1) % servidores.length
  const s = servidores[this.proximo]
  // O velho só atende uma vez a cada duas.
  if (s.velho) {
    this.pulouVelho = !this.pulouVelho
    if (this.pulouVelho) return this.escolher(servidores)
  }
  return s
}`,
      fixes: true,
      explanation:
        'O velho passa a receber metade e a fase passa. Mas é um caso especial escondido no balanceador: a próxima necessidade (hash consistente para um cache local por servidor) vira outro if no mesmo método.',
      caveat: 'Funciona, mas não escala.',
      work: [],
      balance: 'least-conn',
    },
    {
      id: 'aleatorio',
      label: 'Trocar o % n por um sorteio',
      code: `escolher(servidores: Servidor[]) {
  return servidores[Math.floor(Math.random() * servidores.length)]
}`,
      fixes: false,
      explanation: 'Sorteando, cada servidor ainda recebe a mesma parte em média. A máquina velha continua afogando.',
      work: [],
    },
  ],
}

/** Account SQL is copied all over the service, so no query knows which partition holds the account. */
export const SCATTERED_SQL: CodeChallenge = {
  id: 'sql-espalhado',
  class: 'write',
  title: 'SQL espalhado',
  code: `// POST /lancamentos, e mais 30 lugares parecidos
async function lancar(contaId: string, valor: number) {
  // Cada função monta o próprio SQL e usa o mesmo banco.
  await db.query('INSERT INTO lancamentos (conta_id, valor) VALUES ($1, $2)', [contaId, valor])
  await db.query('UPDATE contas SET saldo = saldo + $2 WHERE id = $1', [contaId, valor])
}

// GET /relatorios/saldos
async function saldos() {
  return db.query('SELECT c.id, SUM(l.valor) FROM contas c JOIN lancamentos l ON l.conta_id = c.id GROUP BY c.id')
}`,
  bug: [],
  locks: {
    links: [
      { from: 'server', to: ['shard'] },
      { from: 'cache', to: ['shard'] },
      { from: 'worker', to: ['shard'] },
    ],
    reason:
      'O SQL das contas está copiado em 30 lugares e ninguém sabe em qual partição a conta mora. Para particionar, o acesso aos dados precisa passar por um lugar só.',
  },
  options: [
    {
      id: 'repository',
      label: 'Pôr todo acesso às contas num ContaRepository',
      code: `class ContaRepository {
  constructor(private particoes: Banco[]) {}

  // A partição sai da chave: a mesma conta cai sempre no mesmo lugar.
  private daConta(contaId: string) {
    return this.particoes[hash(contaId) % this.particoes.length]
  }

  lancar(contaId: string, valor: number) {
    return this.daConta(contaId).transacao(async (db) => {
      await db.query('INSERT INTO lancamentos (conta_id, valor) VALUES ($1, $2)', [contaId, valor])
      await db.query('UPDATE contas SET saldo = saldo + $2 WHERE id = $1', [contaId, valor])
    })
  }
}`,
      fixes: true,
      explanation:
        'Repository: o serviço pede "lance nesta conta" e só o repositório sabe onde ela mora. Com o acesso num lugar só, dá para dividir as contas entre partições sem mexer em mais nada.',
      work: [],
      allows: [
        { from: 'server', to: ['shard'] },
        { from: 'cache', to: ['shard'] },
        { from: 'worker', to: ['shard'] },
      ],
    },
    {
      id: 'adapter',
      label: 'Trocar o driver por um Adapter de banco',
      code: `interface Banco {
  query(sql: string, params?: unknown[]): Promise<Linha[]>
}

class PostgresAdapter implements Banco { /* ... */ }
const db: Banco = new PostgresAdapter(process.env.DB_PRIMARIO)`,
      fixes: false,
      explanation:
        'O Adapter deixa trocar o banco por outro, mas as 30 consultas continuam montando o próprio SQL, com JOIN entre contas. Ninguém ainda escolhe a partição pela conta.',
      work: [],
    },
    {
      id: 'orm',
      label: 'Migrar as consultas para um ORM',
      code: `const conta = await orm.conta.update({
  where: { id: contaId },
  data: { saldo: { increment: valor }, lancamentos: { create: { valor } } },
})`,
      fixes: false,
      explanation:
        'O ORM escreve o SQL por você, mas continua espalhado pelo serviço e falando com um banco só. Trocar a forma de escrever as consultas não diz onde cada conta está.',
      work: [],
    },
  ],
}

/** What the five tasks after a publish cost wherever the write lands while someone waits for them. */
const FIVE_TASKS = (extraMs: number): Work[] => [{ kinds: ['db', 'shard', 'storage'], classes: ['write'], factor: 1, extraMs }]

/** Publishing a video calls the five services that react to it, one after the other. */
export const CHAINED_CALLS: CodeChallenge = {
  id: 'chamadas-encadeadas',
  class: 'write',
  title: 'Cinco chamadas em fila',
  code: `// POST /videos/:id/publicar
async function publicar(id: string) {
  const video = await db.query("UPDATE videos SET status = 'publicado' WHERE id = $1 RETURNING *", [id])
  // O criador espera as cinco, uma depois da outra: 120 + 200 + 60 + 40 + 30 ms.
  await thumbnails.gerar(video)
  await legendas.transcrever(video)
  await notificacoes.avisarSeguidores(video)
  await recomendacoes.atualizar(video)
  await busca.indexar(video)
  return video
}`,
  bug: FIVE_TASKS(450),
  locks: {
    links: [{ from: 'server', to: ['topic', 'queue'] }],
    reason: 'O código chama os cinco serviços direto e espera cada um. Para pôr um tópico ou uma fila no meio, o código precisa mudar.',
  },
  options: [
    {
      id: 'observer',
      label: 'Publicar um evento e deixar cada serviço assinar',
      code: `async function publicar(id: string) {
  const video = await db.query("UPDATE videos SET status = 'publicado' WHERE id = $1 RETURNING *", [id])
  await eventos.publicar('video-publicado', video)
  return video
}

// Cada serviço assina por conta própria; publicar não conhece nenhum.
eventos.assinar('video-publicado', thumbnails.gerar)
eventos.assinar('video-publicado', legendas.transcrever)
eventos.assinar('video-publicado', notificacoes.avisarSeguidores)
eventos.assinar('video-publicado', recomendacoes.atualizar)
eventos.assinar('video-publicado', busca.indexar)`,
      fixes: true,
      explanation:
        'Observer: publicar só avisa que o vídeo saiu, e cada serviço que se interessa assina o evento. Ligue os servidores a um tópico pub/sub e o tópico a um worker por tarefa: o criador recebe a resposta na hora, e um serviço novo é só mais uma assinatura.',
      work: FIVE_TASKS(450),
      allows: [{ from: 'server', to: ['topic'] }],
    },
    {
      id: 'fila',
      label: 'Pôr um job numa fila e um worker que faz as cinco',
      code: `async function publicar(id: string) {
  const video = await db.query("UPDATE videos SET status = 'publicado' WHERE id = $1 RETURNING *", [id])
  await fila.enviar('processar-video', video)
  return video
}

// O worker que pega a mensagem faz as cinco tarefas, uma depois da outra.
fila.consumir('processar-video', async (video) => {
  await thumbnails.gerar(video)
  await legendas.transcrever(video)
  await notificacoes.avisarSeguidores(video)
  await recomendacoes.atualizar(video)
  await busca.indexar(video)
})`,
      fixes: true,
      explanation:
        'O criador para de esperar: a fila responde na hora. Mas cada mensagem vai para um consumidor só, então um worker faz as cinco tarefas em sequência: se a notificação falha, o thumbnail é refeito, e o sexto serviço vai mexer nesse worker de novo.',
      caveat: 'Funciona, mas o worker conhece as cinco tarefas.',
      work: FIVE_TASKS(450),
      allows: [{ from: 'server', to: ['queue'] }],
    },
    {
      id: 'paralelo',
      label: 'Chamar os cinco em paralelo com Promise.all',
      code: `await Promise.all([
  thumbnails.gerar(video),
  legendas.transcrever(video),
  notificacoes.avisarSeguidores(video),
  recomendacoes.atualizar(video),
  busca.indexar(video),
])`,
      fixes: false,
      explanation:
        'O criador ainda espera o mais lento, os 200 ms das legendas, e se um dos cinco cai a publicação inteira falha. Quem publica continua conhecendo cada serviço.',
      work: FIVE_TASKS(200),
    },
    {
      id: 'sem-await',
      label: 'Disparar as cinco chamadas sem await',
      code: `thumbnails.gerar(video)
legendas.transcrever(video)
notificacoes.avisarSeguidores(video)
recomendacoes.atualizar(video)
busca.indexar(video)
return video // responde antes de as chamadas terminarem`,
      fixes: false,
      explanation:
        'A resposta sai na hora, mas as cinco chamadas continuam rodando dentro do servidor, segurando conexões e memória: cada publicação pesa como 12 requisições. E se o servidor reinicia no meio, as tarefas somem sem ninguém saber.',
      work: [{ kinds: ['server'], classes: ['write'], factor: 12 }],
    },
  ],
}
