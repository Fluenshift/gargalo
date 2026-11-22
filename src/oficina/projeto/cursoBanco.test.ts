import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import type { TestResult } from '../exercise'
import { cursoBanco } from './cursoBanco'
import { checkTests } from './checklist'
import type { Framework, Project } from './project'
import { executeProjectTests } from './runtime'
import { evaluateStage, type Stage, type StageResult } from './stage'

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

        it('etapa ' + (i + 1) + ' ' + stage.id + ': a referência passa com o checklist completo', async () => {
          const r = await run(project(stage.reference[framework]), stage)
          expect(failures(r)).toEqual([])
          expect(r).toMatchObject({ passed: true, stars: 3 })
        }, 60_000)

        it('etapa ' + (i + 1) + ' ' + stage.id + ': o código ingênuo falha', async () => {
          const [file, from, to, breaks] = NAIVE[i]
          const files = { ...stage.reference[framework] }
          expect(files[file], file).toContain(from)
          files[file] = files[file].replace(from, to)
          const r = await run(project(files), stage)
          expect(breaks === 'tests' ? r.passed : r.checklist.every((c) => c.passed)).toBe(false)
        }, 60_000)
      }
    })
  }
})
