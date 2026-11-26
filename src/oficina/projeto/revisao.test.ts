import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import type { TestResult } from '../exercise'
import { checkTests } from './checklist'
import { docsFor } from './docs'
import type { Project } from './project'
import {
  BUGGY_BLOCKS,
  FIXED_BLOCKS,
  REVISAO_BUGS,
  REVISAO_FIX_CHECKS,
  judgeRevisao,
  revisaoCourse,
  revisaoRoutes,
  revisaoStage,
  revisaoStarter,
} from './revisao'
import { executeProjectTests } from './runtime'
import { checkStep, evaluateStage, missingInFile, stepFor, stepTest, type RunTests } from './stage'

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
const mixed = (fixed: number[]) =>
  revisaoRoutes(...(BUGGY_BLOCKS.map((b, i) => (fixed.includes(i) ? FIXED_BLOCKS[i] : b)) as unknown as [string, string, string, string]))

describe('revisão de código', () => {
  it('o curso tem a etapa, que julga os bugs com judgeRevisao', () => {
    expect(revisaoCourse.stages).toEqual([revisaoStage])
    expect(revisaoStage.bugs).toBe(judgeRevisao)
  })

  it('o projeto com bugs falha em cada bug, cada um pelo seu motivo', async () => {
    const { results, project } = await run(mixed([]))
    expect(results.slice(0, 4).map((r) => r.passed)).toEqual([false, false, false, false])
    // The leak and the N+1 answer what the client asked for: the column that must not leave and the query count give them away.
    expect(results[0].message).toBe('A resposta traz o campo senha_hash, que não pode sair.')
    expect(results[3].message).toBe('A requisição fez 5 consultas ao banco; o máximo é 2.')
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

  it.each([0, 1, 2, 3])(
    'corrigir só o bug %i só conserta ele',
    async (bug) => {
      const { results } = await run(mixed([bug]))
      expect(judgeRevisao(results).map((b) => b.fixed)).toEqual([0, 1, 2, 3].map((k) => k === bug))
    },
    60_000,
  )
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

  it('cada bug tem o passo que confere o conserto', () => {
    for (const bug of REVISAO_BUGS)
      expect(
        steps.some((s) => s.check === REVISAO_FIX_CHECKS[bug.id]),
        bug.id,
      ).toBe(true)
  })

  it('o ataque do passo de SQL injection só passa na busca corrigida', async () => {
    const check = steps.find((s) => s.check?.kind === 'request' && s.check.body !== undefined)!.check as Extract<
      NonNullable<(typeof steps)[number]['check']>,
      { kind: 'request' }
    >
    const out: TestResult[] = []
    await executeProjectTests(
      { project: { ...revisaoStarter, files: { ...revisaoStarter.files, 'src/index.ts': mixed([]) } }, tests: [stepTest(check)], seed: revisaoStage.seed },
      pg,
      ({ index, result }) => (out[index] = result),
    )
    expect(out[0].passed).toBe(false)
  }, 60_000)
})

// Issue #147: the buggy project fails the four and the reference passes the four, through what the player uses:
// "Conferir passo" on the step that fixes each bug (checkStep), and the panel's verdicts after "Rodar testes" (stage.bugs on runStage's tests).
describe('os quatro veredictos, pelos mesmos checks do jogador', () => {
  const onPg: RunTests = async (project, tests, seed) => {
    const out: TestResult[] = []
    await executeProjectTests({ project, tests, seed }, pg, ({ index, result }) => (out[index] = result))
    return out
  }
  const withIndex = (index: string): Project => ({ ...revisaoStarter, files: { ...revisaoStarter.files, 'src/index.ts': index } })

  /** Per bug, in REVISAO_BUGS order: what Conferir passo says (undefined: passed) and what the panel says. */
  async function verdicts(index: string) {
    const project = withIndex(index)
    const steps: (string | undefined)[] = []
    for (const bug of REVISAO_BUGS) steps.push(await checkStep(project, REVISAO_FIX_CHECKS[bug.id], revisaoStage.seed, onPg))
    const stage = evaluateStage(project, revisaoStage, await onPg(project, [...revisaoStage.tests], revisaoStage.seed))
    return { steps, panel: revisaoStage.bugs!(stage.tests) }
  }

  it('com bugs, nenhum conserto confere e o painel diz os quatro ainda presentes', async () => {
    const { steps, panel } = await verdicts(mixed([]))
    expect(steps).toEqual([
      'A resposta traz o campo senha_hash, que não pode sair.',
      expect.stringMatching(/^Corpo da resposta diferente do esperado\. Esperado \[\], veio \[/),
      'Em src/index.ts ainda falta: RETURNING',
      'A requisição fez 5 consultas ao banco; o máximo é 2.',
    ])
    expect(panel).toEqual(REVISAO_BUGS.map((b) => ({ id: b.id, title: b.title, fixed: false })))
  }, 60_000)

  it('na referência, os quatro consertos conferem e o painel diz os quatro corrigidos', async () => {
    const { steps, panel } = await verdicts(revisaoStage.reference.fetch['src/index.ts'])
    expect(steps).toEqual([undefined, undefined, undefined, undefined])
    expect(panel.map((b) => b.fixed)).toEqual([true, true, true, true])
  }, 60_000)

  it.each([0, 1, 2, 3])(
    'corrigir só o bug %i: só o passo dele confere, e o painel concorda',
    async (bug) => {
      const { steps, panel } = await verdicts(mixed([bug]))
      expect(steps.map((m) => m === undefined)).toEqual([0, 1, 2, 3].map((k) => k === bug))
      expect(panel.map((b) => b.fixed)).toEqual([0, 1, 2, 3].map((k) => k === bug))
    },
    60_000,
  )
})
