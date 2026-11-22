import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { RESULTS_KEY, XP_PER_LEVEL, XP_PER_STAR, totalXp } from '../../score'
import type { TestResult } from '../exercise'
import { loadSavedResults } from '../progress'
import { prewarm, type StartWorker, type WorkerMessage } from '../runner'
import { checkTests } from './checklist'
import { COURSES, courseOf } from './courses'
import type { Project } from './project'
import { executeProjectTests, type ProjectTestsInput } from './runtime'
import { evaluateStage, resumeStage, runStage, saveStageResult, stagePassed, stageResultId, stageStars, type Stage } from './stage'

let pg: PGlite
beforeAll(async () => {
  pg = await PGlite.create()
}, 60_000)
afterEach(() => vi.unstubAllGlobals())

const MIGRATION = 'CREATE TABLE produtos (id serial PRIMARY KEY, nome text NOT NULL);'

/** A stage: create a product, then read it back at its Location, with two checklist items. */
const stage: Stage = {
  id: 'criar-produto',
  title: 'Criar produto',
  statement: 'POST /produtos cria um produto; GET /produtos/:id lê.',
  files: ['src/index.ts', 'migrations/001_init.sql'],
  tests: [
    {
      name: 'cria e lê pelo Location',
      sequential: true,
      requests: [
        { request: { method: 'POST', path: '/produtos', body: { nome: 'Caneta' } }, expect: { status: 201 }, save: { onde: 'header.location', id: 'body.id' } },
        { request: { path: '{{onde}}' }, expect: { status: 200, body: { id: '{{id}}', nome: 'Caneta' } } },
      ],
      db: { sql: 'SELECT nome FROM produtos', rows: [{ nome: 'Caneta' }] },
    },
  ],
  checklist: [{ id: 'sem-select-estrela' }, { id: 'problem-json', request: { path: '/produtos/99' } }],
  hints: ['a', 'b', 'c'],
  explanation: 'Location aponta o recurso novo.',
  reference: { hono: {}, fetch: {} },
}

const project = (select: string, notFound: string): Project => ({
  id: 'p',
  framework: 'fetch',
  files: {
    'src/index.ts': `export default { async fetch(req: Request, env: any): Promise<Response> {
  if (req.method === 'POST') {
    const [p] = await env.db.query('INSERT INTO produtos (nome) VALUES ($1) RETURNING id, nome', [(await req.json()).nome])
    return Response.json(p, { status: 201, headers: { Location: '/produtos/' + p.id } })
  }
  const [p] = await env.db.query('${select} FROM produtos WHERE id = $1', [Number(new URL(req.url).pathname.split('/')[2])])
  return p ? Response.json(p) : ${notFound}
} }`,
    'migrations/001_init.sql': MIGRATION,
  },
})

const PROBLEM = "Response.json({ type: 'about:blank', title: 'Não encontrado', status: 404 }, { status: 404, headers: { 'Content-Type': 'application/problem+json' } })"
const PLAIN = 'new Response(null, { status: 404 })'

/** What a worker answers: the project's tests run here on a real Postgres. */
async function results(p: Project, input = stage): Promise<TestResult[]> {
  const out: TestResult[] = []
  const tests = [...input.tests, ...checkTests(input.checklist)]
  await executeProjectTests({ project: p, tests, seed: input.seed }, pg, ({ result }) => out.push(result))
  return out
}

describe('stageStars', () => {
  it('1 for the tests, +1 for half the checklist, +1 for all of it', () => {
    const c = (...passed: boolean[]) => passed.map((p) => ({ passed: p }))
    expect(stageStars(false, c(true, true))).toBe(0)
    expect(stageStars(true, c(false, false, false))).toBe(1)
    expect(stageStars(true, c(true, false, false))).toBe(1)
    expect(stageStars(true, c(true, false))).toBe(2)
    expect(stageStars(true, c(true, true))).toBe(3)
    expect(stageStars(true, [])).toBe(3)
  })
})

describe('evaluateStage', () => {
  it('gives 3 stars and their XP when the tests and the whole checklist pass', async () => {
    const p = project('SELECT id, nome', PROBLEM)
    const r = evaluateStage(p, stage, await results(p))
    expect(r.tests).toMatchObject([{ name: 'cria e lê pelo Location', passed: true }])
    expect(r.checklist.map((c) => [c.id, c.passed])).toEqual([['sem-select-estrela', true], ['problem-json', true]])
    expect(r).toMatchObject({ passed: true, stars: 3, xp: XP_PER_LEVEL + 3 * XP_PER_STAR })
  })

  it('drops a star per missed half of the checklist, and gives none when a test fails', async () => {
    expect(evaluateStage(project('SELECT *', PROBLEM), stage, await results(project('SELECT *', PROBLEM)))).toMatchObject({ passed: true, stars: 2 })
    expect(evaluateStage(project('SELECT *', PLAIN), stage, await results(project('SELECT *', PLAIN)))).toMatchObject({ passed: true, stars: 1 })
    const broken: Project = { ...project('SELECT id, nome', PROBLEM), files: { ...project('SELECT id, nome', PROBLEM).files, 'migrations/001_init.sql': 'CREATE TABLE produtos (id serial PRIMARY KEY, nome text, extra int NOT NULL);' } }
    const r = evaluateStage(broken, stage, await results(broken))
    expect(r).toMatchObject({ passed: false, stars: 0, xp: 0, tests: [{ passed: false }] })
    // A short list of results (the worker died) is a failure, not a pass.
    expect(evaluateStage(broken, stage, []).passed).toBe(false)
  })
})

