// A guided project is a course of stages; each stage has acceptance tests, a good-practice checklist, hints and a reference.

import { XP_PER_LEVEL, XP_PER_STAR, PROJETO_PREFIX, type LevelResult, type Results } from '../../score'
import type { TestCase, TestResult } from '../exercise'
import { keepResult } from '../progress'
import type { StartWorker } from '../runner'
import { checkTests, evaluateChecklist, type CheckOutcome, type CheckRef } from './checklist'
import type { Framework, Project } from './project'
import { runTests } from './runner'

export interface Stage {
  id: string
  title: string
  /** What to build, in Portuguese. */
  statement: string
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
}

export interface ProjectCourse {
  id: string
  title: string
  stages: Stage[]
  /** The project a new one of this course starts from; without it, the framework's own starter. */
  starter?: Project
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
