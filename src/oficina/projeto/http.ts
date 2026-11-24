// The HTTP client of a project: what a request draft is, how it becomes a ProjectRequest, its history and saved requests.

import type { CapturedResponse, RequestSpec, TestStep } from '../exercise'
import type { ProjectRequest, RequestOutcome } from './runtime'

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export type Method = (typeof METHODS)[number]

export interface Draft {
  method: Method
  path: string
  /** One `Nome: valor` per line, as typed. */
  headers: string
  body: string
}

export interface Sent extends Draft {
  status?: number
  ms: number
  at: number
}

export interface Saved extends Draft {
  name: string
}

export interface ClientState {
  history: Sent[]
  saved: Saved[]
}

export const HISTORY_MAX = 30
export const EMPTY_DRAFT: Draft = { method: 'GET', path: '/health', headers: '', body: '' }

export const hasBody = (method: Method) => method !== 'GET' && method !== 'DELETE'

/** `Nome: valor` lines into headers; blank lines are skipped, a line without `:` is an error naming it. */
export function parseHeaders(text: string): { headers: Record<string, string> } | { error: string } {
  const headers: Record<string, string> = {}
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.trim()
    if (!line) continue
    const colon = line.indexOf(':')
    if (colon <= 0) return { error: `Linha ${i + 1} dos headers sem "Nome: valor": ${line}` }
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim()
  }
  return { headers }
}

/**
 * The draft as the runtime takes it: the path gets its leading `/`, a body goes only with methods that carry one,
 * and a JSON-looking body gets `content-type: application/json` unless the player set one.
 */
export function toRequest(draft: Draft): { request: ProjectRequest } | { error: string } {
  const parsed = parseHeaders(draft.headers)
  if ('error' in parsed) return parsed
  const path = draft.path.trim() || '/'
  const request: ProjectRequest = { method: draft.method, path: path.startsWith('/') ? path : `/${path}`, headers: parsed.headers }
  const body = draft.body.trim()
  if (hasBody(draft.method) && body) {
    request.body = draft.body
    if (!('content-type' in parsed.headers) && /^[[{]/.test(body)) request.headers = { ...parsed.headers, 'content-type': 'application/json' }
  }
  return { request }
}

/** A JSON body that does not parse, said before it is sent; undefined when the body is fine or not JSON. */
export function jsonProblem(draft: Pick<Draft, 'method' | 'body'>): string | undefined {
  const body = draft.body.trim()
  if (!hasBody(draft.method) || !/^[[{]/.test(body)) return undefined
  try {
    JSON.parse(body)
    return undefined
  } catch (e) {
    return `O corpo parece JSON mas não é válido: ${(e as Error).message}`
  }
}

/** "Testar agora" of a guided step: the client sends `before` in order (what they `save` fills `{{name}}`), then opens with `request` and sends it. */
export interface Prefill {
  request: RequestSpec
  before?: TestStep[]
}

/** A test's request as the client's form holds it: one header per line, the JSON body indented. */
export const draftOf = (spec: RequestSpec): Draft => ({
  method: (spec.method ?? 'GET').toUpperCase() as Method,
  path: spec.path,
  headers: Object.entries(spec.headers ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n'),
  body: spec.body === undefined ? '' : JSON.stringify(spec.body, null, 2),
})

/** A response as a test step sees it, the body parsed when it is JSON, so a step's `save` can pick from it. */
export function captured(response: RequestOutcome['response']): CapturedResponse | undefined {
  if (!response) return undefined
  let body: unknown = response.body
  try {
    body = JSON.parse(response.body)
  } catch {
    // Not JSON: the text is the body.
  }
  return { status: response.status, headers: response.headers, body }
}

/** JSON responses indented; anything else as it came. */
export function prettyBody(body: string, contentType = ''): string {
  if (!/json/i.test(contentType) && !/^\s*[[{]/.test(body)) return body
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

const same = (a: Draft, b: Draft) => a.method === b.method && a.path === b.path && a.headers === b.headers && a.body === b.body

/** Newest first, the same request not twice in a row, at most HISTORY_MAX. */
export const addToHistory = (history: Sent[], sent: Sent): Sent[] => [sent, ...history.filter((h, i) => !(i === 0 && same(h, sent)))].slice(0, HISTORY_MAX)

/** Saving under a name already used replaces that request. */
export const saveRequest = (saved: Saved[], request: Saved): Saved[] => [...saved.filter((s) => s.name !== request.name), request].toSorted((a, b) => a.name.localeCompare(b.name))

export const removeSaved = (saved: Saved[], name: string): Saved[] => saved.filter((s) => s.name !== name)

export const clientKey = (projectId: string) => `gargalo:oficina:http:${projectId}`

const isDraft = (v: unknown): v is Draft => {
  const d = v as Draft
  return !!d && (METHODS as readonly string[]).includes(d.method) && typeof d.path === 'string' && typeof d.headers === 'string' && typeof d.body === 'string'
}

/** What was kept for this project; anything unreadable or malformed is dropped, never thrown. */
export function loadClient(projectId: string, read: (key: string) => string | null = (k) => localStorage.getItem(k)): ClientState {
  try {
    const raw = JSON.parse(read(clientKey(projectId)) ?? 'null') as Partial<ClientState> | null
    return {
      history: Array.isArray(raw?.history) ? raw.history.filter((h): h is Sent => isDraft(h) && typeof h.ms === 'number' && typeof h.at === 'number').slice(0, HISTORY_MAX) : [],
      saved: Array.isArray(raw?.saved) ? raw.saved.filter((s): s is Saved => isDraft(s) && typeof s.name === 'string' && s.name.length > 0) : [],
    }
  } catch {
    return { history: [], saved: [] }
  }
}

/** False when the browser refused to keep it. */
export function saveClient(projectId: string, state: ClientState, write: (key: string, value: string) => void = (k, v) => localStorage.setItem(k, v)): boolean {
  try {
    write(clientKey(projectId), JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function forgetClient(projectId: string): void {
  try {
    localStorage.removeItem(clientKey(projectId))
  } catch {
    // Nothing kept, nothing to forget.
  }
}
