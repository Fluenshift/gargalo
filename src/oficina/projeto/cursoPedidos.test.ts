import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import type { TestResult } from '../exercise'
import { cursoPedidos } from './cursoPedidos'
import { checkTests } from './checklist'
import { docsFor } from './docs'
import { blank, starter, type Framework, type Project } from './project'
import { referencia } from './cursoPedidosRef'
import { executeProjectTests } from './runtime'
import { checkStep, evaluateStage, missingInFile, stepFor, stepTest, type RunTests, type Stage, type StageResult } from './stage'

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
  ['src/routes/ola.ts', "mensagem: 'olá'", "mensagem: 'ola'", 'tests'],
  ['src/http.ts', "'application/problem+json'", "'application/json'", 'checklist'],
  ['src/db/produtos.ts', "'SELECT id, nome, preco_centavos FROM produtos WHERE id = $1'", "'SELECT * FROM produtos WHERE id = $1'", 'checklist'],
  // The transaction becomes a plain function over `db`: the order is written, then the missing product throws.
  ['src/db/pedidos.ts', 'return db.transaction(async (tx) => {', 'return (async (tx: Db) => {', 'tests'],
  ['src/validacao.ts', 'return validar(await req.json().catch(() => undefined), schema)', 'return (await req.json()) as z.output<S>', 'tests'],
  ['src/db/produtos.ts', 'Math.min(filtro.limite, LIMITE_MAX)', 'filtro.limite', 'checklist'],
  ['src/auth.ts', "if (papel && sessao.papel !== papel)", 'if (false)', 'tests'],
]

