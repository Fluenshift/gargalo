// Runs the player's handler against an exercise's tests. Plain function: the worker wraps it, unit tests call it directly.

import { transform } from 'sucrase'
// With the extension: runner.test.ts loads this file in a plain Node thread, which resolves no extensionless paths.
import { measured } from './db.ts'
import { fill, findKey, pick } from './exercise.ts'
import type { CapturedResponse, Ctx, Db, ExpectedResponse, RequestMetrics, RequestSpec, TestCase, TestResult } from './exercise'

export type Handler = (req: Request, ctx: Ctx) => Promise<Response>

export interface WorkerInput {
  code: string
  schema: string
  seed: string
  tests: TestCase[]
}

export interface WorkerOutput {
  index: number
  result: TestResult
}

/** Sent once by the worker when its database has loaded (or failed to), before any WorkerOutput. */
export type WorkerReady = { ready: true } | { ready: false; message: string }

/** Opens a database with the exercise's schema and data, then the player's migration, fresh for each test. */
export type OpenDb = (schema: string, seed: string, migration?: string) => Promise<Db>

export const BLOCKED_NETWORK = 'fetch não é permitido: o handler só fala com ctx.db.'
const SOURCE_URL = 'oficina-handler.js'
const DEFAULT_NOW = Date.UTC(2026, 0, 1)

class CodeError extends Error {
  line?: number
  constructor(message: string, line?: number) {
    super(message)
    this.line = line
  }
}

