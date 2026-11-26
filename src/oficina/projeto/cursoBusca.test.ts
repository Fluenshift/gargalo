import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { pgliteDb } from '../db'
import type { TestResult } from '../exercise'
import { checkTests } from './checklist'
import { cursoBusca } from './cursoBusca'
import { starter, type Framework, type Project } from './project'
import { executeProjectTests, migrate } from './runtime'
import { docsFor } from './docs'
import { referencia } from './cursoBuscaRef'
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
  ['src/db/produtos.ts', "'SELECT id, nome, preco_centavos FROM produtos ORDER BY id'", "'SELECT * FROM produtos ORDER BY id'", 'checklist'],
  ['src/db/produtos.ts', 'Math.min(filtro.limite, LIMITE_MAX)', 'filtro.limite', 'checklist'],
  ['migrations/002_indice_busca.sql', 'CREATE INDEX produtos_nome_idx ON produtos (lower(nome) text_pattern_ops);', '-- sem indice', 'tests'],
]

describe('curso de busca e paginação', () => {
  it('has the three stages of the spec, each with a reference per framework', () => {
    expect(cursoBusca.stages.map((s) => s.id)).toEqual(['listagem', 'paginacao', 'busca'])
    for (const s of cursoBusca.stages) {
      expect(Object.keys(s.reference.hono).length).toBeGreaterThan(5)
      expect(s.reference.fetch['src/index.ts']).not.toContain('hono')
      expect(s.files.every((f) => f in s.reference.hono && f in s.reference.fetch)).toBe(true)
    }
  })

  for (const framework of ['hono', 'fetch'] as Framework[]) {
    describe(framework, () => {
      const project = (files: Record<string, string>): Project => ({ id: 'curso-busca', framework, files })
      for (const [i, stage] of cursoBusca.stages.entries()) {
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

      it('etapa 2 paginacao: uma solução ingênua com OFFSET falha', async () => {
        const stage = cursoBusca.stages[1]
        const files = { ...stage.reference[framework] }
        const from = 'WHERE id > $1 ORDER BY id LIMIT $2'
        const to = 'ORDER BY id LIMIT $2 OFFSET $1'
        expect(files['src/db/produtos.ts']).toContain(from)
        files['src/db/produtos.ts'] = files['src/db/produtos.ts'].replace(from, to)
        const r = await run(project(files), stage)
        expect(r.passed).toBe(false)
      }, 60_000)

      it('etapa 3 busca: uma solução ingênua com ILIKE e % no início falha', async () => {
        const stage = cursoBusca.stages[2]
        const files = { ...stage.reference[framework] }
        const from = 'WHERE lower(nome) LIKE $1 ORDER BY lower(nome) LIMIT 20'
        const to = "WHERE nome ILIKE '%' || $1 || '%' ORDER BY id LIMIT 20"
        expect(files['src/db/produtos.ts']).toContain(from)
        files['src/db/produtos.ts'] = files['src/db/produtos.ts'].replace(from, to)
        const r = await run(project(files), stage)
        expect(r.passed && r.checklist.every((c) => c.passed)).toBe(false)
      }, 60_000)
    })
  }

  it('etapa 3: com a migração, o EXPLAIN mostra o uso do índice em vez de varredura sequencial', async () => {
    const stage = cursoBusca.stages[2]
    const files = stage.reference.hono

    await pgliteDb(pg)('', '')
    await migrate(pg, files)
    if (stage.seed) await pg.exec(stage.seed)
    await pg.exec('ANALYZE')

    const plan = JSON.stringify(
      await pg.query("EXPLAIN SELECT id, nome, preco_centavos FROM produtos WHERE lower(nome) LIKE 'tecl%' ORDER BY lower(nome) LIMIT 20"),
    )
    expect(plan).toMatch(/Index Scan using produtos_nome_idx/)

    // Without migration: falls back to Seq Scan
    const filesSemIndice = { ...files }
    delete filesSemIndice['migrations/002_indice_busca.sql']
    await pgliteDb(pg)('', '')
    await migrate(pg, filesSemIndice)
    if (stage.seed) await pg.exec(stage.seed)
    await pg.exec('ANALYZE')

    const naivePlan = JSON.stringify(
      await pg.query("EXPLAIN SELECT id, nome, preco_centavos FROM produtos WHERE lower(nome) LIKE 'tecl%' ORDER BY lower(nome) LIMIT 20"),
    )
    expect(naivePlan).toMatch(/Seq Scan on produtos/)
  }, 60_000)
})

describe('passos guiados', () => {
  const curso = cursoBusca
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
