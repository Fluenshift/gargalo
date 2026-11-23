// The project's OpenAPI 3.1 document: routes (Hono's `app.routes`) plus what the HTTP client sent, built by hand as plain JSON.

import { METHODS, parseHeaders, type Draft, type Sent } from './http'
import type { Route } from './runtime'

export interface OpenApiInput {
  title: string
  routes?: Route[]
  /** Requests the player tested, history and saved alike; with fetch puro these are the only source of paths. */
  requests: (Draft & { status?: number })[]
}

interface Operation {
  summary: string
  parameters?: { name: string; in: 'path'; required: true; schema: { type: 'string' } }[]
  requestBody?: { content: Record<string, { example: unknown }> }
  responses: Record<string, { description: string }>
}

export type OpenApiDoc = {
  openapi: '3.1.0'
  info: { title: string; version: string }
  paths: Record<string, Record<string, Operation>>
}

/** Hono's `:id` and `:id{regex}` become `{id}`. */
export const templateOf = (path: string) => path.replace(/:(\w+)(\{[^}]*\})?/g, '{$1}')

const escape = (t: string) => t.replace(/[.+?^$()|[\]\\]/g, '\\$&')
const matcher = (template: string) => new RegExp(`^${escape(template).replace(/\{\w+\}/g, '[^/]+')}/?$`)

const isMethod = (m: string) => (METHODS as readonly string[]).includes(m.toUpperCase())

/** The OpenAPI document. Middleware (`ALL`, wildcards) is not an operation; a request joins the route it matches, or becomes an operation of its own. */
export function buildOpenApi({ title, routes = [], requests }: OpenApiInput): OpenApiDoc {
  const paths: OpenApiDoc['paths'] = {}
  const operation = (method: string, template: string): Operation => {
    const verb = method.toLowerCase()
    const names = [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    paths[template] ??= {}
    return (paths[template][verb] ??= {
      summary: `${method.toUpperCase()} ${template}`,
      ...(names.length && { parameters: names.map((name) => ({ name, in: 'path' as const, required: true as const, schema: { type: 'string' as const } })) }),
      responses: {},
    })
  }

  for (const r of routes) if (isMethod(r.method) && !r.path.includes('*')) operation(r.method, templateOf(r.path))

  for (const req of requests) {
    const path = req.path.trim().split(/[?#]/)[0] || '/'
    const literal = path.startsWith('/') ? path : `/${path}`
    const template = Object.keys(paths).find((t) => paths[t][req.method.toLowerCase()] && matcher(t).test(literal)) ?? literal
    const op = operation(req.method, template)
    if (req.status) op.responses[req.status] ??= { description: `Resposta observada: ${req.status}` }
    const body = req.body.trim()
    if (body && !op.requestBody) {
      let example: unknown = body
      let type = 'text/plain'
      try {
        example = JSON.parse(body)
        type = 'application/json'
      } catch {
        // not JSON: kept as text
      }
      const parsed = parseHeaders(req.headers)
      const declared = 'headers' in parsed ? parsed.headers['content-type'] : undefined
      op.requestBody = { content: { [declared ?? type]: { example } } }
    }
  }

  for (const methods of Object.values(paths)) for (const op of Object.values(methods)) if (!Object.keys(op.responses).length) op.responses = { default: { description: 'Ainda não testada' } }

  return { openapi: '3.1.0', info: { title, version: '1.0.0' }, paths }
}

/** Newest history first (its body wins as the example), then saved requests. */
export const requestsOf = (history: Sent[], saved: Draft[]) => [...history, ...saved]

export const stringify = (doc: OpenApiDoc) => JSON.stringify(doc, null, 2)
