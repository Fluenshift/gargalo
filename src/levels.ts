import { FIXED_ROUND_ROBIN, HIDDEN_CLIENT, SCATTERED_SQL, NO_INDEX, NO_PAGINATION, N_PLUS_ONE } from './code'
import type { ArchEdge, Architecture, Level, Work } from './sim/model'

/** The Startup's levels and boss. */
export const STARTUP_LEVELS: Level[] = [
  {
    id: 'colocar-no-ar',
    title: 'Colocar no ar',
    briefing:
      'O app está pronto e os primeiros 200 usuários por segundo vão chegar. Um servidor aguenta 400 req/s, mas não guarda nada: cadastros e pedidos precisam ficar salvos em algum lugar. O caixa paga até $200 por mês.',
    durationS: 30,
    mix: { static: 0.3, read: 0.5, write: 0.2 },
    traffic: [{ from: 0, rps: 200 }],
    failures: [],
    goals: { minAvailability: 0.99, maxP99Ms: 250, maxCost: 200 },
  },
  {
    id: 'primeiro-deploy',
    title: 'Saiu no jornal',
    briefing:
      'Seu app saiu no jornal da faculdade. São 900 requisições por segundo, e um servidor sozinho aguenta 400. Coloque o app no ar sem estourar o orçamento.',
    durationS: 30,
    mix: { static: 0.3, read: 0.5, write: 0.2 },
    traffic: [{ from: 0, rps: 900 }],
    failures: [],
    goals: { minAvailability: 0.99, maxP99Ms: 400, maxCost: 350 },
  },
  {
    id: 'banco-nao-aguenta',
    title: 'O banco não aguenta',
    briefing:
      'O tráfego subiu para 1.800 req/s e quase tudo é leitura. O banco aguenta 1.000 req/s e custa caro. Encontre outro jeito de responder as leituras.',
    durationS: 30,
    mix: { static: 0.1, read: 0.8, write: 0.1 },
    traffic: [{ from: 0, rps: 1800 }],
    failures: [],
    goals: { minAvailability: 0.99, maxP99Ms: 330, maxCost: 550 },
  },
  {
    id: 'imagens-pesadas',
    title: 'Imagens pesadas',
    briefing:
      'O app agora é cheio de fotos: 70% das 3.000 req/s são imagens, CSS e scripts, iguais para todo mundo. Cada servidor aguenta 400 req/s e custa $50. O caixa paga até $420 por mês.',
    durationS: 30,
    mix: { static: 0.7, read: 0.25, write: 0.05 },
    traffic: [{ from: 0, rps: 3000 }],
    failures: [],
    goals: { minAvailability: 0.99, maxP99Ms: 300, maxCost: 420 },
  },
  {
    id: 'pedidos-em-loop',
    title: 'Pedidos em loop',
    briefing:
      'A tela do pedido ficou lenta e o banco vive no limite, com só 1.200 req/s. Antes de comprar máquina, abra um servidor e leia o código de GET /pedidos/:id. O banco é um só: não dá para dividir.',
    durationS: 30,
    mix: { static: 0.2, read: 0.7, write: 0.1 },
    traffic: [{ from: 0, rps: 1200 }],
    failures: [],
    code: [N_PLUS_ONE],
    endpoints: { read: 'GET /pedidos/:id' },
    goals: { minAvailability: 0.99, maxP99Ms: 480, maxCost: 400 },
    start: {
      nodes: [
        { id: 'client', kind: 'client' },
        { id: 'cdn', kind: 'cdn' },
        { id: 'lb', kind: 'lb' },
        { id: 'server-1', kind: 'server' },
        { id: 'server-2', kind: 'server' },
        { id: 'server-3', kind: 'server' },
        { id: 'cache', kind: 'cache' },
        { id: 'db', kind: 'db' },
      ],
      edges: [
        { source: 'client', target: 'cdn' },
        { source: 'cdn', target: 'lb' },
        ...['server-1', 'server-2', 'server-3'].flatMap((s) => [
          { source: 'lb', target: s },
          { source: s, target: 'cache' },
        ]),
        { source: 'cache', target: 'db' },
      ],
    },
  },
  {
    id: 'caiu-de-madrugada',
    title: 'Caiu de madrugada',
    briefing:
      'Às 3h da manhã o servidor travou e ficou meio minuto fora do ar até alguém acordar. O tráfego é baixo, 200 req/s, e um servidor aguenta 400. Desta vez, uma pane não pode derrubar o app.',
    durationS: 60,
    mix: { static: 0.2, read: 0.6, write: 0.2 },
    traffic: [{ from: 0, rps: 200 }],
    failures: [{ kind: 'server', index: 0, from: 15, to: 45 }],
    goals: { minAvailability: 0.99, maxP99Ms: 250, maxCost: 280 },
  },
  {
    id: 'materia-na-tv',
    title: 'Matéria na TV',
    briefing:
      'O app vai aparecer no jornal da noite. Em 5 segundos o tráfego vai de 400 para 4.000 req/s e fica lá até o fim da matéria, e no meio do pico um servidor cai. 60% das requisições são imagens e CSS da página inicial. O caixa paga até $600 por mês.',
    durationS: 60,
    mix: { static: 0.6, read: 0.35, write: 0.05 },
    traffic: [
      { from: 0, rps: 400 },
      { from: 15, rps: 1200 },
      { from: 16, rps: 2000 },
      { from: 17, rps: 2800 },
      { from: 18, rps: 3600 },
      { from: 19, rps: 4000 },
      { from: 45, rps: 800 },
    ],
    failures: [{ kind: 'server', index: 0, from: 25, to: 40 }],
    goals: { minAvailability: 0.99, maxP99Ms: 350, maxCost: 600 },
  },
]

