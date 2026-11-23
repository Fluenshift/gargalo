import { PGlite } from '@electric-sql/pglite'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Results } from '../../score'
import { cursoPedidos } from './cursoPedidos'
import { exportFiles, importedPackages, slugOf, type ExportContext } from './exportar'
import { buildOpenApi } from './openapi'
import { starter, type Project } from './project'
import { stageResultId } from './stage'
import { unzip, zip } from './zip'

const last = cursoPedidos.stages.at(-1)!
const reference: Project = { id: 'p1', framework: 'hono', files: last.reference.hono }
const results: Results = Object.fromEntries(cursoPedidos.stages.map((s) => [stageResultId('ecommerce', s.id), { stars: 3, cost: 0, p99Ms: 0, availability: 1 }]))
const ctx = (over: Partial<ExportContext> = {}): ExportContext => ({
  name: 'Minha API de Pedidos',
  course: cursoPedidos,
  results,
  openapi: buildOpenApi({ title: 'Minha API de Pedidos', routes: [{ method: 'GET', path: '/produtos/:id' }], requests: [] }),
  ...over,
})

describe('exportFiles on the e-commerce reference project', () => {
  const files = exportFiles(reference, ctx())

  it("keeps the player's files and adds what runs outside the browser", () => {
    for (const path of Object.keys(reference.files)) expect(files[path]).toBe(reference.files[path])
    for (const path of ['package.json', 'tsconfig.json', 'docker-compose.yml', '.env.example', '.gitignore', 'openapi.json', 'README.md', 'src/infra/banco.ts', 'src/infra/migrar.ts', 'src/infra/servidor.ts', 'tests/suporte.ts'])
      expect(files, path).toHaveProperty([path])
  })

  it('has one acceptance test file per completed stage: the latest in tests/, the earlier ones in tests/historico/', () => {
    const tests = Object.keys(files).filter((p) => p.endsWith('.test.ts'))
    expect(tests).toHaveLength(cursoPedidos.stages.length)
    expect(tests.filter((p) => !p.includes('historico'))).toEqual(['tests/etapa-07-auth.test.ts'])
    expect(files['tests/historico/etapa-01-primeiros-passos.test.ts']).toContain("from '../../src/infra/banco'")
    expect(files['tests/historico/etapa-03-produtos.test.ts']).toContain('Caneta')
    expect(files['vitest.historico.config.ts']).toContain('tests/historico')
  })

  it('only tests the stages that were passed', () => {
    const some = exportFiles(reference, ctx({ results: { [stageResultId('ecommerce', 'health')]: { stars: 1, cost: 0, p99Ms: 0, availability: 1 } } }))
    expect(Object.keys(some).filter((p) => p.startsWith('tests/etapa'))).toEqual(['tests/etapa-02-health.test.ts'])
    expect(some['README.md']).toContain('Health check (1 de 3 estrelas)')
    expect(exportFiles(reference, ctx({ results: {} }))['README.md']).toContain('_Nenhuma etapa concluída ainda._')
  })

  it('lists the dependencies the code imports, with the server and both databases', () => {
    const pkg = JSON.parse(files['package.json']) as { name: string; dependencies: Record<string, string>; scripts: Record<string, string> }
    expect(pkg.name).toBe('minha-api-de-pedidos')
    expect(Object.keys(pkg.dependencies)).toEqual(expect.arrayContaining(['hono', '@hono/node-server', 'pg', '@electric-sql/pglite', 'zod']))
    expect(pkg.scripts).toMatchObject({ start: expect.any(String), test: 'vitest run' })
    expect(importedPackages({ a: "import { z } from 'zod'\nimport x from 'node:fs'\nimport y from '@a/b/c'\nimport z2 from './local'" })).toEqual(['@a/b', 'zod'])
  })

  it('writes a README in Portuguese with every section', () => {
    const readme = files['README.md']
    for (const section of ['# Minha API de Pedidos', '## O que a API faz', '## Etapas concluídas', '## Boas práticas do checklist', '## Como rodar', 'Com Docker', 'Sem Docker', '## Testes', '## Publicar no GitHub'])
      expect(readme, section).toContain(section)
    expect(readme).toContain('`GET /produtos/{id}`')
    expect(readme).toContain('Health check (3 de 3 estrelas)')
    expect(readme).toContain('gh repo create minha-api-de-pedidos --public --source . --push')
    expect(readme).toContain('SQL parametrizado')
  })

  it('holds the OpenAPI document as JSON', () => {
    expect(JSON.parse(files['openapi.json'])).toMatchObject({ openapi: '3.1.0', info: { title: 'Minha API de Pedidos' } })
  })

  it('exports a fetch puro project too, and a starter with no stage passed', () => {
    const f = exportFiles(starter('p2', 'fetch'), ctx({ results: {} }))
    expect(f['src/index.ts']).toContain('export default {')
    expect(f['README.md']).toContain('fetch puro')
    expect(f['README.md']).toContain('_Nenhuma prática confirmada ainda._')
    expect(Object.keys(f).some((p) => p.startsWith('tests/etapa'))).toBe(false)
  })

  it('lists only the practices the code proves when a stage has fewer than three stars', () => {
    const stage = cursoPedidos.stages.find((s) => s.id === 'produtos')!
    const two = exportFiles(reference, ctx({ results: { [stageResultId('ecommerce', 'produtos')]: { stars: 2, cost: 0, p99Ms: 0, availability: 1 } } }))['README.md']
    const lines = two.split('\n').filter((l) => l.endsWith('(Produtos)') || l.endsWith(`(${stage.title})`))
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.length).toBeLessThan(stage.checklist.length + 1)
  })

  it('makes a slug for the repository name', () => {
    expect(slugOf('Mão na Massa!')).toBe('mao-na-massa')
    expect(slugOf('???')).toBe('projeto-gargalo')
  })

  it('zips and unzips to the same files', () => {
    expect(unzip(zip(files))).toEqual(files)
  })
})

