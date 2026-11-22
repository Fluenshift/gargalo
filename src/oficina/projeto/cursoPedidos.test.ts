import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import type { TestResult } from '../exercise'
import { cursoPedidos } from './cursoPedidos'
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

const failures = (r: StageResult) => [...r.tests.filter((t) => !t.passed).map((t) => t.name + ': ' + t.message), ...r.checklist.filter((c) => !c.passed).map((c) => c.id + ': ' + c.message)]

/** The mistake a beginner makes at each stage, applied to a file the two frameworks share. */
const NAIVE: [file: string, from: string, to: string, breaks: 'tests' | 'checklist'][] = [
  ['src/http.ts', "'application/problem+json'", "'application/json'", 'checklist'],
  ['src/db/produtos.ts', "'SELECT id, nome, preco_centavos FROM produtos WHERE id = $1'", "'SELECT * FROM produtos WHERE id = $1'", 'checklist'],
  // The transaction becomes a plain function over `db`: the order is written, then the missing product throws.
  ['src/db/pedidos.ts', 'return db.transaction(async (tx) => {', 'return (async (tx: Db) => {', 'tests'],
  ['src/validacao.ts', 'return validar(await req.json().catch(() => undefined), schema)', 'return (await req.json()) as z.output<S>', 'tests'],
  ['src/db/produtos.ts', 'Math.min(filtro.limite, LIMITE_MAX)', 'filtro.limite', 'checklist'],
  ['src/auth.ts', "if (papel && sessao.papel !== papel)", 'if (false)', 'tests'],
]

describe('curso do projeto 1', () => {
  it('has the six stages of the spec, each with a reference per framework', () => {
    expect(cursoPedidos.stages.map((s) => s.id)).toEqual(['health', 'produtos', 'pedidos', 'validacao', 'paginacao', 'auth'])
    for (const s of cursoPedidos.stages) {
      expect(Object.keys(s.reference.hono).length).toBeGreaterThan(5)
      expect(s.reference.fetch['src/index.ts']).not.toContain('hono')
      expect(s.files.every((f) => f in s.reference.hono && f in s.reference.fetch)).toBe(true)
    }
  })

  for (const framework of ['hono', 'fetch'] as Framework[]) {
    describe(framework, () => {
      for (const [i, stage] of cursoPedidos.stages.entries()) {
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
          if (file === 'src/db/pedidos.ts') files[file] = files[file].replace('criados }\n  })', 'criados }\n  })(db)')
          const r = await run(project(files), stage)
          expect(breaks === 'tests' ? r.passed : r.checklist.every((c) => c.passed)).toBe(false)
        }, 60_000)
      }
    })
  }
})
