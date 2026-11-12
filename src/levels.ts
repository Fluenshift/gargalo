import type { Level } from './sim/model'

/** Every level of the career. `src/career.ts` arranges them into companies. */
export const LEVELS: Level[] = [
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
 * The Startup's boss before the company had five levels. It moves to the
 * E-commerce company (#15); until then it is out of the career. A player who
 * beat it keeps `black-friday` in the passed list and its saved design, so
 * both are there again once the level returns under the same id.
 */
export const BLACK_FRIDAY: Level = {
  id: 'black-friday',
  title: 'Black Friday',
  briefing:
    'O time anterior deixou um load balancer com três servidores ligados direto no banco. Às 20s o tráfego triplica, e no pico um servidor cai. Metade das requisições é imagem e CSS. Sobreviva à noite sem quebrar o caixa.',
  durationS: 60,
  mix: { static: 0.5, read: 0.4, write: 0.1 },
  traffic: [
    { from: 0, rps: 1200 },
    { from: 20, rps: 3600 },
    { from: 45, rps: 1200 },
  ],
  failures: [{ kind: 'server', index: 0, from: 25, to: 40 }],
  goals: { minAvailability: 0.985, maxP99Ms: 350, maxCost: 700 },
  start: {
    nodes: [
      { id: 'client', kind: 'client' },
      { id: 'lb', kind: 'lb' },
      { id: 'server-1', kind: 'server' },
      { id: 'server-2', kind: 'server' },
      { id: 'server-3', kind: 'server' },
      { id: 'db', kind: 'db' },
    ],
    edges: [
      { source: 'client', target: 'lb' },
      { source: 'lb', target: 'server-1' },
      { source: 'lb', target: 'server-2' },
      { source: 'lb', target: 'server-3' },
      { source: 'server-1', target: 'db' },
      { source: 'server-2', target: 'db' },
      { source: 'server-3', target: 'db' },
    ],
  },
}
