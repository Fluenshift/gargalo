import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import type { TestResult } from '../exercise'
import { checkTests } from './checklist'
import { docsFor } from './docs'
import type { Project } from './project'
import { BUGGY_BLOCKS, FIXED_BLOCKS, judgeRevisao, revisaoCourse, revisaoRoutes, revisaoStage, revisaoStarter } from './revisao'
import { executeProjectTests } from './runtime'
import { evaluateStage, missingInFile, stepFor, stepTest } from './stage'

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

describe('passos guiados', () => {
  const steps = revisaoStage.steps!.map((s) => stepFor(s, 'fetch'))
  const ids = new Set(docsFor('fetch').flatMap((d) => d.entries.map((e) => e.id)))

  it('guia cada bug, com resumo curto', () => {
    expect(steps.length).toBeGreaterThanOrEqual(4)
    expect(steps.length).toBeLessThanOrEqual(8)
    expect(revisaoStage.statement.length).toBeLessThan(250)
  })

  it('toda documentação citada existe e o learn é curto', () => {
    for (const s of steps) {
      const linked = [...s.learn.matchAll(/\]\(([\w-]+)\)/g)].map((m) => m[1])
      for (const id of [...(s.docs ?? []), ...linked]) expect(ids.has(id), s.title + ' → ' + id).toBe(true)
      expect(s.learn.split(/[.!?](?:\s|$)/).filter((t) => t.trim()).length, s.title).toBeLessThanOrEqual(4)
    }
  })

  it('a conferência de arquivo passa na referência e falha no projeto com bugs', () => {
    for (const s of steps) {
      if (s.check?.kind !== 'file') continue
      expect(missingInFile(revisaoStage.reference.fetch, s.check), s.title).toBeUndefined()
      expect(missingInFile(revisaoStarter.files, s.check), s.title).toBeDefined()
    }
  })

  it('a conferência de requisição responde como declarado na referência', async () => {
    const project: Project = { ...revisaoStarter, files: { ...revisaoStarter.files, ...revisaoStage.reference.fetch } }
    for (const s of steps) {
      if (s.check?.kind !== 'request') continue
      const out: TestResult[] = []
      await executeProjectTests({ project, tests: [stepTest(s.check)], seed: revisaoStage.seed }, pg, ({ index, result }) => (out[index] = result))
      expect(out[0], s.title).toMatchObject({ passed: true })
    }
  }, 60_000)

  it('o ataque do passo de SQL injection só passa na busca corrigida', async () => {
    const check = steps.find((s) => s.check?.kind === 'request' && s.check.body !== undefined)!.check as Extract<NonNullable<(typeof steps)[number]['check']>, { kind: 'request' }>
    const out: TestResult[] = []
    await executeProjectTests({ project: { ...revisaoStarter, files: { ...revisaoStarter.files, 'src/index.ts': mixed([]) } }, tests: [stepTest(check)], seed: revisaoStage.seed }, pg, ({ index, result }) => (out[index] = result))
    expect(out[0].passed).toBe(false)
  }, 60_000)
})
