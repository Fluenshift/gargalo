// Runs the player's handler against an exercise's tests. Plain function: the worker wraps it, unit tests call it directly.

import { transform } from 'sucrase'
// With the extension: runner.test.ts loads this file in a plain Node thread, which resolves no extensionless paths.
import { measured } from './db.ts'
import type { Ctx, Db, ExpectedResponse, RequestMetrics, RequestSpec, TestCase, TestResult } from './exercise'

type Handler = (req: Request, ctx: Ctx) => Promise<Response>

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

/** Opens a database with the exercise's schema and data, fresh for each test. */
export type OpenDb = (schema: string, seed: string) => Promise<Db>

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
  [/^\s*export\s+(?!default\b)/m, 'Só o export default do handler é permitido.'],
  [/\b(fetch|importScripts)\s*\(/, BLOCKED_NETWORK],
]

function lineAt(code: string, index: number): number {
  return code.slice(0, index).split('\n').length
}

/** Strips the types and evaluates the code; returns its default export. */
export function compile(code: string): Handler {
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
  // Same first line as the player's code, so line numbers in errors match the editor; sucrase keeps lines too.
  // oxlint-disable-next-line no-eval -- running the player's code is the point; it happens inside the Oficina worker.
  const factory = (0, eval)(`(function (exports) {${js}\n})\n//# sourceURL=${SOURCE_URL}`) as (exports: { default?: unknown }) => void
  const exports: { default?: unknown } = {}
  factory(exports)
  if (typeof exports.default !== 'function') throw new CodeError('Falta o export default do handler: export default async function handler(req, ctx) { … }')
  return exports.default as Handler
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
  return new Request(new URL(spec.path, 'http://oficina.local'), {
    method: spec.method ?? 'GET',
    headers,
    body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
  })
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** First difference between what the test expects and the response, or null. */
async function compareResponse(res: unknown, expect: ExpectedResponse): Promise<Omit<TestResult, 'name' | 'passed'> | null> {
  if (!(res instanceof Response)) return { message: 'O handler precisa devolver um Response.', received: String(res) }
  if (res.status !== expect.status) return { message: 'Status diferente do esperado.', expected: expect.status, received: res.status }
  for (const [name, value] of Object.entries(expect.headers ?? {})) {
    if (res.headers.get(name) !== value) return { message: `Cabeçalho ${name} diferente do esperado.`, expected: value, received: res.headers.get(name) }
  }
  if (expect.body === undefined) return null
  const body = await readBody(res)
  return matches(expect.body, body) ? null : { message: 'Corpo da resposta diferente do esperado.', expected: expect.body, received: body }
}

async function runTest(handler: Handler, test: TestCase, db: Db): Promise<TestResult> {
  const now = () => test.now ?? DEFAULT_NOW
  const metrics: RequestMetrics[] = test.requests.map(() => ({ queries: 0, rowsRead: 0, handlerMs: 0 }))
  // Every handler starts before any finishes, so concurrent requests interleave at their awaits. Each has its own meter.
  const responses = await Promise.all(test.requests.map(async ({ request }, i) => {
    const m = metrics[i]
    const start = performance.now()
    const res = await handler(toRequest(request), { db: measured(db, m), now })
    m.handlerMs = Math.max(0, m.handlerMs + performance.now() - start)
    return res
  }))
  for (const [i, { expect }] of test.requests.entries()) {
    const diff = expect && (await compareResponse(responses[i], expect))
    if (diff) {
      const prefix = test.requests.length > 1 ? `Requisição ${i + 1}: ` : ''
      return { name: test.name, passed: false, ...diff, message: prefix + diff.message, metrics }
    }
  }
  if (test.db) {
    const rows = await db.query(test.db.sql, test.db.params)
    if (!matches(test.db.rows, rows)) return { name: test.name, passed: false, message: 'Estado do banco diferente do esperado.', expected: test.db.rows, received: rows, metrics }
  }
  return { name: test.name, passed: true, metrics }
}

/** Runs the tests in order, reporting each result as soon as it is known. */
export async function executeTests(input: WorkerInput, openDb: OpenDb, report: (out: WorkerOutput) => void): Promise<void> {
  let handler: Handler | undefined
  let compileError: unknown
  try {
    handler = compile(input.code)
  } catch (err) {
    compileError = err
  }
  for (const [index, test] of input.tests.entries()) {
    let result: TestResult
    try {
      if (!handler) throw compileError
      result = await runTest(handler, test, await openDb(input.schema, input.seed))
    } catch (err) {
      result = { name: test.name, passed: false, message: err instanceof CodeError ? err.message : String(err), line: errorLine(err) }
    }
    report({ index, result })
  }
}
