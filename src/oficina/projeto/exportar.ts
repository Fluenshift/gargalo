// "Baixar projeto": the player's project as a Node project that runs outside the browser (npm install, npm test, npm start).
// Pure: files in, files out. The zip is zip.ts; the download is the page's.

import type { Results } from '../../score'
import { evaluateChecklist, info } from './checklist'
import { BANCO, COMPOSE, ENV_EXAMPLE, GITIGNORE, MIGRAR, SERVIDOR, SUPORTE, TSCONFIG, VITEST_CONFIG, VITEST_HISTORICO } from './exportarFontes'
import { stringify, type OpenApiDoc } from './openapi'
import type { Project } from './project'
import { stagePassed, stageResultId, type ProjectCourse, type Stage } from './stage'

export interface ExportContext {
  /** The project's name in the list. */
  name: string
  course: ProjectCourse
  /** Saved results (`gargalo:results`): which stages were passed, and with how many stars. */
  results: Results
  openapi: OpenApiDoc
}

/** Where the generated runtime lives; under `src/infra/` so it can't collide with the player's `src/db/` folder. */
const INFRA = 'src/infra'

/** Versions of what the stages' code imports; the game pins these same ones. */
const VERSIONS: Record<string, string> = { hono: '4.13.19', zod: '4.6.7' }

/** Packages the player's files import (not relative, not node:). */
export function importedPackages(files: Record<string, string>): string[] {
  const found = new Set<string>()
  for (const code of Object.values(files))
    for (const m of code.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"./][^'"]*)['"]/g)) {
      if (m[1].startsWith('node:')) continue
      const parts = m[1].split('/')
      found.add(m[1].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0])
    }
  return [...found].sort()
}

export const slugOf = (name: string) =>
  name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'projeto-gargalo'

const sorted = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))

function packageJson(project: Project, slug: string): string {
  const dependencies: Record<string, string> = { '@hono/node-server': '^2.1.11', '@electric-sql/pglite': '0.5.17', hono: VERSIONS.hono, pg: '^8.23.1' }
  for (const p of importedPackages(project.files)) dependencies[p] ??= VERSIONS[p] ?? 'latest'
  const pkg = {
    name: slug,
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: {
      start: 'tsx src/infra/servidor.ts',
      dev: 'tsx watch src/infra/servidor.ts',
      migrar: 'tsx src/infra/migrar.ts',
      banco: 'docker compose up -d',
      test: 'vitest run',
      'test:historico': 'vitest run --config vitest.historico.config.ts',
    },
    dependencies: sorted(dependencies),
    devDependencies: sorted({ '@types/node': '^24.0.0', '@types/pg': '^8.23.1', tsx: '^4.23.15', typescript: '~7.0.2', vitest: '^3.2.0' }),
    engines: { node: '>=22' },
  }
  return JSON.stringify(pkg, null, 2) + '\n'
}

/** The latest stage's tests are the project's (`tests/`); earlier ones, which later stages may have changed (auth on routes that were open), go in `tests/historico/`. */
function stageTest(index: number, stage: Stage, current: boolean): [string, string] {
  const path = `tests/${current ? '' : 'historico/'}etapa-${String(index + 1).padStart(2, '0')}-${stage.id}.test.ts`
  const up = current ? '..' : '../..'
  return [
    path,
    `import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import type { Banco } from '${up}/src/infra/banco'
import { abrirBanco, preparar, rodar, type Caso } from '${current ? '.' : '..'}/suporte'

const SEED: string | undefined = ${JSON.stringify(stage.seed)}

const casos: Caso[] = ${JSON.stringify(stage.tests, null, 2)}

let banco: Banco
beforeAll(async () => {
  banco = await abrirBanco()
})
afterAll(() => banco.close())
beforeEach(() => preparar(banco, SEED))

describe(${JSON.stringify(`Etapa ${index + 1}: ${stage.title}`)}, () => {
  for (const caso of casos) it(caso.name, () => rodar(banco, caso))
})
`,
  ]
}

/** Checklist items the stage met: all of them with 3 stars; otherwise only the ones the code alone proves (static items). */
function practices(stage: Stage, stars: number, files: Record<string, string>): string[] {
  return stage.checklist.filter((ref) => stars >= 3 || (info(ref.id).kind === 'static' && evaluateChecklist([ref], files, [])[0].passed)).map((ref) => info(ref.id).title)
}

