import type { Level } from './sim/model'

export const LEVELS: Level[] = [
  {
    id: 'primeiro-deploy',
    title: 'Primeiro deploy',
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
  },
]