/**
 * What the Startup left behind and the E-commerce inherits: a CDN in front, a
 * load balancer with four servers, a cache and the database.
 */
export const STARTUP_LEGACY: Architecture = {
  nodes: [
    { id: 'client', kind: 'client' },
    { id: 'cdn', kind: 'cdn' },
    { id: 'lb', kind: 'lb' },
    { id: 'server-1', kind: 'server' },
    { id: 'server-2', kind: 'server' },
    { id: 'server-3', kind: 'server' },
    { id: 'server-4', kind: 'server' },
    { id: 'cache', kind: 'cache' },
    { id: 'db', kind: 'db' },
  ],
  edges: [
    { source: 'client', target: 'cdn' },
    { source: 'cdn', target: 'lb' },
    ...['server-1', 'server-2', 'server-3', 'server-4'].flatMap((s) => [
      { source: 'lb', target: s },
      { source: s, target: 'cache' },
    ]),
    { source: 'cache', target: 'db' },
  ],
}

/** The legacy drawing with every server calling the payment API through links like `link`. */
function withPayment(link: Omit<ArchEdge, 'source' | 'target'>): Architecture {
  const servers = STARTUP_LEGACY.nodes.filter((n) => n.kind === 'server')
  return {
    nodes: [...STARTUP_LEGACY.nodes, { id: 'payment', kind: 'payment' }],
    edges: [...STARTUP_LEGACY.edges, ...servers.map((n) => ({ source: n.id, target: 'payment', ...link }))],
  }
}

/** A catalog so large that few products are looked at twice: the cache rarely hits. */
const LONG_TAIL_CATALOG: Level['tweaks'] = { cache: { serves: { read: 0.3, bot: 0.3 } } }

const FOUR_SERVERS = ['server-1', 'server-2', 'server-3', 'server-4']
const EIGHT_SERVERS = Array.from({ length: 8 }, (_, i) => `server-${i + 1}`)

