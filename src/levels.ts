import type { ArchEdge, Architecture, Level } from './sim/model'

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
  goals: { minAvailability: 0.985, maxP99Ms: 700, maxCost: 1000 },
  tweaks: LONG_TAIL_CATALOG,
  start: withPayment({}),
}

/** Every level of the career. `src/career.ts` arranges them into companies. */
export const LEVELS: Level[] = [...STARTUP_LEVELS, ...ECOMMERCE_LEVELS, BLACK_FRIDAY]
