import { describe, expect, it } from 'vitest'
import {
  HISTORY_MAX,
  addToHistory,
  captured,
  draftOf,
  jsonProblem,
  loadClient,
  parseHeaders,
  prettyBody,
  removeSaved,
  saveClient,
  saveRequest,
  toRequest,
  type Draft,
  type Sent,
} from './http'

const draft = (d: Partial<Draft> = {}): Draft => ({ method: 'GET', path: '/health', headers: '', body: '', ...d })
const sent = (d: Partial<Sent> = {}): Sent => ({ ...draft(), ms: 3, at: 1, ...d })

describe('parseHeaders', () => {
  it('reads one header per line, lower-cases names and skips blank lines', () => {
    expect(parseHeaders('Authorization: Bearer x\n\n  Idempotency-Key:  abc ')).toEqual({ headers: { authorization: 'Bearer x', 'idempotency-key': 'abc' } })
  })
  it('keeps a colon inside the value', () => {
    expect(parseHeaders('X-At: 10:30')).toEqual({ headers: { 'x-at': '10:30' } })
  })
  it('names the line without a colon', () => {
    expect(parseHeaders('Accept: */*\nsem dois pontos')).toEqual({ error: 'Linha 2 dos headers sem "Nome: valor": sem dois pontos' })
  })
})

describe('toRequest', () => {
  it('adds the leading slash and sends no body on GET', () => {
    expect(toRequest(draft({ path: 'produtos', body: '{"a":1}' }))).toEqual({ request: { method: 'GET', path: '/produtos', headers: {} } })
  })
  it('sends a JSON body with its content-type', () => {
    expect(toRequest(draft({ method: 'POST', path: '/produtos', body: '{"nome":"vela"}' }))).toEqual({
      request: { method: 'POST', path: '/produtos', headers: { 'content-type': 'application/json' }, body: '{"nome":"vela"}' },
    })
  })
  it("keeps the player's own content-type", () => {
    const r = toRequest(draft({ method: 'PUT', body: '{"a":1}', headers: 'Content-Type: text/plain' }))
    expect('request' in r && r.request.headers).toEqual({ 'content-type': 'text/plain' })
  })
  it('does not add a content-type to a body that is not JSON', () => {
    const r = toRequest(draft({ method: 'POST', body: 'nome=vela' }))
    expect('request' in r && r.request.headers).toEqual({})
  })
  it('passes the headers error on', () => {
    expect(toRequest(draft({ headers: 'ruim' }))).toHaveProperty('error')
  })
})

describe('Testar agora: a step request in the form, and its answer as a step sees it', () => {
  it('puts a test request in the form: method, one header per line and the JSON body indented', () => {
    expect(draftOf({ path: '/usuarios' })).toEqual(draft({ path: '/usuarios' }))
    const login = draftOf({ method: 'post', path: '/pedidos', headers: { Authorization: 'Bearer abc', 'X-A': '1' }, body: { itens: [{ id: 1 }] } })
    expect(login).toEqual({
      method: 'POST',
      path: '/pedidos',
      headers: 'Authorization: Bearer abc\nX-A: 1',
      body: '{\n  "itens": [\n    {\n      "id": 1\n    }\n  ]\n}',
    })
    // Back through the form, it is the request the step describes.
    expect(toRequest(login)).toEqual({
      request: { method: 'POST', path: '/pedidos', headers: { authorization: 'Bearer abc', 'x-a': '1', 'content-type': 'application/json' }, body: login.body },
    })
  })
  it('parses a JSON answer so a save can pick from it, and keeps any other text as is', () => {
    expect(captured({ status: 200, headers: { 'content-type': 'application/json' }, body: '{"token":"t1"}' })).toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { token: 't1' },
    })
    expect(captured({ status: 204, headers: {}, body: '' })).toEqual({ status: 204, headers: {}, body: '' })
    expect(captured(undefined)).toBeUndefined()
  })
})

describe('jsonProblem', () => {
  it('flags a broken JSON body before sending', () => {
    expect(jsonProblem({ method: 'POST', body: '{"nome": }' })).toMatch(/não é válido/)
  })
  it('is quiet for valid JSON, non-JSON bodies and methods without a body', () => {
    expect(jsonProblem({ method: 'POST', body: '{"a":1}' })).toBeUndefined()
    expect(jsonProblem({ method: 'POST', body: 'texto' })).toBeUndefined()
    expect(jsonProblem({ method: 'GET', body: '{ruim' })).toBeUndefined()
  })
})

describe('prettyBody', () => {
  it('indents JSON and leaves other bodies alone', () => {
    expect(prettyBody('{"a":[1]}', 'application/json')).toBe('{\n  "a": [\n    1\n  ]\n}')
    expect(prettyBody('ok', 'text/plain')).toBe('ok')
    expect(prettyBody('{quebrado', 'application/json')).toBe('{quebrado')
  })
})

describe('history and saved requests', () => {
  it('puts the newest first, skips an identical repeat and caps the length', () => {
    let h: Sent[] = []
    h = addToHistory(h, sent({ path: '/a', at: 1 }))
    h = addToHistory(h, sent({ path: '/a', at: 2 }))
    expect(h).toHaveLength(1)
    expect(h[0].at).toBe(2)
    for (let i = 0; i < HISTORY_MAX + 5; i++) h = addToHistory(h, sent({ path: `/${i}` }))
    expect(h).toHaveLength(HISTORY_MAX)
    expect(h[0].path).toBe(`/${HISTORY_MAX + 4}`)
  })
  it('replaces a saved request with the same name and keeps them sorted', () => {
    let s = saveRequest([], { ...draft({ path: '/b' }), name: 'b' })
    s = saveRequest(s, { ...draft({ path: '/a' }), name: 'a' })
    s = saveRequest(s, { ...draft({ path: '/b2' }), name: 'b' })
    expect(s.map((x) => [x.name, x.path])).toEqual([
      ['a', '/a'],
      ['b', '/b2'],
    ])
    expect(removeSaved(s, 'a').map((x) => x.name)).toEqual(['b'])
  })
})

describe('loadClient and saveClient', () => {
  it('round-trips through storage', () => {
    const store = new Map<string, string>()
    const state = { history: [sent()], saved: [{ ...draft(), name: 'saúde' }] }
    expect(saveClient('p1', state, (k, v) => store.set(k, v))).toBe(true)
    expect(loadClient('p1', (k) => store.get(k) ?? null)).toEqual(state)
  })
  it('drops malformed entries and survives garbage or a refusing browser', () => {
    const bad = JSON.stringify({ history: [{ method: 'TRACE', path: '/', headers: '', body: '', ms: 1, at: 1 }, sent()], saved: [{ name: '' }] })
    expect(loadClient('p', () => bad)).toEqual({ history: [sent()], saved: [] })
    expect(loadClient('p', () => '{nope')).toEqual({ history: [], saved: [] })
    expect(
      loadClient('p', () => {
        throw new Error('blocked')
      }),
    ).toEqual({ history: [], saved: [] })
    expect(
      saveClient('p', { history: [], saved: [] }, () => {
        throw new Error('quota')
      }),
    ).toBe(false)
  })
})