export const ECOMMERCE_LEVELS: Level[] = [
  {
    id: 'checkout-travando',
    title: 'Checkout travando',
    briefing:
      'Você foi contratado pela loja. Todo pedido grava no banco antes de responder ao cliente, e hoje tem cupom: das 15s às 35s o tráfego dobra para 1.800 req/s, metade são pedidos. O banco aguenta 1.000 req/s e, perto disso, cada pedido espera a vez dele. A loja paga até $700 por mês.',
    durationS: 60,
    mix: { static: 0.4, read: 0.1, write: 0.5 },
    traffic: [
      { from: 0, rps: 900 },
      { from: 15, rps: 1800 },
      { from: 35, rps: 900 },
    ],
    failures: [],
    goals: { minAvailability: 0.99, maxP99Ms: 250, maxCost: 700 },
  },
  {
    id: 'catalogo-gigante',
    title: 'Catálogo gigante',
    briefing:
      'A loja agora vende 2 milhões de produtos e quase ninguém olha o mesmo: aqui o cache acerta só 30% das leituras. O tráfego sobe para 2.000 req/s, 60% leituras do catálogo, e o banco aguenta 1.000 req/s. Preço desatualizado irrita: no máximo 3% das leituras podem vir velhas. Orçamento de $720 por mês.',
    durationS: 60,
    mix: { static: 0.3, read: 0.6, write: 0.1 },
    traffic: [
      { from: 0, rps: 1000 },
      { from: 10, rps: 2000 },
    ],
    failures: [],
    goals: { minAvailability: 0.99, maxP99Ms: 350, maxCost: 720, maxStaleReads: 0.03 },
    tweaks: LONG_TAIL_CATALOG,
  },
  {
    id: 'replica-parada',
    title: 'Réplica que ninguém usa',
    briefing:
      'O time comprou uma réplica de leitura para aliviar o banco, mas ela está parada: o banco recebe 2.200 req/s, 80% leituras, e aguenta 1.000. O cache acerta metade das leituras do catálogo. Antes de ligar qualquer coisa ao servidor, leia o código de GET /produtos/:id. Orçamento de $750 por mês.',
    durationS: 30,
    mix: { static: 0.1, read: 0.8, write: 0.1 },
    traffic: [{ from: 0, rps: 2200 }],
    failures: [],
    code: [HIDDEN_CLIENT],
    goals: { minAvailability: 0.99, maxP99Ms: 450, maxCost: 750 },
    tweaks: { cache: { serves: { read: 0.5, bot: 0.5 } } },
    start: {
      nodes: [
        { id: 'client', kind: 'client' },
        { id: 'lb', kind: 'lb' },
        ...EIGHT_SERVERS.map((id) => ({ id, kind: 'server' as const })),
        { id: 'db', kind: 'db' },
        { id: 'replica', kind: 'replica' },
      ],
      edges: [
        { source: 'client', target: 'lb' },
        ...EIGHT_SERVERS.flatMap((s) => [
          { source: 'lb', target: s },
          { source: s, target: 'db' },
        ]),
        { source: 'db', target: 'replica' },
      ],
    },
  },
  {
    id: 'catalogo-sem-paginacao',
    title: 'Catálogo sem paginação',
    briefing:
      'A página de categoria demora segundos e os servidores fervem com só 1.000 req/s. Nada mudou no tráfego: mudou o código de GET /produtos. Abra um servidor e leia. A loja paga até $500 por mês.',
    durationS: 30,
    mix: { static: 0.3, read: 0.6, write: 0.1 },
    traffic: [{ from: 0, rps: 1000 }],
    failures: [],
    code: [NO_PAGINATION],
    endpoints: { read: 'GET /produtos' },
    goals: { minAvailability: 0.99, maxP99Ms: 250, maxCost: 500 },
  },
  {
    id: 'bot-de-precos',
    title: 'Bot de preços',
    briefing:
      'Um concorrente pôs um bot para copiar nossos preços. A partir de 10s ele manda 2.500 req/s, sozinho, contra 900 req/s de clientes de verdade. Servidor a mais custa caro: a loja paga até $450 por mês.',
    durationS: 60,
    mix: { static: 0.3, read: 0.55, write: 0.15 },
    traffic: [{ from: 0, rps: 900 }],
    bot: [
      { from: 0, rps: 0 },
      { from: 10, rps: 2500 },
    ],
    failures: [],
    goals: { minAvailability: 0.99, maxP99Ms: 300, maxCost: 450 },
  },
  {
    id: 'pagamento-instavel',
    title: 'Pagamento instável',
    briefing:
      'Os pedidos passam pela API de pagamento de outra empresa, que aguenta 600 req/s e cai algumas vezes por noite: hoje aos 12s e aos 32s, 3 segundos de cada vez. O time anterior configurou 3 tentativas extras em cada chamada. Com o pagamento fora não há pedido que passe, mas a loja não pode cair junto. Orçamento de $450.',
    durationS: 60,
    mix: { static: 0.4, read: 0.4, write: 0.2 },
    traffic: [{ from: 0, rps: 1500 }],
    failures: [
      { kind: 'payment', index: 0, from: 12, to: 15 },
      { kind: 'payment', index: 0, from: 32, to: 35 },
    ],
    goals: { minAvailability: 0.94, maxP99Ms: 800, maxCost: 450 },
    start: withPayment({ retries: 3 }),
  },
  {
    id: 'servidor-velho',
    title: 'O servidor velho',
    briefing:
      'Um dos quatro servidores é uma máquina antiga: aguenta 200 req/s, metade dos outros. O load balancer é código da casa e manda a mesma parte para todos, então a máquina velha afoga com 1.000 req/s. Trocar a máquina ou comprar outra estoura o orçamento de $400. Leia o código do balanceador.',
    durationS: 30,
    mix: { static: 0.3, read: 0.5, write: 0.2 },
    traffic: [{ from: 0, rps: 1000 }],
    failures: [],
    code: [FIXED_ROUND_ROBIN],
    nodeTweaks: [{ id: 'server-1', capacity: 200 }],
    goals: { minAvailability: 0.99, maxP99Ms: 450, maxCost: 400 },
    start: {
      nodes: [
        { id: 'client', kind: 'client' },
        { id: 'lb', kind: 'lb' },
        ...FOUR_SERVERS.map((id) => ({ id, kind: 'server' as const })),
        { id: 'cache', kind: 'cache' },
        { id: 'db', kind: 'db' },
      ],
      edges: [
        { source: 'client', target: 'lb' },
        ...FOUR_SERVERS.flatMap((s) => [
          { source: 'lb', target: s },
          { source: s, target: 'cache' },
        ]),
        { source: 'cache', target: 'db' },
      ],
    },
  },
]

