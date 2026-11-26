import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import type { TestResult } from '../exercise'
import { cursoBanco } from './cursoBanco'
import { checkTests } from './checklist'
import { starter, type Framework, type Project } from './project'
import { executeProjectTests } from './runtime'
import { docsFor } from './docs'
import { referencia } from './cursoBancoRef'
import { evaluateStage, missingInFile, stepFor, stepTest, type Stage, type StageResult } from './stage'

let pg: PGlite
beforeAll(async () => {
  pg = await PGlite.create()
}, 60_000)

async function run(project: Project, stage: Stage): Promise<StageResult> {
  const out: TestResult[] = []
  const tests = [...stage.tests, ...checkTests(stage.checklist)]
  await executeProjectTests({ project, tests, seed: stage.seed }, pg, ({ index, result }) => (out[index] = result))
  return evaluateStage(project, stage, out)
}

const failures = (r: StageResult) => [
  ...r.tests.filter((t) => !t.passed).map((t) => t.name + ': ' + t.message),
  ...r.checklist.filter((c) => !c.passed).map((c) => c.id + ': ' + c.message),
]

/** The mistake a beginner makes at each stage, applied to a file the two frameworks share. */
const NAIVE: [file: string, from: string, to: string, breaks: 'tests' | 'checklist'][] = [
  ['src/http.ts', "'application/problem+json'", "'application/json'", 'checklist'],
  [
    'src/db/transferencias.ts',
    `    await tx.query('SELECT id FROM contas WHERE id = ANY($1) ORDER BY id FOR UPDATE', [[de, para]])
    const [origem] = await tx.query<{ saldo_centavos: number }>(
      'UPDATE contas SET saldo_centavos = saldo_centavos - $1 WHERE id = $2 AND saldo_centavos >= $1 RETURNING saldo_centavos',
      [valor, de],
    )
    if (!origem) {
      const existe = await tx.query('SELECT 1 FROM contas WHERE id = $1', [de])
      if (!existe.length) throw new ErroHttp(404, 'Conta não encontrada', 'Conta de origem não encontrada.')
      throw new ErroHttp(409, 'Saldo insuficiente', 'Saldo insuficiente para realizar a transferência.')
    }`,
    `    const [origem] = await tx.query<{ saldo_centavos: number }>('SELECT saldo_centavos FROM contas WHERE id = $1', [de])
    if (!origem) throw new ErroHttp(404, 'Conta não encontrada', 'Conta de origem não encontrada.')
    if (origem.saldo_centavos < valor) throw new ErroHttp(409, 'Saldo insuficiente', 'Saldo insuficiente para realizar a transferência.')
    origem.saldo_centavos -= valor
    await tx.query('UPDATE contas SET saldo_centavos = $1 WHERE id = $2', [origem.saldo_centavos, de])`,
    'checklist',
  ],
  ['src/db/pagamentos.ts', 'ON CONFLICT (chave) DO NOTHING ', '', 'tests'],
]

describe('curso do projeto Banco', () => {
  it('has the three stages of the spec, each with a reference per framework', () => {
    expect(cursoBanco.id).toBe('banco')
    expect(cursoBanco.stages.map((s) => s.id)).toEqual(['contas', 'transferencias', 'pagamentos'])
    for (const s of cursoBanco.stages) {
      expect(Object.keys(s.reference.hono).length).toBeGreaterThanOrEqual(7)
      expect(s.reference.fetch['src/index.ts']).not.toContain('hono')
      expect(s.files.every((f) => f in s.reference.hono && f in s.reference.fetch)).toBe(true)
    }
  })

  for (const framework of ['hono', 'fetch'] as Framework[]) {
    describe(framework, () => {
      for (const [i, stage] of cursoBanco.stages.entries()) {
        const project = (files: Record<string, string>): Project => ({ id: 'curso', framework, files })

        it(
          'etapa ' + (i + 1) + ' ' + stage.id + ': a referência passa com o checklist completo',
          async () => {
            const r = await run(project(stage.reference[framework]), stage)
            expect(failures(r)).toEqual([])
            expect(r).toMatchObject({ passed: true, stars: 3 })
          },
          60_000,
        )

        it(
          'etapa ' + (i + 1) + ' ' + stage.id + ': o código ingênuo falha',
          async () => {
            const [file, from, to, breaks] = NAIVE[i]
            const files = { ...stage.reference[framework] }
            expect(files[file], file).toContain(from)
            files[file] = files[file].replace(from, to)
            const r = await run(project(files), stage)
            expect(breaks === 'tests' ? r.passed : r.checklist.every((c) => c.passed)).toBe(false)
          },
          60_000,
        )
      }
    })
  }
})

describe('passos guiados', () => {
  const curso = cursoBanco
  // Where the player starts each stage: the starter plus the course's base files, then the previous stage's reference.
  const before = (framework: Framework, i: number) => (i === 0 ? { ...starter('antes', framework).files, ...curso.baseFiles } : referencia(framework, i))

  it('guides every stage, with a short statement', () => {
    for (const s of curso.stages) {
      expect(s.steps?.length, s.id).toBeGreaterThanOrEqual(4)
      expect(s.steps!.length, s.id).toBeLessThanOrEqual(8)
      expect(s.statement.length, s.id).toBeLessThan(200)
    }
  })

  for (const framework of ['hono', 'fetch'] as Framework[]) {
    describe(framework, () => {
      const ids = new Set(docsFor(framework).flatMap((s) => s.entries.map((e) => e.id)))

      it('has unique doc ids', () => {
        expect(ids.size).toBe(docsFor(framework).flatMap((s) => s.entries).length)
      })

      for (const [i, stage] of curso.stages.entries()) {
        const steps = stage.steps!.map((s) => stepFor(s, framework))

        it(stage.id + ': every docs id and [term](id) link exists', () => {
          for (const s of steps) {
            const linked = [...s.learn.matchAll(/\]\(([\w-]+)\)/g)].map((m) => m[1])
            for (const id of [...(s.docs ?? []), ...linked]) expect(ids.has(id), s.title + ' → ' + id).toBe(true)
          }
        })

        it(stage.id + ': learn stays short, at most 4 sentences', () => {
          for (const s of steps) expect(s.learn.split(/[.!?](?:\s|$)/).filter((t) => t.trim()).length, s.title).toBeLessThanOrEqual(4)
        })

        it(stage.id + ': every file check passes on the reference and fails where the player starts', () => {
          for (const s of steps) {
            if (s.check?.kind !== 'file') continue
            expect(missingInFile(stage.reference[framework], s.check), s.title).toBeUndefined()
            // The reference's src/validacao.ts holds every schema from stage 1, so its later checks can't fail on it.
            if (i > 0 && s.check.path === 'src/validacao.ts') continue
            expect(missingInFile(before(framework, i), s.check), s.title).toBeDefined()
          }
        })

        it(
          stage.id + ': every request check answers as declared on the reference',
          async () => {
            for (const s of steps) {
              if (s.check?.kind !== 'request') continue
              const out: TestResult[] = []
              await executeProjectTests(
                { project: { id: 'passo', framework, files: stage.reference[framework] }, tests: [stepTest(s.check)], seed: stage.seed },
                pg,
                ({ index, result }) => (out[index] = result),
              )
              expect(out[0], s.title).toMatchObject({ passed: true })
            }
          },
          60_000,
        )
      }
    })
  }
})