describe('runStage', () => {
  afterAll(async () => {
    await prewarm(fakeWorker(() => []))
  })

  /** A worker that is ready at once and answers each batch of tests with `reply`. */
  const fakeWorker = (reply: (input: ProjectTestsInput) => TestResult[], posted: WorkerMessage[] = []): StartWorker => (onMessage) => {
    queueMicrotask(() => onMessage({ ready: true }))
    return {
      postMessage: (input) => {
        posted.push(input)
        if ('tests' in input && 'project' in input) reply(input).forEach((result, index) => queueMicrotask(() => onMessage({ index, result })))
      },
      terminate: () => {},
    }
  }

  it('sends the acceptance tests then the checklist tests, with the seed, and judges what comes back', async () => {
    const posted: WorkerMessage[] = []
    const p = project('SELECT id, nome', PROBLEM)
    const start = fakeWorker((input) => input.tests.map((t) => ({ name: t.name, passed: true, responses: [{ status: 404, headers: { 'content-type': 'application/problem+json' }, body: { type: 'x', title: 'y', status: 404 } }] })), posted)
    const r = await runStage(p, { ...stage, seed: 'SELECT 1' }, start)
    expect(posted).toMatchObject([{ project: p, seed: 'SELECT 1', tests: [{ name: 'cria e lê pelo Location' }, { name: 'checklist:problem-json' }] }])
    expect(r).toMatchObject({ passed: true, stars: 3 })
  })
})

describe('saveStageResult', () => {
  it('keeps the best stars under projeto:<course>:<stage> and counts its XP once', () => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) })
    expect(stageResultId('ecommerce', 'health')).toBe('projeto:ecommerce:health')
    expect(saveStageResult('ecommerce', 'health', { stars: 2 }).xp).toBe(XP_PER_LEVEL + 2 * XP_PER_STAR)
    expect(saveStageResult('ecommerce', 'health', { stars: 1 }).xp).toBe(0)
    expect(saveStageResult('ecommerce', 'health', { stars: 0 }).xp).toBe(0)
    expect(saveStageResult('ecommerce', 'health', { stars: 3 }).xp).toBe(XP_PER_STAR)
    expect(JSON.parse(data.get(RESULTS_KEY)!)).toEqual({ 'projeto:ecommerce:health': { stars: 3, cost: 0, p99Ms: 0, availability: 1 } })
    expect(totalXp(loadSavedResults())).toBe(XP_PER_LEVEL + 3 * XP_PER_STAR)
  })
})

describe('resumeStage', () => {
  const course = { id: 'c', title: 'C', stages: [stage, { ...stage, id: 'b' }, { ...stage, id: 'z' }] }
  const won = (...ids: string[]) => Object.fromEntries(ids.map((id) => [stageResultId('c', id), { stars: 1, cost: 0, p99Ms: 0, availability: 1 }]))

  it('opens the first stage not passed, and the last once all are', () => {
    expect(resumeStage(course, {})).toBe(0)
    expect(resumeStage(course, won('criar-produto'))).toBe(1)
    expect(resumeStage(course, won('criar-produto', 'b', 'z'))).toBe(2)
  })

  it('skips a new first stage the player never saw when later ones are saved', () => {
    expect(resumeStage(course, won('b'))).toBe(2)
  })

  it('counts a stage as passed only with a starred result of the same course', () => {
    expect(stagePassed(won('b'), 'c', 'b')).toBe(true)
    expect(stagePassed(won('b'), 'outro', 'b')).toBe(false)
    expect(stagePassed({ [stageResultId('c', 'b')]: { stars: 0, cost: 0, p99Ms: 0, availability: 1 } }, 'c', 'b')).toBe(false)
  })
})

describe('COURSES', () => {
  it('have distinct ids', () => {
    expect(new Set(COURSES.map((c) => c.id)).size).toBe(COURSES.length)
    expect(courseOf('nada')).toBe(COURSES[0])
    expect(courseOf(undefined).id).toBe('ecommerce')
  })
  it.each(['hono', 'fetch'] as const)('pass every orders stage with 3 stars from its %s reference', async (framework) => {
    for (const s of courseOf('ecommerce').stages) { // revisao has its own harness (revisao.test.ts)
      const p: Project = { id: 'ref', framework, files: s.reference[framework] }
      expect(evaluateStage(p, s, await results(p, s)), s.id).toMatchObject({ passed: true, stars: 3 })
    }
  })
})