export const BLACK_FRIDAY: Level = {
  id: 'black-friday',
  title: 'Black Friday',
  briefing:
    'Black Friday. O tráfego sobe 8×, de 500 para 4.000 req/s, e fica lá até os 40s. Junto vem o bot do concorrente com 2.000 req/s, a API de pagamento cai aos 24s por 3 segundos e uma réplica do catálogo cai aos 28s. O catálogo continua gigante: o cache acerta 30%. A loja paga até $1.000 por mês.',
  durationS: 60,
  mix: { static: 0.5, read: 0.4, write: 0.1 },
  traffic: [
    { from: 0, rps: 500 },
    { from: 12, rps: 2000 },
    { from: 15, rps: 4000 },
    { from: 40, rps: 1000 },
  ],
  bot: [
    { from: 0, rps: 0 },
    { from: 15, rps: 2000 },
    { from: 40, rps: 0 },
  ],
  failures: [
    { kind: 'payment', index: 0, from: 24, to: 27 },
    { kind: 'replica', index: 0, from: 28, to: 40 },
  ],
  goals: { minAvailability: 0.985, maxP99Ms: 800, maxCost: 1000 },
  tweaks: LONG_TAIL_CATALOG,
  start: withPayment({}),
}

export const FINTECH_LEVELS: Level[] = [
  {
    id: 'transferencia-duplicada',
    title: 'Transferência duplicada',
    briefing:
      'Você entrou numa fintech. Toda transferência passa pela API do banco parceiro, que falha à toa em 15% das chamadas, mesmo sem carga. O time anterior pôs 2 tentativas extras e o app parou de dar erro, mas clientes reclamam de Pix pago duas vezes: às vezes a API faz a transferência e só a resposta se perde. Nenhuma transferência pode sair duplicada. Orçamento de $450.',
    durationS: 60,
    mix: { static: 0.3, read: 0.4, write: 0.3 },
    traffic: [{ from: 0, rps: 900 }],
    failures: [],
    goals: { minAvailability: 0.98, maxP99Ms: 1000, maxCost: 450, maxDuplicates: 0 },
    tweaks: { payment: { flaky: 0.15 } },
    endpoints: { static: 'GET /comprovantes/:id', read: 'GET /contas/:id/saldo', write: 'POST /transferencias' },
    start: withPayment({ retries: 2 }),
  },
  {
    id: 'livro-razao',
    title: 'Livro-razão',
    briefing:
      'O livro-razão grava cada centavo que entra e sai: são 2.600 req/s, 60% escritas, e um banco aguenta 1.000 req/s. Réplica só ajuda leitura. Um lojista gigante concentra 35% de todas as operações na conta dele. A fintech paga até $1.050 por mês.',
    durationS: 60,
    mix: { static: 0.1, read: 0.3, write: 0.6 },
    traffic: [{ from: 0, rps: 2600 }],
    hotKey: 0.35,
    endpoints: { static: 'GET /extratos/:mes.pdf', read: 'GET /contas/:id/extrato', write: 'POST /lancamentos' },
    failures: [],
    goals: { minAvailability: 0.99, maxP99Ms: 600, maxCost: 1050 },
  },
  {
    id: 'sql-espalhado',
    title: 'SQL espalhado',
    briefing:
      'A fintech cresceu e os lançamentos passaram de 1.400 por segundo: o banco aguenta 1.000. A saída é particionar as contas, mas o SQL delas está copiado pelo serviço inteiro. Antes de ligar qualquer partição, leia o código de POST /lancamentos. Orçamento de $750 por mês.',
    durationS: 30,
    mix: { static: 0.1, read: 0.3, write: 0.6 },
    traffic: [{ from: 0, rps: 2400 }],
    endpoints: { static: 'GET /extratos/:mes.pdf', read: 'GET /contas/:id/saldo', write: 'POST /lancamentos' },
    failures: [],
    code: [SCATTERED_SQL],
    goals: { minAvailability: 0.99, maxP99Ms: 600, maxCost: 750 },
  },
  {
    id: 'extrato-lento',
    title: 'Extrato lento',
    briefing:
      'Todo cliente abre o extrato depois de uma transferência, e ele muda a cada lançamento: o cache acerta só 30%. O banco não dá conta de 900 req/s. Partições e réplicas custam caro; leia antes o código de GET /contas/:id/extrato. Orçamento de $550 por mês.',
    durationS: 30,
    mix: { static: 0.2, read: 0.6, write: 0.2 },
    traffic: [{ from: 0, rps: 900 }],
    failures: [],
    code: [NO_INDEX],
    endpoints: { read: 'GET /contas/:id/extrato', write: 'POST /transferencias' },
    tweaks: { cache: { serves: { read: 0.3, bot: 0.3 } } },
    goals: { minAvailability: 0.99, maxP99Ms: 300, maxCost: 550 },
  },
  {
    id: 'clientes-na-europa',
    title: 'Clientes na Europa',
    briefing:
      'A fintech abriu em Portugal e 60% dos clientes agora estão na Europa. Tudo roda em São Paulo, a 200 ms de ida e volta de Frankfurt, e o app de quem está lá ficou lento. Quase tudo é consulta de saldo e extrato; transferências são 0,5%. O p99 tem que ficar abaixo de 150 ms. Orçamento de $800.',
    durationS: 60,
    mix: { static: 0.4, read: 0.595, write: 0.005 },
    traffic: [{ from: 0, rps: 1200 }],
    users: { sa: 0.4, eu: 0.6 },
    endpoints: { static: 'GET /app/:arquivo', read: 'GET /contas/:id/saldo', write: 'POST /transferencias' },
    failures: [],
    goals: { minAvailability: 0.99, maxP99Ms: 150, maxCost: 800, maxStaleReads: 0.02 },
  },
]

