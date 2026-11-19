// The code a server runs, written from the drawing: what it calls for each route and how.
// It uses the engine's own routing, so the code says what the simulation does.

import { SPECS } from './sim/model'
import type { ArchEdge, Kind, RequestClass } from './sim/model'

export interface OutLink {
  kind: Kind
  edge: ArchEdge
}

const CALLS: Partial<Record<Kind, Record<'read' | 'write', string>>> = {
  cache: {
    read: "cache.getOrSet(`produto:${id}`, () => banco.query('SELECT * FROM produtos WHERE id = $1', [id]))",
    write: "cache.gravar(dados) // o cache repassa a escrita ao banco",
  },
  db: {
    read: "db.query('SELECT * FROM produtos WHERE id = $1', [id])",
    write: "db.query('INSERT INTO pedidos (cliente, total) VALUES ($1, $2)', [dados.cliente, dados.total])",
  },
  replica: { read: "replica.query('SELECT * FROM produtos WHERE id = $1', [id])", write: '' },
  shard: {
    read: "particaoDa(id).query('SELECT * FROM produtos WHERE id = $1', [id])",
    write: "particaoDa(dados.cliente).query('INSERT INTO pedidos (cliente, total) VALUES ($1, $2)', [dados.cliente, dados.total])",
  },
  queue: { read: '', write: "fila.publicar('pedido-criado', dados)" },
  payment: { read: '', write: 'pagamentos.cobrar(dados)' },
}

const WRITES_DATA: Kind[] = ['db', 'shard', 'cache', 'payment']

/** One call, wrapped by the link's settings, plus the comments that point at what the drawing gets wrong. */
function call(kind: Kind, edge: ArchEdge, cls: 'read' | 'write'): string[] {
  const notes: string[] = []
  let expr = CALLS[kind]![cls]
  if (edge.idempotent && cls === 'write') notes.push('// Leva a chave de idempotência do pedido: repetir a chamada não grava nem cobra duas vezes.')
  if (edge.breaker) expr = `disjuntor.chamar(() => ${expr})`
  const retries = edge.retries ?? 0
  if (retries > 0) {
    expr = `comRetry(() => ${expr}, { tentativas: ${retries + 1}${edge.backoff ? ', backoff: true' : ''} })`
    if (!edge.backoff) notes.push('// Retry sem backoff: as novas tentativas chegam todas juntas e afogam quem já está lento.')
    if (cls === 'write' && WRITES_DATA.includes(kind) && !edge.idempotent)
      notes.push('// Retry sem chave de idempotência: uma escrita que deu timeout pode rodar duas vezes.')
  }
  if (kind === 'payment' && !edge.breaker) notes.push('// Sem disjuntor: se a API de pagamento cair, cada pedido espera o timeout inteiro.')
  return [...notes, `const resultado = await ${expr}`]
}

function handler(route: string, cls: 'read' | 'write', out: OutLink[]): string {
  const name = cls === 'read' ? 'ler(id: string)' : 'criar(dados: Pedido)'
  const lines: string[] = []
  // Same choice the engine makes for this class.
  const targets = SPECS.server.route!(
    out.map((o, i) => ({ id: String(i), kind: o.kind, down: false })),
    cls as RequestClass,
  ).map((t) => out[Number(t.id)])
  const kinds = [...new Set(targets.map((t) => t.kind))]

  if (targets.length === 0) {
    lines.push(`// Nada ligado que ${cls === 'read' ? 'responda leituras' : 'guarde escritas'}: a requisição não tem para onde ir.`)
    lines.push("throw new HttpError(503, 'Serviço indisponível')")
  } else {
    if (kinds.length > 1)
      lines.push(
        `// As ${cls === 'read' ? 'leituras' : 'escritas'} se dividem igualmente entre: ${kinds.map((k) => SPECS[k].label).join(', ')}.`,
        kinds.includes('cache') ? '// A parte que não vai ao cache chega direto no banco.' : '// Cada destino recebe só uma parte.',
      )
    else if (targets.length > 1) lines.push(`// Reveza entre ${targets.length} peças do tipo ${SPECS[kinds[0]].label}.`)
    lines.push(...call(targets[0].kind, targets[0].edge, cls))
    if (targets[0].kind === 'queue') lines.push('return { status: 202 } // responde já; um worker grava depois')
    else if (targets[0].kind === 'replica') lines.push('return resultado // pode estar alguns milissegundos atrás do primário')
    else lines.push('return resultado')
  }
  return [`// ${route}`, `async function ${name} {`, ...lines.map((l) => `  ${l}`), '}'].join('\n')
}

/** The server's code for the level's read and write routes, from where its links go. */
export function serverCode(out: OutLink[], routes: Partial<Record<'read' | 'write', string>>): string {
  return (['read', 'write'] as const)
    .filter((c) => routes[c])
    .map((c) => handler(routes[c]!, c, out))
    .join('\n\n')
}
