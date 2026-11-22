// The guided courses a project follows in its Etapa panel.
// shortcut: one placeholder stage so the panel works; #111 replaces it with the whole "API de pedidos do E-commerce".

import { starter } from './project'
import type { ProjectCourse } from './stage'

export const COURSE: ProjectCourse = {
  id: 'ecommerce',
  title: 'API de pedidos do E-commerce',
  stages: [
    {
      id: 'health',
      title: 'Health check',
      statement:
        'GET /health responde 200 com {"status": "ok"} depois de conferir que o banco responde. É a rota que o balanceador de carga chama para saber se o servidor está vivo.',
      files: ['src/index.ts', 'src/routes/health.ts', 'src/db/saude.ts'],
      tests: [{ name: 'GET /health responde 200 com status ok', requests: [{ request: { path: '/health' }, expect: { status: 200, body: { status: 'ok' } } }] }],
      checklist: [{ id: 'camadas' }, { id: 'sql-parametrizado' }],
      hints: [
        'Abra src/index.ts: a rota /health precisa estar registrada nele.',
        'A rota chama uma função de src/db/ que roda SELECT 1; ela não escreve SQL direto.',
        'Responda com JSON: no Hono, c.json({ status: "ok" }); no fetch puro, Response.json({ status: "ok" }).',
      ],
      explanation: 'Um health check que consulta o banco falha quando o banco cai, e o balanceador tira esse servidor da rotação.',
      reference: { hono: starter('', 'hono').files, fetch: starter('', 'fetch').files },
    },
  ],
}