export const FECHAMENTO_DO_MES: Level = {
  id: 'fechamento-do-mes',
  title: 'Fechamento do mês',
  briefing:
    'Último dia do mês: metade dos clientes está no Brasil e metade nos Estados Unidos, e o tráfego dobra para 3.000 req/s aos 15s. Aos 20s a região de São Paulo inteira cai e só volta aos 35s. Consultas e transferências (10%) precisam continuar. Orçamento de $1.200.',
  durationS: 60,
  mix: { static: 0.3, read: 0.6, write: 0.1 },
  traffic: [
    { from: 0, rps: 1500 },
    { from: 15, rps: 3000 },
  ],
  users: { sa: 0.5, us: 0.5 },
  regionOutages: [{ region: 'sa', from: 20, to: 35 }],
  endpoints: { static: 'GET /faturas/:id.pdf', read: 'GET /contas/:id/saldo', write: 'POST /transferencias' },
  failures: [],
  goals: { minAvailability: 0.985, maxP99Ms: 400, maxCost: 1200 },
}

/** A 500 MB upload through the app holds a server like 20 clicks, and for longer. */
const HEAVY_UPLOADS: Work[] = [{ kinds: ['server'], classes: ['write'], factor: 20, extraMs: 300 }]
/** A text search in the database reads the whole table of videos: it weighs like 4 reads. */
const SEARCH_IN_DB: Work[] = [{ kinds: ['db', 'shard', 'replica'], classes: ['read', 'bot'], factor: 4 }]
const STREAMING_ROUTES: Level['endpoints'] = { static: 'GET /videos/:id/trechos/:n', read: 'GET /busca', write: 'POST /videos' }

