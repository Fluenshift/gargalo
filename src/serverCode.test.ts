import { describe, expect, it } from 'vitest'
import { serverCode } from './serverCode'

const routes = { read: 'GET /produtos/:id', write: 'POST /pedidos' }

describe('serverCode', () => {
  it('says the request has nowhere to go when nothing is linked', () => {
    const code = serverCode([], routes)
    expect(code).toContain('// GET /produtos/:id')
    expect(code.match(/HttpError\(503/g)).toHaveLength(2)
  })

  it('reads from the replica and writes to the primary, as the engine routes them', () => {
    const code = serverCode(
      [
        { kind: 'db', edge: { source: 's', target: 'd' } },
        { kind: 'replica', edge: { source: 's', target: 'r' } },
      ],
      routes,
    )
    const [read, write] = code.split('\n\n')
    expect(read).toContain('replica.query')
    expect(read).not.toContain('db.query')
    expect(write).toContain('db.query')
  })

  it('warns that half the reads skip a cache linked next to the database', () => {
    const code = serverCode(
      [
        { kind: 'cache', edge: { source: 's', target: 'c' } },
        { kind: 'db', edge: { source: 's', target: 'd' } },
      ],
      { read: routes.read },
    )
    expect(code).toContain('chega direto no banco')
  })

  it('writes the link settings and flags retries without backoff or idempotency', () => {
    const bad = serverCode([{ kind: 'payment', edge: { source: 's', target: 'p', retries: 2 } }], { write: routes.write })
    expect(bad).toContain('comRetry(() => pagamentos.cobrar(dados), { tentativas: 3 })')
    expect(bad).toContain('sem backoff')
    expect(bad).toContain('sem chave de idempotência')
    expect(bad).toContain('Sem disjuntor')

    const good = serverCode(
      [{ kind: 'payment', edge: { source: 's', target: 'p', retries: 2, backoff: true, breaker: true, idempotent: true } }],
      { write: routes.write },
    )
    expect(good).toContain('comRetry(() => disjuntor.chamar(() => pagamentos.cobrar(dados)), { tentativas: 3, backoff: true })')
    expect(good).not.toMatch(/sem backoff|sem chave|Sem disjuntor/i)
  })

  it('answers 202 when writes go to a queue', () => {
    const code = serverCode([{ kind: 'queue', edge: { source: 's', target: 'q' } }], { write: routes.write })
    expect(code).toContain("fila.publicar('pedido-criado', dados)")
    expect(code).toContain('status: 202')
  })
})
