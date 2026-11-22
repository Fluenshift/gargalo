import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import type { TestResult } from '../exercise'
import { checkTests } from './checklist'
import type { Project } from './project'
import { BUGGY_BLOCKS, FIXED_BLOCKS, judgeRevisao, revisaoCourse, revisaoRoutes, revisaoStage, revisaoStarter } from './revisao'
import { executeProjectTests } from './runtime'
import { evaluateStage } from './stage'

let pg: PGlite
beforeAll(async () => {
  pg = await PGlite.create()
}, 60_000)

async function run(index: string): Promise<{ results: TestResult[]; project: Project }> {
  const project: Project = { ...revisaoStarter, files: { ...revisaoStarter.files, 'src/index.ts': index } }
  const results: TestResult[] = []
  const tests = [...revisaoStage.tests, ...checkTests(revisaoStage.checklist)]
  await executeProjectTests({ project, tests, seed: revisaoStage.seed }, pg, ({ index: i, result }) => (results[i] = result))
  return { results, project }
}

/** The buggy project with only the `fixed` bugs' routes replaced by their fix. */
const mixed = (fixed: number[]) => revisaoRoutes(...(BUGGY_BLOCKS.map((b, i) => (fixed.includes(i) ? FIXED_BLOCKS[i] : b)) as unknown as [string, string, string, string]))

describe('revisão de código', () => {
  it('o curso tem a etapa', () => expect(revisaoCourse.stages).toEqual([revisaoStage]))

  it('o projeto com bugs falha em cada bug', async () => {
    const { results, project } = await run(mixed([]))
    expect(results.slice(1, 3).map((r) => r.passed)).toEqual([false, false])
    // these two give an acceptable answer; the leaked column and the number of queries give the bug away
    expect(JSON.stringify(results[0].responses?.[0]?.body)).toContain('senha_hash')
    expect(results[3].passed).toBe(true)
    expect(results[3].metrics?.[0].queries).toBeGreaterThan(2)
    expect(judgeRevisao(results).map((b) => b.fixed)).toEqual([false, false, false, false])
    expect(evaluateStage(project, revisaoStage, results).passed).toBe(false)
  }, 60_000)

  it('a versão corrigida passa em tudo, com 3 estrelas', async () => {
    const { results, project } = await run(revisaoStage.reference.fetch['src/index.ts'])
    expect(judgeRevisao(results).map((b) => b.fixed)).toEqual([true, true, true, true])
    const stage = evaluateStage(project, revisaoStage, results)
    expect(stage.passed).toBe(true)
    expect(stage.stars).toBe(3)
  }, 60_000)

  it.each([0, 1, 2, 3])('corrigir só o bug %i só conserta ele', async (bug) => {
    const { results } = await run(mixed([bug]))
    expect(judgeRevisao(results).map((b) => b.fixed)).toEqual([0, 1, 2, 3].map((k) => k === bug))
  }, 60_000)
})