export const STREAMING_LEVELS: Level[] = [
  {
    id: 'upload-trava-servidor',
    title: 'Upload que trava o servidor',
    briefing:
      'Você entrou numa plataforma de vídeo. Cada upload tem uns 500 MB e passa inteiro pelo servidor até o banco: prende o servidor como 20 requisições comuns. São 1.000 req/s, 10% uploads e 60% trechos de vídeo. Orçamento de $450.',
    durationS: 30,
    mix: { static: 0.6, read: 0.3, write: 0.1 },
    traffic: [{ from: 0, rps: 1000 }],
    failures: [],
    work: HEAVY_UPLOADS,
    endpoints: { ...STREAMING_ROUTES, read: 'GET /videos/:id' },
    goals: { minAvailability: 0.99, maxP99Ms: 300, maxCost: 450 },
  },
]

export const ESTREIA_DE_SERIE: Level = {
  id: 'estreia-de-serie',
  title: 'Estreia de série',
  briefing:
    'Estreia da série mais esperada do ano. Aos 15s o tráfego sobe de 2.000 para 12.000 req/s e fica lá até os 45s: 85% são trechos do mesmo episódio, 12% buscas e 3% uploads. O episódio é novo e a CDN acerta só 80% dos trechos. Busca no banco varre a tabela, e no máximo 5% das buscas podem perder um vídeo novo. Orçamento de $650.',
  durationS: 60,
  mix: { static: 0.85, read: 0.12, write: 0.03 },
  traffic: [
    { from: 0, rps: 2000 },
    { from: 15, rps: 6000 },
    { from: 16, rps: 12000 },
    { from: 45, rps: 3000 },
  ],
  failures: [],
  work: [...HEAVY_UPLOADS, ...SEARCH_IN_DB],
  tweaks: { cdn: { serves: { static: 0.8, read: 0.1, bot: 0.1 } }, cache: { serves: { read: 0.2, bot: 0.2 } } },
  endpoints: { ...STREAMING_ROUTES, static: 'GET /series/:id/episodios/1/trechos/:n' },
  goals: { minAvailability: 0.985, maxP99Ms: 400, maxCost: 650, maxStaleReads: 0.05 },
}

/** Every level of the career. `src/career.ts` arranges them into companies. */
export const LEVELS: Level[] = [
  ...STARTUP_LEVELS,
  ...ECOMMERCE_LEVELS,
  BLACK_FRIDAY,
  ...FINTECH_LEVELS,
  FECHAMENTO_DO_MES,
  ...STREAMING_LEVELS,
  ESTREIA_DE_SERIE,
]