describe('curso do projeto 1', () => {
  it('has the first steps and the six stages of the spec, each with a reference per framework', () => {
    expect(cursoPedidos.stages.map((s) => s.id)).toEqual(['primeiros-passos', 'health', 'produtos', 'pedidos', 'validacao', 'paginacao', 'auth'])
    for (const s of cursoPedidos.stages) {
      expect(Object.keys(s.reference.hono).length).toBeGreaterThanOrEqual(5)
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

describe('passos guiados', () => {
  const guided = cursoPedidos.stages.filter((s) => s.steps)
  // Where the player starts each stage: the starter, then the previous stage's reference.
  // Helpers the Health reference already carries (idDe, achado, extra) are taught later: those steps are checked against the starter.
  const ENSINADOS_DEPOIS = ['idDe e achado em src/http.ts', 'ErroHttp com campos extras']
  const before = (framework: Framework, stage: Stage, title = '') => (stage.id === 'primeiros-passos' ? blank('antes', framework).files : ENSINADOS_DEPOIS.includes(title) ? starter('antes', framework).files : referencia(framework, cursoPedidos.stages.indexOf(stage) - 1))

  it('guides every stage, with a short statement', () => {
    expect(guided.map((s) => s.id)).toEqual(cursoPedidos.stages.map((s) => s.id))
    for (const s of guided) expect(s.statement.length, s.id).toBeLessThan(200)
  })

  for (const framework of ['hono', 'fetch'] as Framework[]) {
    describe(framework, () => {
      const ids = new Set(docsFor(framework).flatMap((s) => s.entries.map((e) => e.id)))

      it('has unique doc ids', () => {
        expect(ids.size).toBe(docsFor(framework).flatMap((s) => s.entries).length)
      })

      for (const stage of guided) {
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
            expect(missingInFile(before(framework, stage, s.title), s.check), s.title).toBeDefined()
          }
        })

        it(stage.id + ': every request check answers as declared on the reference', async () => {
          for (const s of steps) {
            if (s.check?.kind !== 'request') continue
            const out: TestResult[] = []
            await executeProjectTests({ project: { id: 'passo', framework, files: stage.reference[framework] }, tests: [stepTest(s.check)], seed: stage.seed }, pg, ({ index, result }) => (out[index] = result))
            expect(out[0], s.title).toMatchObject({ passed: true })
          }
        }, 60_000)
      }
    })
  }
})

describe('conferências com corpo, cabeçalho e fluxo (#147)', () => {
  const onPg: RunTests = async (project, tests, seed) => {
    const out: TestResult[] = []
    await executeProjectTests({ project, tests, seed }, pg, ({ index, result }) => (out[index] = result))
    return out
  }
  const step = (stageId: string, title: string) => {
    const stage = cursoPedidos.stages.find((s) => s.id === stageId)!
    return { stage, check: stage.steps!.find((s) => s.title === title)!.check! }
  }
  // The auth reference with exigir() letting everyone through: the routes before "Proteja as rotas".
  const semProtecao = (files: Record<string, string>) => {
    const assinatura = "export async function exigir(req: Request, papel?: 'admin'): Promise<{ sub: number; papel: string }> {"
    expect(files['src/auth.ts']).toContain(assinatura)
    return { ...files, 'src/auth.ts': files['src/auth.ts'].replace(assinatura, assinatura + "\n  return { sub: 1, papel: 'admin' }") }
  }
  // Orders protected, product writes forgotten (no soAdmin, no exigir(req, 'admin')).
  const semAdmin = (files: Record<string, string>) => {
    const rotas = files['src/routes/produtos.ts'].replaceAll('soAdmin, ', '').replaceAll("    await exigir(req, 'admin')\n", '')
    expect(rotas).not.toBe(files['src/routes/produtos.ts'])
    return { ...files, 'src/routes/produtos.ts': rotas }
  }

  for (const framework of ['hono', 'fetch'] as Framework[]) {
    const project = (files: Record<string, string>): Project => ({ id: 'passo', framework, files })

    it(framework + ': validação manda um corpo válido (201) e o inválido do texto (400); sem validação, ele chega ao banco (500)', async () => {
      const { stage, check } = step('validacao', 'Teste e rode os testes')
      expect(check).toMatchObject({ method: 'POST', send: { body: { nome: '', preco_centavos: -1 } }, status: 400 })
      expect(await checkStep(project(stage.reference[framework]), check, stage.seed, onPg)).toBeUndefined()
      expect(await checkStep(project(referencia(framework, 3)), check, stage.seed, onPg)).toBe('Requisição 2 (POST /produtos): Status diferente do esperado. Esperado 400, veio 500.')
    }, 60_000)

    it(framework + ': cadastro e login fazem o fluxo de verdade, sem devolver a senha', async () => {
      const { stage, check } = step('auth', 'Rotas de cadastro e login')
      expect(await checkStep(project(stage.reference[framework]), check, stage.seed, onPg)).toBeUndefined()
      // Where the step starts: no users yet. And the answer can't carry the hash.
      expect(await checkStep(project(referencia(framework, 5)), check, stage.seed, onPg)).toBe('Requisição 1 (POST /usuarios): Status diferente do esperado. Esperado 201, veio 404.')
      const vaza = { ...stage.reference[framework], 'src/db/usuarios.ts': stage.reference[framework]['src/db/usuarios.ts'].replace('RETURNING id, email, papel', 'RETURNING id, email, papel, senha_hash') }
      expect(await checkStep(project(vaza), check, stage.seed, onPg)).toBe('Requisição 1 (POST /usuarios): A resposta traz o campo senha_hash, que não pode sair.')
    }, 60_000)

    it(framework + ': as rotas protegidas recusam sem token (401) e aceitam o token do admin (201); sem proteção, falha', async () => {
      const { stage, check } = step('auth', 'Proteja as rotas e teste')
      expect(check).toMatchObject({ method: 'POST', path: '/produtos', send: { headers: { Authorization: 'Bearer {{token}}' } }, status: 201 })
      expect(await checkStep(project(stage.reference[framework]), check, stage.seed, onPg)).toBeUndefined()
      expect(await checkStep(project(semProtecao(stage.reference[framework])), check, stage.seed, onPg)).toBe('Requisição 3 (POST /pedidos): Status diferente do esperado. Esperado 401, veio 201.')
      expect(await checkStep(project(semAdmin(stage.reference[framework])), check, stage.seed, onPg)).toBe('Requisição 4 (POST /produtos): Status diferente do esperado. Esperado 401, veio 201.')
      // The previous step's check still passes there: protecting the routes is all this step adds.
      expect(await checkStep(project(semProtecao(stage.reference[framework])), step('auth', 'Rotas de cadastro e login').check, stage.seed, onPg)).toBeUndefined()
    }, 60_000)
  }
})

describe('primeiros passos, do zero', () => {
  // A beginner who types every block, in order, on the blank project: each check passes when it is reached, and the stage ends with 3 stars.
  for (const framework of ['hono', 'fetch'] as Framework[]) {
    it(framework + ': typing each exact block passes every check and the stage', async () => {
      const stage = cursoPedidos.stages[0]
      const files = { ...blank('jogador', framework).files }
      expect(Object.keys(files)).toEqual(['src/env.ts'])
      for (const step of stage.steps!.map((s) => stepFor(s, framework))) {
        if (step.example?.exact) files[step.example.file!] = step.example.code
        if (step.check?.kind === 'file') expect(missingInFile(files, step.check), step.title).toBeUndefined()
        if (step.check?.kind === 'request') {
          const out: TestResult[] = []
          await executeProjectTests({ project: { id: 'jogador', framework, files }, tests: [stepTest(step.check)] }, pg, ({ index, result }) => (out[index] = result))
          expect(out[0], step.title).toMatchObject({ passed: true })
        }
      }
      const r = await run({ id: 'jogador', framework, files }, stage)
      expect(failures(r)).toEqual([])
      expect(r.stars).toBe(3)
    }, 60_000)
  }

  it('every step of every stage says what to do now', () => {
    for (const stage of cursoPedidos.stages)
      for (const framework of ['hono', 'fetch'] as Framework[])
        for (const s of stage.steps!.map((x) => stepFor(x, framework))) {
          expect(s.do, `${stage.id}: ${s.title}`).toBeTruthy()
          // "Testar agora" only exists on a step with a request check.
          if (s.do!.includes('Testar agora')) expect(s.check?.kind, `${stage.id}: ${s.title}`).toBe('request')
        }
  })
})
