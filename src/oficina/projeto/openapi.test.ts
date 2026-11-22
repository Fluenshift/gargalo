import { describe, expect, it } from 'vitest'
import { buildOpenApi, requestsOf, stringify, templateOf } from './openapi'
import type { Draft } from './http'

const req = (d: Partial<Draft> & { status?: number }) => ({ method: 'GET' as const, path: '/health', headers: '', body: '', ...d })

describe('buildOpenApi', () => {
  it('turns Hono routes into operations, with path params, and skips middleware', () => {
    const doc = buildOpenApi({
      title: 'Loja',
      routes: [
        { method: 'ALL', path: '/*' },
        { method: 'GET', path: '/produtos/:id' },
        { method: 'POST', path: '/produtos' },
      ],
      requests: [],
    })
    expect(doc.openapi).toBe('3.1.0')
    expect(Object.keys(doc.paths)).toEqual(['/produtos/{id}', '/produtos'])
    expect(doc.paths['/produtos/{id}'].get.parameters?.[0].name).toBe('id')
    expect(doc.paths['/produtos'].post.responses).toEqual({ default: { description: 'Ainda não testada' } })
  })

  it('attaches a tested request to its route: status and JSON example', () => {
    const doc = buildOpenApi({
      title: 'x',
      routes: [{ method: 'POST', path: '/produtos' }, { method: 'GET', path: '/produtos/:id' }],
      requests: [req({ method: 'POST', path: '/produtos?a=1', body: '{"nome":"vela"}', status: 201 }), req({ path: '/produtos/7', status: 404 })],
    })
    expect(doc.paths['/produtos'].post.requestBody?.content['application/json'].example).toEqual({ nome: 'vela' })
    expect(doc.paths['/produtos'].post.responses[201]).toBeDefined()
    expect(doc.paths['/produtos/{id}'].get.responses[404]).toBeDefined()
    expect(Object.keys(doc.paths)).toHaveLength(2)
  })

  it('derives paths from requests alone (fetch puro), text bodies and own content-type', () => {
    const doc = buildOpenApi({
      title: 'x',
      requests: [req({ path: 'ping', status: 200 }), req({ method: 'PUT', path: '/t', body: 'oi', headers: 'Content-Type: text/csv' }), req({ method: 'PUT', path: '/u', body: 'oi', headers: 'ruim' })],
    })
    expect(doc.paths['/ping'].get.responses[200]).toBeDefined()
    expect(doc.paths['/t'].put.requestBody?.content['text/csv'].example).toBe('oi')
    expect(doc.paths['/u'].put.requestBody?.content['text/plain'].example).toBe('oi')
  })

  it('helpers', () => {
    expect(templateOf('/a/:id{[0-9]+}/b')).toBe('/a/{id}/b')
    expect(requestsOf([{ ...req({ path: '/1' }), ms: 1, at: 1 }, { ...req({ path: '/2' }), ms: 1, at: 2 }], [req({ path: '/s' })]).map((r) => r.path)).toEqual(['/1', '/2', '/s'])
    expect(stringify(buildOpenApi({ title: 'x', requests: [] }))).toContain('"paths": {}')
  })
})