function readme(project: Project, ctx: ExportContext, slug: string, done: Stage[]): string {
  const operations = Object.entries(ctx.openapi.paths).flatMap(([path, methods]) => Object.keys(methods).map((m) => `- \`${m.toUpperCase()} ${path}\``))
  const stars = (s: Stage) => ctx.results[stageResultId(ctx.course.id, s.id)]?.stars ?? 0
  const met = done.flatMap((s) => practices(s, stars(s), project.files).map((p) => `- ${p} (${s.title})`))
  return [
    `# ${ctx.name}`,
    '',
    `Projeto do curso "${ctx.course.title}" do [Gargalo](https://github.com/Fluenshift/gargalo), escrito em ${project.framework === 'hono' ? 'Hono' : 'fetch puro'} com Postgres.`,
    '',
    '## O que a API faz',
    '',
    ...(operations.length ? operations : ['_Nenhuma rota registrada no openapi.json ainda._']),
    '',
    'O contrato completo está em `openapi.json`.',
    '',
    '## Etapas concluídas',
    '',
    ...(done.length ? done.map((s) => `- ${s.title} (${stars(s)} de 3 estrelas)`) : ['_Nenhuma etapa concluída ainda._']),
    '',
    '## Boas práticas do checklist',
    '',
    ...(met.length ? met : ['_Nenhuma prática confirmada ainda._']),
    '',
    '## Como rodar',
    '',
    'Precisa de Node 22 ou mais novo. Depois de `npm install`, são dois jeitos.',
    '',
    'Com Docker (Postgres de verdade):',
    '',
    '```sh',
    'npm run banco',
    'export DATABASE_URL=postgres://gargalo:gargalo@localhost:5432/gargalo',
    'npm start',
    '```',
    '',
    'Sem Docker (PGlite, Postgres em WASM, gravado em `./.dados`):',
    '',
    '```sh',
    'npm start',
    '```',
    '',
    'As migrações em `migrations/` rodam sozinhas ao iniciar; `npm run migrar` roda só elas. A API fica em http://localhost:3000. As variáveis estão em `.env.example`.',
    '',
    '## Testes',
    '',
    'Os testes de aceitação da última etapa concluída ficam em `tests/` e rodam num Postgres em memória (PGlite), sem Docker:',
    '',
    '```sh',
    'npm test',
    '```',
    '',
    'Os das etapas anteriores ficam em `tests/historico/` (`npm run test:historico`). Etapas novas podem mudar o que as antigas testavam (a autenticação, por exemplo, fecha rotas que antes eram abertas), então alguns deles podem falhar por isso, não por defeito.',
    '',
    '## Publicar no GitHub',
    '',
    '```sh',
    'git init',
    'git add .',
    'git commit -m "Primeira versão"',
    `gh repo create ${slug} --public --source . --push`,
    '```',
    '',
  ].join('\n')
}

/** The project's files plus everything it needs to run outside the browser, by path. */
export function exportFiles(project: Project, ctx: ExportContext): Record<string, string> {
  const slug = slugOf(ctx.name)
  const done = ctx.course.stages.filter((s) => stagePassed(ctx.results, ctx.course.id, s.id))
  const tests = Object.fromEntries(ctx.course.stages.flatMap((s, i) => (done.includes(s) ? [stageTest(i, s, s === done.at(-1))] : [])))
  return {
    ...project.files,
    [`${INFRA}/banco.ts`]: BANCO,
    [`${INFRA}/migrar.ts`]: MIGRAR,
    [`${INFRA}/servidor.ts`]: SERVIDOR,
    'package.json': packageJson(project, slug),
    'tsconfig.json': TSCONFIG,
    'vitest.config.ts': VITEST_CONFIG,
    'vitest.historico.config.ts': VITEST_HISTORICO,
    'docker-compose.yml': COMPOSE,
    '.env.example': ENV_EXAMPLE,
    '.gitignore': GITIGNORE,
    'tests/suporte.ts': SUPORTE,
    ...tests,
    'openapi.json': stringify(ctx.openapi) + '\n',
    'README.md': readme(project, ctx, slug, done),
  }
}
