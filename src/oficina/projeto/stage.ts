// A guided project is a course of stages; each stage has acceptance tests, a good-practice checklist, hints and a reference.

import { XP_PER_LEVEL, XP_PER_STAR, PROJETO_PREFIX, type LevelResult, type Results } from '../../score'
import type { RequestSpec, TestCase, TestResult, TestStep } from '../exercise'
import { keepResult } from '../progress'
import type { StartWorker } from '../runner'
import { checkTests, evaluateChecklist, type CheckOutcome, type CheckRef } from './checklist'
import type { Method } from './http'
import type { Framework, Project } from './project'
import { runTests } from './runner'

/** What "Conferir passo" looks at: a file (exists, and has these snippets), or a request on a fresh test database. */
export type StepCheck = { kind: 'file'; path: string; contains?: string[] } | RequestCheck

/** A request and what its answer must be. "Testar agora" sends the same requests to the dev database. */
export interface RequestCheck {
  kind: 'request'
  method?: Method
  path: string
  /** What else the request carries: a body, sent as JSON, and headers (`{ Authorization: 'Bearer {{token}}' }`). */
  send?: { body?: unknown; headers?: Record<string, string> }
  status: number
  /** The response body, matched like an acceptance test's: an object needs only these keys. */
  body?: unknown
  /** Keys the response body must not have, at any depth (`senha_hash`). */
  absent?: string[]
  /** The most database queries the request may make: an N+1 goes over it. */
  maxQueries?: number
  /**
   * Requests sent first, in order, on the same database (sign up, log in…), like a checklist item's `before`:
   * their `expect` is checked too, and what they `save` fills `{{name}}` in the requests after them.
   */
  before?: TestStep[]
}

/** One guided step: one concept, why it matters, the pattern in code, where the docs explain it, and a way to confirm it. */
export interface GuidedStep {
  title: string
  /** The one thing to do now, in a sentence ("Abra src/index.ts e digite o código abaixo."). Shown first. */
  do?: string
  /** The concept, 2 to 4 short sentences, the why before the how. `[term](doc-id)` links a term to its docs entry. */
  learn: string
  /** "Abrir <arquivo>": opens it, created empty when missing. */
  file?: string
  /**
   * The pattern, commented line by line; `note` says what changes in the player's task.
   * `exact`: the whole content of `file` after this step, to type as is (the first stage, built from an empty project).
   */
  example?: { file?: string; code: string; note?: string; exact?: boolean }
  /** Ids of docsFor() entries. */
  docs?: string[]
  /** A request check also gives "Testar agora", which sends its requests (`before`, then its own) from the Requisição tab. */
  check?: StepCheck
  /** What differs in one framework; the rest is shared. */
  byFramework?: Partial<Record<Framework, Partial<Omit<GuidedStep, 'title' | 'byFramework'>>>>
}

/** The step as the player's framework shows it. */
export const stepFor = (step: GuidedStep, framework: Framework): GuidedStep => ({ ...step, ...step.byFramework?.[framework] })

