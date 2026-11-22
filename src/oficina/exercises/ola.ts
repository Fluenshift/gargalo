import type { OficinaExercise } from '../exercises'

export const ola: OficinaExercise = {
  id: 'ola',
  company: 'Aquecimento',
  title: 'GET /ola: primeira resposta',
  statement:
    'Responda a GET /ola com status 200 e o JSON { "mensagem": "olá" }. Se vier ?nome=Ana na URL, a mensagem vira "olá, Ana". Este exercício não usa banco.',
  schema: '',
  seed: '',
  starter: `export default async function handler(req: Request, ctx: Ctx): Promise<Response> {
  return new Response('olá')
}
`,
  visible: [
    { name: 'responde olá em JSON', requests: [{ request: { path: '/ola' }, expect: { status: 200, body: { mensagem: 'olá' } } }] },
    { name: 'usa o nome da URL', requests: [{ request: { path: '/ola?nome=Ana' }, expect: { status: 200, body: { mensagem: 'olá, Ana' } } }] },
  ],
  hidden: [{ name: 'nome com espaço', requests: [{ request: { path: '/ola?nome=Ana%20Clara' }, expect: { status: 200, body: { mensagem: 'olá, Ana Clara' } } }] }],
  hints: [
    'Response.json(objeto) devolve o objeto como JSON, com status 200 e o cabeçalho content-type certo.',
    'new URL(req.url).searchParams.get("nome") lê o nome da URL; vem null quando não há.',
  ],
  reference: `export default async function handler(req: Request, ctx: Ctx): Promise<Response> {
  const nome = new URL(req.url).searchParams.get('nome')
  return Response.json({ mensagem: nome ? \`olá, \${nome}\` : 'olá' })
}
`,
  naive: `export default async function handler(req: Request, ctx: Ctx): Promise<Response> {
  return Response.json({ mensagem: 'olá' })
}
`,
  explanation:
    'Um handler recebe um Request e devolve um Response, a API padrão da web. Response.json monta o corpo e o content-type; a URL já chega decodificada por searchParams, então "Ana%20Clara" vira "Ana Clara" sem trabalho extra.',
  // The engine's server alone answers in ~75 ms p99 at 100 req/s (30 ms base plus queueing).
  load: { rps: 100, p99Ms: 100, queriesPerRequest: 0 },
}