// The exported src/infra files run here as they are, on PGlite; pg is not installed in this repo, so its adapter gets a Pool-shaped stand-in.
describe('the exported database adapter', () => {
  type Banco = { query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>; transaction<R>(fn: (tx: Banco) => Promise<R>): Promise<R>; exec(sql: string): Promise<void> }
  let dir: string
  let pg: PGlite
  let mod: { pgBanco(pool: unknown): Banco; pgliteBanco(pg: PGlite): Banco }
  let migrar: (db: Banco, pasta: string) => Promise<string[]>

  beforeAll(async () => {
    pg = await PGlite.create()
    dir = mkdtempSync(join(tmpdir(), 'gargalo-exportar-'))
    const files = exportFiles(reference, ctx())
    for (const path of ['src/infra/banco.ts', 'src/infra/migrar.ts']) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), files[path])
    }
    mod = (await import(/* @vite-ignore */ pathToFileURL(join(dir, 'src/infra/banco.ts')).href)) as typeof mod
    migrar = ((await import(/* @vite-ignore */ pathToFileURL(join(dir, 'src/infra/migrar.ts')).href)) as { migrar: typeof migrar }).migrar
  }, 60_000)
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /** Pool and client as pg shapes them: query(sql, params) → { rows }, connect() → a client. One PGlite, so transactions don't overlap. */
  const fakePool = () => {
    const client = {
      query: async (sql: string, params?: unknown[]) => (params ? await pg.query(sql, params) : { rows: (await pg.exec(sql)).at(-1)?.rows ?? [] }),
      release: () => undefined,
    }
    return { ...client, connect: async () => client, end: async () => undefined }
  }

  const openers: [string, () => Banco][] = [
    ['pg', () => mod.pgBanco(fakePool())],
    ['PGlite', () => mod.pgliteBanco(pg)],
  ]
  for (const [name, open] of openers)
    describe(name, () => {
      const reset = () => pg.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE TABLE t (id serial PRIMARY KEY, n text NOT NULL)')

      it('runs the contract the runtime makes: query with and without params, rows as objects', async () => {
        await reset()
        const db = open()
        expect(await db.query('INSERT INTO t (n) VALUES ($1), ($2) RETURNING id, n', ['a', 'b'])).toEqual([
          { id: 1, n: 'a' },
          { id: 2, n: 'b' },
        ])
        expect(await db.query('SELECT n FROM t ORDER BY id')).toEqual([{ n: 'a' }, { n: 'b' }])
        await expect(db.query('INSERT INTO t (n) VALUES ($1)', [null])).rejects.toThrow(/null value/)
      })

      it('commits a transaction and rolls it back when the function throws', async () => {
        await reset()
        const db = open()
        expect(await db.transaction(async (tx) => (await tx.query('INSERT INTO t (n) VALUES ($1) RETURNING id', ['ok']))[0].id)).toBe(1)
        await expect(
          db.transaction(async (tx) => {
            await tx.query('INSERT INTO t (n) VALUES ($1)', ['perdido'])
            throw new Error('falhou')
          }),
        ).rejects.toThrow('falhou')
        expect(await db.query('SELECT n FROM t')).toEqual([{ n: 'ok' }])
      })

      it('makes a nested transaction a savepoint: only the inner part is undone', async () => {
        await reset()
        const db = open()
        await db.transaction(async (tx) => {
          await tx.query('INSERT INTO t (n) VALUES ($1)', ['fora'])
          await tx
            .transaction(async (inner) => {
              await inner.query('INSERT INTO t (n) VALUES ($1)', ['dentro'])
              throw new Error('só o de dentro')
            })
            .catch(() => undefined)
          await tx.transaction((inner) => inner.query('INSERT INTO t (n) VALUES ($1)', ['aninhada']))
        })
        expect(await db.query('SELECT n FROM t ORDER BY id')).toEqual([{ n: 'fora' }, { n: 'aninhada' }])
      })

      it('applies the migrations once, in order, and tells which', async () => {
        await pg.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
        const db = open()
        const pasta = join(dir, 'migrations-' + name)
        mkdirSync(pasta, { recursive: true })
        writeFileSync(join(pasta, '010_b.sql'), 'ALTER TABLE a ADD COLUMN y int;')
        writeFileSync(join(pasta, '002_a.sql'), 'CREATE TABLE a (x int); INSERT INTO a VALUES (1);')
        expect(await migrar(db, pasta)).toEqual(['002_a.sql', '010_b.sql'])
        expect(await migrar(db, pasta)).toEqual([])
        expect(await db.query('SELECT x, y FROM a')).toEqual([{ x: 1, y: null }])
        writeFileSync(join(pasta, '011_ruim.sql'), 'CREATE TABLE a (z int);')
        await expect(migrar(db, pasta)).rejects.toThrow('A migração 011_ruim.sql falhou')
        expect((await db.query('SELECT name FROM _migrations ORDER BY name')).map((r) => r.name)).toEqual(['002_a.sql', '010_b.sql'])
      })
    })
})