// Snippets match ignoring spaces and quote style, so "c.json({ a: 1 })" and 'c.json({a:1})' are the same.
const squash = (code: string) => code.replace(/\s+/g, '').replace(/["`]/g, "'")

/** What a file check finds missing, in Portuguese; undefined when it passes. */
export function missingInFile(files: Record<string, string>, check: Extract<StepCheck, { kind: 'file' }>): string | undefined {
  if (!Object.hasOwn(files, check.path)) return `Falta criar ${check.path}.`
  const code = squash(files[check.path])
  const missing = (check.contains ?? []).filter((s) => !code.includes(squash(s)))
  return missing.length ? `Em ${check.path} ainda falta: ${missing.join(' · ')}` : undefined
}

/** The request a request check sends, after its `before` steps. */
export const stepRequest = (check: RequestCheck): RequestSpec => ({ method: check.method, path: check.path, ...check.send })

/** A request check as an acceptance test, so it runs like the stage's own: the `before` steps, then the request, one after the other. */
export const stepTest = (check: RequestCheck): TestCase => ({
  name: `${check.method ?? 'GET'} ${check.path} responde ${check.status}`,
  sequential: true,
  requests: [...(check.before ?? []), { request: stepRequest(check), expect: { status: check.status, body: check.body, absent: check.absent, maxQueries: check.maxQueries } }],
})

/** What a request check's test found wrong, in Portuguese; undefined when it passed. */
export function missingInResponse(result: TestResult): string | undefined {
  if (result.passed) return undefined
  const diff = 'expected' in result ? ` Esperado ${JSON.stringify(result.expected)}, veio ${JSON.stringify(result.received)}.` : ''
  return (result.message ?? 'Resposta diferente do esperado.') + diff
}

/** Runs tests on a fresh test database each, one result per test in order: `runTests` in the worker, or the tests' own Postgres. */
export type RunTests = (project: Project, tests: TestCase[], seed?: string) => Promise<TestResult[]>

/** "Conferir passo": undefined when the step's check passes, otherwise what is missing, in Portuguese. */
export async function checkStep(project: Project, check: StepCheck, seed?: string, run: RunTests = runTests): Promise<string | undefined> {
  if (check.kind === 'file') return missingInFile(project.files, check)
  const [result] = await run(project, [stepTest(check)], seed)
  return missingInResponse(result)
}

export interface Stage {
  id: string
  title: string
  /** What to build, in Portuguese; with `steps`, a 1-2 sentence summary, otherwise numbered steps (splitStatement). */
  statement: string
  steps?: GuidedStep[]
  /** Paths this stage creates or expects, e.g. `src/routes/produtos.ts`, `migrations/002_pedidos.sql`. */
  files: string[]
  /** Acceptance tests; `sequential` ones carry values between requests with `save` and `{{name}}`. */
  tests: TestCase[]
  checklist: CheckRef[]
  /** In order: one unlocked per failed run (`unlockedHints`). */
  hints: [string, string, string]
  /** Shown once the stage passes. */
  explanation: string
  /** The whole project after this stage, per framework; "pular para a etapa N" starts from the previous stage's. */
  reference: Record<Framework, Record<string, string>>
  /** SQL run after the migrations, before each test. */
  seed?: string
  /** A code review's planted bugs, judged from the results of `tests` (`judgeRevisao`): after a run, the panel says which are still there. */
  bugs?: (tests: TestResult[]) => { title: string; fixed: boolean }[]
}

export interface ProjectCourse {
  id: string
  title: string
  /** One line for the course picker: what the player builds, and whether it is the place to start. */
  summary: string
  stages: Stage[]
  /** The project a new one of this course starts from; without it, the framework's own starter. */
  starter?: Project
  /** New projects start from blank() (only src/env.ts) instead of the framework's starter. */
  blank?: boolean
  /** Files added to the framework's starter, such as helpers the course's hints rely on. */
  baseFiles?: Record<string, string>
}

export interface StageResult {
  tests: TestResult[]
  checklist: CheckOutcome[]
  /** Every acceptance test passed. */
  passed: boolean
  stars: number
  /** What this result is worth: a base and a bonus per star, like an exercise (0 when it didn't pass). */
  xp: number
}

/**
 * 0 unless every acceptance test passes; then 1, plus 1 when at least half the checklist passes, plus 1 when all of it does.
 * A stage with no checklist gets 3 once its tests pass.
 */
export function stageStars(testsPassed: boolean, checklist: Pick<CheckOutcome, 'passed'>[]): number {
  if (!testsPassed) return 0
  const ok = checklist.filter((c) => c.passed).length
  return 1 + Number(ok * 2 >= checklist.length) + Number(ok === checklist.length)
}

/** Judges a stage from the results of its tests followed by its checklist's tests (what runStage runs). */
export function evaluateStage(project: Project, stage: Stage, results: TestResult[]): StageResult {
  const tests = results.slice(0, stage.tests.length)
  const checklist = evaluateChecklist(stage.checklist, project.files, results.slice(stage.tests.length))
  const passed = tests.length > 0 && tests.length === stage.tests.length && tests.every((t) => t.passed)
  const stars = stageStars(passed, checklist)
  return { tests, checklist, passed, stars, xp: stars ? XP_PER_LEVEL + XP_PER_STAR * stars : 0 }
}

/** Runs the stage's acceptance tests and its checklist's behaviour tests on fresh test databases, then judges the whole. */
export async function runStage(project: Project, stage: Stage, start?: StartWorker): Promise<StageResult> {
  const results = await runTests(project, [...stage.tests, ...checkTests(stage.checklist)], stage.seed, start)
  return evaluateStage(project, stage, results)
}

export const stageResultId = (course: string, stage: string) => `${PROJETO_PREFIX}${course}:${stage}`

/** Keeps the stage's result beside the exercises' (`gargalo:results`) when it beats the saved one; returns what is saved and the XP it added. */
export function saveStageResult(course: string, stage: string, result: Pick<StageResult, 'stars'>): { results: Results; xp: number } {
  // A stage has no cost or latency goal: neutral values, so only stars decide which result is better.
  const kept: LevelResult = { stars: result.stars, cost: 0, p99Ms: 0, availability: 1 }
  return keepResult(stageResultId(course, stage), kept)
}

/** Whether the stage has a saved result that passed its tests. */
export const stagePassed = (results: Results, course: string, stage: string) => (results[stageResultId(course, stage)]?.stars ?? 0) > 0

/** Where the player resumes: right after the last stage passed (so a stage added before saved ones is not forced on old players), or the last when all are. */
export function resumeStage(course: ProjectCourse, results: Results): number {
  const last = course.stages.findLastIndex((s) => stagePassed(results, course.id, s.id))
  return Math.min(last + 1, course.stages.length - 1)
}

/** A stage statement as its intro (text before step 1) and numbered steps ("1. ..."; other lines belong to the step above, the number is dropped). No numbering: one step. */
export function splitStatement(statement: string): { intro: string; steps: string[] } {
  const intro: string[] = []
  const steps: string[][] = []
  for (const line of statement.split('\n')) {
    const m = /^\d+\. (.*)$/.exec(line)
    if (m) steps.push([m[1]])
    else (steps.at(-1) ?? intro).push(line)
  }
  const join = (lines: string[]) => lines.join('\n').trim()
  return steps.length ? { intro: join(intro), steps: steps.map(join) } : { intro: '', steps: [statement.trim()] }
}

export const statementSteps = (statement: string): string[] => splitStatement(statement).steps
