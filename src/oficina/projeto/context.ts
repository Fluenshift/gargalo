// "Copiar contexto": the stage, the project's files, the last failing test and its explained error, as text to paste into an assistant.

import type { TestResult } from '../exercise'
import type { Explanation } from './explain'
import type { Project } from './project'
import type { Stage } from './stage'

export interface ContextInput {
  project: Project
  stage?: Pick<Stage, 'title' | 'statement'>
  failure?: TestResult
  explanation?: Explanation
  /** Cap on the text: file contents are cut to fit beside the rest, and a closing note (not counted) says which. */
  maxChars?: number
}

export const CONTEXT_MAX_CHARS = 24_000

const FRAMEWORK = { hono: 'Hono 4 (TypeScript)', fetch: 'fetch puro: export default { fetch(req, env) } (TypeScript)' }

/** The entry first, then the rest of src/, then everything else (migrations), each group by path. */
const order = (paths: string[]) => paths.toSorted((a, b) => rank(a) - rank(b) || a.localeCompare(b))
// Not imported from modules.ts, which would pull hono and sucrase into the page.
const rank = (p: string) => (p === 'src/index.ts' ? 0 : p.startsWith('src/') ? 1 : 2)

const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))

export function buildContext({ project, stage, failure, explanation, maxChars = CONTEXT_MAX_CHARS }: ContextInput): string {
  const head = [
    ...(stage ? [`# Etapa: ${stage.title}`, '', stage.statement, ''] : []),
    `Framework: ${FRAMEWORK[project.framework]}. Banco: Postgres (PGlite), em env.db (Hono: c.env.db) com query(sql, params) e transaction(fn).`,
    '',
  ]
  const tail: string[] = []
  if (failure) {
    tail.push(`## Último teste que falhou: ${failure.name}`, '', failure.message ?? '')
    if (failure.expected !== undefined) tail.push(`Esperado: ${show(failure.expected)}`)
    if (failure.received !== undefined) tail.push(`Recebido: ${show(failure.received)}`)
    if (failure.file) tail.push(`Em: ${failure.file}${failure.line ? `:${failure.line}` : ''}`)
    tail.push('')
  }
  if (explanation) tail.push(`## Erro explicado: ${explanation.title}`, '', explanation.detail, `Próximo passo: ${explanation.next}`, '')

  const paths = order(Object.keys(project.files))
  const tree = ['## Arquivos', '', ...paths.map((p) => `- ${p}`), '']
  let budget = maxChars - [...head, ...tree, ...tail].join('\n').length
  const blocks: string[] = []
  const cut: string[] = []
  for (const path of paths) {
    const content = project.files[path]
    const fence = path.endsWith('.sql') ? 'sql' : 'ts'
    const frame = `### ${path}\n\n\`\`\`${fence}\n\n\`\`\`\n`.length
    if (budget - frame <= 0) {
      cut.push(`${path} (fora)`)
      continue
    }
    const kept = content.slice(0, budget - frame)
    if (kept.length < content.length) cut.push(`${path} (só os primeiros ${kept.length} de ${content.length} caracteres)`)
    blocks.push(`### ${path}\n\n\`\`\`${fence}\n${kept}\n\`\`\`\n`)
    budget -= frame + kept.length
  }
  const note = cut.length ? [`Cortado para caber em ${maxChars} caracteres: ${cut.join(', ')}.`, ''] : []
  return [...head, ...tree, ...blocks, ...note, ...tail].join('\n').trimEnd() + '\n'
}