const BLOCKED: [RegExp, string][] = [
  [/^\s*import\b|\bimport\s*\(/m, 'import não é permitido: Request, Response, URL e crypto já estão disponíveis, e o banco vem em ctx.db.'],
  [/^\s*export\s+(?!default\b|const\s+migration\b)/m, 'Só o export default do handler (e export const migration) é permitido.'],
  [/\b(fetch|importScripts)\s*\(/, BLOCKED_NETWORK],
]

function lineAt(code: string, index: number): number {
  return code.slice(0, index).split('\n').length
}

/** What the player's file exports: the handler and, optionally, SQL that runs after the exercise's data (to create indexes). */
export interface Compiled {
  handler: Handler
  migration?: string
}

/** Strips the types and evaluates the code; returns its exports. */
export function compile(code: string): Compiled {
  for (const [pattern, message] of BLOCKED) {
    const match = pattern.exec(code)
    if (match) throw new CodeError(message, lineAt(code, match.index + match[0].length - match[0].trimStart().length))
  }
  let js: string
  try {
    js = transform(code, { transforms: ['typescript', 'imports'] }).code
  } catch (err) {
    const message = (err as Error).message
    throw new CodeError(`Erro de sintaxe: ${message}`, Number(/\((\d+):\d+\)$/.exec(message)?.[1]) || undefined)
  }
  // A new function scope per run, so a previous run's top-level variables can't be seen.
  // shortcut: globalThis assignments survive in the long-lived worker; recreate the worker per exercise if that ever matters.
  // Same first line as the player's code, so line numbers in errors match the editor; sucrase keeps lines too.
  // oxlint-disable-next-line no-eval -- running the player's code is the point; it happens inside the Oficina worker.
  const factory = (0, eval)(`(function (exports) {${js}\n})\n//# sourceURL=${SOURCE_URL}`) as (exports: { default?: unknown; migration?: unknown }) => void
  const exports: { default?: unknown; migration?: unknown } = {}
  factory(exports)
  if (typeof exports.default !== 'function') throw new CodeError('Falta o export default do handler: export default async function handler(req, ctx) { … }')
  if (exports.migration !== undefined && typeof exports.migration !== 'string')
    throw new CodeError('A migration precisa ser um texto com SQL: export const migration = `CREATE INDEX …`')
  return { handler: exports.default as Handler, migration: exports.migration }
}

function errorLine(err: unknown): number | undefined {
  if (err instanceof CodeError) return err.line
  const match = new RegExp(`${SOURCE_URL.replace('.', '\\.')}:(\\d+)`).exec(String((err as Error)?.stack))
  return match ? Number(match[1]) : undefined
}

export function matches(expected: unknown, received: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(received) && received.length === expected.length && expected.every((e, i) => matches(e, received[i]))
  if (expected !== null && typeof expected === 'object') {
    if (received === null || typeof received !== 'object') return false
    const r = received as Record<string, unknown>
    return Object.entries(expected).every(([k, v]) => matches(v, r[k]))
  }
  return Object.is(expected, received)
}

function toRequest(spec: RequestSpec): Request {
  const headers = new Headers(spec.headers)
  if (spec.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json')
  return buildRequest({ ...spec, headers: Object.fromEntries(headers), body: spec.body === undefined ? undefined : JSON.stringify(spec.body) })
}

/** A request whose body (already text) is read from memory. */
export function buildRequest(spec: Omit<RequestSpec, 'body'> & { body?: string }): Request {
  const { body } = spec
  const req = new Request(new URL(spec.path, 'http://oficina.local'), { method: spec.method ?? 'GET', headers: spec.headers, body })
  // Chrome reads a body in tasks, so the first request would run all its queries before the second had its body, and no race
  // would ever show. Read from memory, every await in the handler is a microtask and concurrent requests interleave as in Node.
  if (body !== undefined) Object.assign(req, { text: async () => body, json: async () => JSON.parse(body) as unknown })
  return req
}

async function capture(res: Response): Promise<CapturedResponse> {
  const text = await res.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    // Not JSON: the text is the body.
  }
  return { status: res.status, headers: Object.fromEntries(res.headers), body }
}

/** First difference between what the test expects and the response, or null. */
function compareResponse(res: CapturedResponse | undefined, expect: ExpectedResponse): Omit<TestResult, 'name' | 'passed'> | null {
  if (!res) return { message: 'O handler precisa devolver um Response.' }
  if (res.status !== expect.status) return { message: 'Status diferente do esperado.', expected: expect.status, received: res.status }
  for (const [name, value] of Object.entries(expect.headers ?? {})) {
    const got = res.headers[name.toLowerCase()] ?? null
    if (got !== value) return { message: `Cabeçalho ${name} diferente do esperado.`, expected: value, received: got }
  }
  if (expect.body !== undefined && !matches(expect.body, res.body))
    return { message: 'Corpo da resposta diferente do esperado.', expected: expect.body, received: res.body }
  const leaked = expect.absent && findKey(res.body, expect.absent)
  return leaked ? { message: `A resposta traz o campo ${leaked}, que não pode sair.` } : null
}

/** Over `maxQueries`: what the request's own meter counted, said in Portuguese. */
function tooManyQueries(m: RequestMetrics, max: number | undefined): Omit<TestResult, 'name' | 'passed'> | null {
  if (max === undefined || m.queries <= max) return null
  return { message: `A requisição fez ${m.queries} consulta${m.queries > 1 ? 's' : ''} ao banco; o máximo é ${max}.` }
}

export async function runTest(handler: Handler, test: TestCase, db: Db): Promise<TestResult> {
  const now = () => test.now ?? DEFAULT_NOW
  const metrics: RequestMetrics[] = test.requests.map(() => ({ queries: 0, rowsRead: 0, handlerMs: 0 }))
  const responses: (CapturedResponse | undefined)[] = []
  const vars: Record<string, unknown> = {}
  const extra = (): Partial<TestResult> => (test.capture ? { responses } : {})
  const call = async (request: RequestSpec, i: number) => {
    const m = metrics[i]
    const start = performance.now()
    const res = await handler(toRequest(request), { db: measured(db, m), now })
    m.handlerMs = Math.max(0, m.handlerMs + performance.now() - start)
    return res
  }
  // Concurrent: every handler starts before any finishes, so they interleave at their awaits. Each has its own meter.
  const concurrent = test.sequential ? undefined : await Promise.all(test.requests.map(({ request }, i) => call(request, i)))
  for (const [i, step] of test.requests.entries()) {
    const request = concurrent ? step.request : fill(step.request, vars)
    const res: unknown = concurrent ? concurrent[i] : await call(request, i)
    const captured = res instanceof Response ? await capture(res) : undefined
    responses.push(captured)
    // Which request, as tests/suporte.ts says it in an exported project: a flow's failure names the one that broke.
    const prefix = test.requests.length > 1 ? `Requisição ${i + 1} (${request.method ?? 'GET'} ${request.path}): ` : ''
    const expect = step.expect && fill(step.expect, vars)
    const diff = expect && (compareResponse(captured, expect) ?? tooManyQueries(metrics[i], expect.maxQueries))
    if (diff) return { name: test.name, passed: false, ...diff, message: prefix + diff.message, metrics, ...extra() }
    for (const [name, from] of Object.entries(step.save ?? {})) {
      const value = pick(captured, from)
      if (value === undefined)
        return { name: test.name, passed: false, message: `${prefix}a resposta não tem ${from} (para {{${name}}}).`, metrics, ...extra() }
      vars[name] = value
    }
  }
  if (test.db) {
    const rows = await db.query(test.db.sql, fill(test.db.params, vars))
    const withRows = test.capture ? { ...extra(), rows } : {}
    if (test.db.rows !== undefined && !matches(test.db.rows, rows))
      return { name: test.name, passed: false, message: 'Estado do banco diferente do esperado.', expected: test.db.rows, received: rows, metrics, ...withRows }
    return { name: test.name, passed: true, metrics, ...withRows }
  }
  return { name: test.name, passed: true, metrics, ...extra() }
}

/** Runs the tests in order, reporting each result as soon as it is known. */
export async function executeTests(input: WorkerInput, openDb: OpenDb, report: (out: WorkerOutput) => void): Promise<void> {
  let compiled: Compiled | undefined
  let compileError: unknown
  try {
    compiled = compile(input.code)
  } catch (err) {
    compileError = err
  }
  for (const [index, test] of input.tests.entries()) {
    let result: TestResult
    try {
      if (!compiled) throw compileError
      result = await runTest(compiled.handler, test, await openDb(input.schema, input.seed, compiled.migration))
    } catch (err) {
      result = { name: test.name, passed: false, message: err instanceof CodeError ? err.message : String(err), line: errorLine(err) }
    }
    report({ index, result })
  }
}
