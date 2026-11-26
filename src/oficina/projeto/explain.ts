// Common errors of a project in plain Portuguese, each with the next step to take.

import type { TestResult } from '../exercise'
import { TIMEOUT_MESSAGE } from '../runner'
import type { CodeError, RequestOutcome, Route } from './runtime'

export interface Explanation {
  title: string
  detail: string
  /** What to do now. */
  next: string
}

/** What was asked and, for Hono, the routes the app registered (`RequestOutcome.routes`). */
export interface ExplainContext {
  request?: { method?: string; path: string }
  routes?: Route[]
}

type Rule = [RegExp, (m: RegExpExecArray) => Explanation]

const RULES: Rule[] = [
  [
    /^A migração (\S+) falhou: ([\s\S]*)$/,
    (m) => ({
      title: 'A migração falhou',
      detail: `${m[1]}: ${m[2]}. Nada dela foi aplicado: cada migração roda numa transação.`,
      next: 'Corrija o SQL desse arquivo e aplique de novo. Para mudar uma tabela de uma migração que já rodou, crie uma migração nova (ALTER TABLE) em vez de editar a antiga.',
    }),
  ],
  [
    new RegExp(`^${TIMEOUT_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    () => ({
      title: 'Tempo esgotado',
      detail: 'A requisição passou de 2 s e foi interrompida.',
      next: 'Procure um loop que nunca termina ou um await que nunca resolve (uma Promise sem resolve, um while sem saída).',
    }),
  ],
  [
    /import "([^"]+)" não é permitido/,
    (m) => ({
      title: 'Import bloqueado',
      detail: `O pacote "${m[1]}" não existe aqui: só hono, hono/http-exception e zod, além dos arquivos do projeto.`,
      next: 'Troque pelo que a plataforma já tem (fetch, Request, Response, URL, crypto) ou importe um arquivo seu com ./ ou ../.',
    }),
  ],
  [
    /(\S+) importa "([^"]+)", mas esse arquivo não existe/,
    (m) => ({
      title: 'Arquivo importado não existe',
      detail: `${m[1]} importa "${m[2]}", que não está na árvore de arquivos.`,
      next: 'Confira o nome e a pasta (o caminho é relativo ao arquivo que importa) ou crie o arquivo.',
    }),
  ],
  [
    /precisa de um export default com fetch|Falta o arquivo de entrada/,
    () => ({
      title: 'Falta o export default',
      detail: 'src/index.ts precisa exportar por padrão algo com fetch(req, env).',
      next: 'No Hono, termine com export default app. No fetch puro, export default { async fetch(req, env) { … } }.',
    }),
  ],
  [
    /precisa devolver um Response/,
    () => ({
      title: 'Faltou devolver a resposta',
      detail: 'O fetch terminou sem devolver um Response (talvez um caminho do código sem return).',
      next: 'Garanta um return em todo caminho: return Response.json(…) no fetch puro, return c.json(…) no Hono.',
    }),
  ],
  [
    /Erro de sintaxe/,
    () => ({
      title: 'Erro de sintaxe',
      detail: 'O TypeScript não conseguiu ler o arquivo.',
      next: 'Olhe a linha indicada e a anterior: parêntese, chave ou aspas sem fechar, vírgula sobrando.',
    }),
  ],
  [
    /column "([^"]+)"(?: of relation "([^"]+)")? does not exist/,
    (m) => ({
      title: 'Coluna não existe',
      detail: `O banco não tem a coluna ${m[1]}${m[2] ? ` na tabela ${m[2]}` : ''} (erro 42703).`,
      next: 'Confira o nome na migração. Se a coluna é nova, crie uma migração com ALTER TABLE … ADD COLUMN e aplique.',
    }),
  ],
  [
    /relation "([^"]+)" does not exist/,
    (m) => ({
      title: 'Tabela não existe',
      detail: `O banco não tem a tabela ${m[1]} (erro 42P01).`,
      next: 'Crie a tabela numa migração e aplique as migrações; confira se o nome está igual nos dois lugares.',
    }),
  ],
  [
    /duplicate key value violates unique constraint "([^"]+)"/,
    (m) => ({
      title: 'Valor repetido',
      detail: `Já existe uma linha com esse valor, e a restrição ${m[1]} não deixa repetir (erro 23505).`,
      next: 'Responda 409 Conflict quando isso acontecer (capture o erro com código 23505) ou use INSERT … ON CONFLICT.',
    }),
  ],
  [
    /null value in column "([^"]+)"(?: of relation "([^"]+)")? violates not-null constraint/,
    (m) => ({
      title: 'Campo obrigatório vazio',
      detail: `A coluna ${m[1]}${m[2] ? ` de ${m[2]}` : ''} é NOT NULL e recebeu nulo (erro 23502).`,
      next: 'Valide o corpo antes de gravar e responda 400 quando faltar o campo; confira se o nome no JSON é o mesmo que você lê.',
    }),
  ],
  [
    /violates foreign key constraint "([^"]+)"/,
    (m) => ({
      title: 'Referência inválida',
      detail: `A restrição ${m[1]} exige que a linha referenciada exista (erro 23503).`,
      next: 'Confira se o id referenciado existe antes de gravar (responda 404 ou 422 se não existir) e, ao apagar, remova antes as linhas que apontam para ela.',
    }),
  ],
  [
    /A resposta traz o campo (\S+), que não pode sair\.$/,
    (m) => ({
      title: 'Campo que não pode sair',
      detail: `A resposta traz ${m[1]}. O que a API devolve qualquer cliente lê, e um campo interno não pode ir junto.`,
      next: 'Escolha o que sai: liste as colunas no SELECT, sem SELECT *, ou monte o objeto da resposta campo a campo.',
    }),
  ],
  [
    /A requisição fez \d+ consultas? ao banco; o máximo é \d+\.$/,
    () => ({
      title: 'Consultas demais',
      detail: 'Cada consulta é uma ida ao banco. Uma consulta por item da lista (N+1) faz a requisição crescer junto com a tabela.',
      next: 'Procure uma consulta dentro de um laço e busque tudo de uma vez, com WHERE … = ANY($1) ou um JOIN; depois monte a resposta em memória.',
    }),
  ],
  [
    /SyntaxError:.*JSON|JSON\.parse:|Malformed JSON/,
    () => ({
      title: 'JSON inválido no corpo',
      detail: 'O corpo da requisição não é um JSON válido, e ler com req.json() lança erro.',
      next: 'No cliente HTTP, confira aspas duplas e vírgulas do corpo. No código, responda 400 quando o JSON não ler: try { body = await req.json() } catch { … }.',
    }),
  ],
]

/** An error message from the runtime, Postgres or JavaScript, explained. */
export function explainMessage(message: string, where?: { file?: string; line?: number }): Explanation {
  for (const [pattern, explain] of RULES) {
    const m = pattern.exec(message)
    if (m) return explain(m)
  }
  const at = where?.file ? ` (${where.file}${where.line ? `:${where.line}` : ''})` : ''
  return { title: 'Erro no código', detail: message + at, next: 'Abra o arquivo na linha indicada; um console.log antes dela mostra os valores no console.' }
}

/** `/produtos/:id` → a regex for paths it serves. */
const routePattern = (path: string) =>
  new RegExp(
    `^${path
      .replace(/[.+?^$()|[\]\\]/g, '\\$&')
      .replace(/:\w+(\{[^}]*\})?/g, '[^/]+')
      .replace(/\*/g, '.*')}$`,
  )

/** A 404 or 405: the route isn't there, or not for this method. Undefined when the app has that route (the 404 is its own answer). */
export function explainNotFound(status: number, body: unknown, context: ExplainContext = {}): Explanation | undefined {
  const { request, routes } = context
  const method = (request?.method ?? 'GET').toUpperCase()
  const asked = request ? `${method} ${new URL(request.path, 'http://x').pathname}` : 'essa requisição'
  if (request && routes) {
    // Middleware (app.use) registers as ALL; it serves no request by itself.
    const endpoints = routes.filter((r) => r.method !== 'ALL')
    const pathname = new URL(request.path, 'http://x').pathname
    const same = endpoints.filter((r) => routePattern(r.path).test(pathname))
    if (same.some((r) => r.method === method)) return undefined
    if (same.length)
      return {
        title: 'Método errado',
        detail: `${pathname} existe para ${[...new Set(same.map((r) => r.method))].join(', ')}, mas não para ${method}.`,
        next: `Troque o método da requisição ou registre app.${method.toLowerCase()}('${same[0].path}', …).`,
      }
    const list = endpoints.map((r) => `${r.method} ${r.path}`).join(', ') || 'nenhuma'
    return {
      title: 'Rota não registrada',
      detail: `Nenhuma rota atende ${asked}. Rotas do app: ${list}.`,
      next: 'Registre a rota (app.get, app.post…) e, se ela está num sub-app, confira o prefixo de app.route() em src/index.ts.',
    }
  }
  if (status === 405)
    return {
      title: 'Método errado',
      detail: `O app respondeu 405: ${asked} não aceita esse método.`,
      next: 'Confira o método da requisição e o if (req.method === …) da rota.',
    }
  if (body === '404 Not Found')
    return {
      title: 'Rota não registrada',
      detail: `Nenhuma rota atende ${asked}.`,
      next: 'Registre a rota (app.get, app.post…) e confira o prefixo de app.route() em src/index.ts.',
    }
  return {
    title: 'Não encontrado (404)',
    detail: `${asked} respondeu 404: ou a rota não existe, ou o recurso pedido não está no banco.`,
    next: 'Confira método e caminho no roteamento (src/index.ts) e, se a rota existe, se o id pedido está no banco.',
  }
}

const INTERNAL: Explanation = {
  title: 'Erro interno (500)',
  detail: 'O código lançou um erro e o framework respondeu 500.',
  next: 'Rode a requisição no cliente HTTP e veja o erro no console.',
}

function explainStatus(status: number, body: unknown, logs: RequestOutcome['logs'], context: ExplainContext): Explanation | undefined {
  if (status === 404 || status === 405) return explainNotFound(status, body, context)
  if (status !== 500) return undefined
  const error = logs.findLast((l) => l.level === 'error')
  return error ? { ...explainMessage(error.text), title: `Erro interno (500): ${explainMessage(error.text).title.toLowerCase()}` } : INTERNAL
}

const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

/** A code error, a failed test or a request's outcome, explained; undefined when there is nothing wrong to explain. */
export function explain(input: CodeError | TestResult | RequestOutcome, context: ExplainContext = {}): Explanation | undefined {
  if ('logs' in input) {
    if (input.error) return explainMessage(input.error.message, input.error)
    const res = input.response
    return res && explainStatus(res.status, res.body, input.logs, { routes: input.routes, ...context })
  }
  if (!('passed' in input)) return explainMessage(input.message, input)
  if (input.passed) return undefined
  const message = input.message ?? ''
  if (/Status diferente do esperado\.$/.test(message) && typeof input.received === 'number') {
    const known = explainStatus(input.received, undefined, [], context)
    if (known) return known
  }
  if (/(Status|Cabeçalho .+|Corpo da resposta|Estado do banco) diferente do esperado\.$/.test(message))
    return {
      title: message,
      detail: `Esperado: ${show(input.expected)}. Recebido: ${show(input.received)}.`,
      next: 'Rode a mesma requisição no cliente HTTP e compare com o esperado.',
    }
  return explainMessage(message, input)
}
