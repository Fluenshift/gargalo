// The good-practice checklist of a project stage (decision 8 of docs/specs/oficina-projetos.md): each item is checked
// by reading the project's files (static) or by requests against the test database (behaviour), or both.

import type { CapturedResponse, RequestSpec, TestCase, TestResult, TestStep } from '../exercise'

export type CheckKind = 'static' | 'behaviour' | 'both'

/** Steps run first in the item's test (log in, create a row…); they can `save` values its requests use as `{{name}}`. */
interface Before {
  before?: TestStep[]
}

/** An item as a stage lists it: the id, plus what the behaviour items need to know about this stage's API. */
export type CheckRef =
  | { id: 'sql-parametrizado' | 'camadas' | 'sem-select-estrela' | 'transacao' }
  | ({ id: 'criado-201-location'; /** Creates something. */ request: RequestSpec } & Before)
  | ({ id: 'problem-json'; /** Fails (404, 400…). */ request: RequestSpec } & Before)
  | ({ id: 'validacao-400'; /** Sends an invalid body. */ request: RequestSpec; /** Each must be named in the answer. */ fields: string[] } & Before)
  | ({ id: 'paginacao-cursor'; /** Asks for far more than the cap, e.g. `/produtos?limite=1000`. */ path: string; max: number } & Before)
  | ({ id: 'sem-vazar-campos'; requests: RequestSpec[]; /** Keys no response may have, e.g. `senha`, `senha_hash`. */ fields: string[] } & Before)
  | ({ id: 'idempotencia'; /** Sent twice, with its Idempotency-Key header. */ request: RequestSpec; /** Must return one row after both. */ sql: string } & Before)
  | ({ id: 'senha-hash'; /** Creates a user with `password`. */ request: RequestSpec; password: string; /** Reads the stored user back. */ sql: string } & Before)
  | ({ id: 'auth-401-403'; /** No credentials. */ anonymous: RequestSpec; /** Valid credentials, no permission. */ forbidden: RequestSpec } & Before)

export type CheckId = CheckRef['id']

export interface CheckInfo {
  id: CheckId
  kind: CheckKind
  title: string
  /** Why it matters, one line. */
  why: string
  /** How the game checks it. */
  how: string
  /** What to change when it fails. */
  fix: string
}

export interface Verdict {
  passed: boolean
  message: string
}

export interface CheckOutcome extends CheckInfo, Verdict {}

type Files = Record<string, string>

// --- Reading source text without a parser ---

export interface Literal {
  /** The static text; each `${…}` reads `?`. */
  text: string
  interpolated: boolean
  start: number
  end: number
}

/** Every string and template literal of a TS file, and the code with literals and comments blanked (lines kept). */
// shortcut: a regex literal containing a quote confuses it; fine for SQL heuristics, use a tokenizer if checks need more.
export function scan(src: string): { literals: Literal[]; code: string } {
  const literals: Literal[] = []
  const code = src.split('')
  const blank = (a: number, b: number) => {
    for (let k = a; k < b && k < code.length; k++) if (code[k] !== '\n') code[k] = ' '
  }
  const quoted = (i: number): number => {
    const quote = src[i]
    let j = i + 1
    let text = ''
    while (j < src.length && src[j] !== quote && src[j] !== '\n') {
      if (src[j] === '\\') {
        text += src[j + 1] ?? ''
        j += 2
      } else text += src[j++]
    }
    literals.push({ text, interpolated: false, start: i, end: j + 1 })
    blank(i, j + 1)
    return j + 1
  }
  const template = (i: number): number => {
    const literal: Literal = { text: '', interpolated: false, start: i, end: i }
    literals.push(literal)
    let j = i + 1
    while (j < src.length && src[j] !== '`') {
      if (src[j] === '\\') {
        literal.text += src[j + 1] ?? ''
        j += 2
      } else if (src[j] === '$' && src[j + 1] === '{') {
        literal.interpolated = true
        literal.text += '?'
        j = expression(j + 2, true) + 1
      } else literal.text += src[j++]
    }
    literal.end = j + 1
    blank(i, j + 1)
    return j + 1
  }
  // Code up to the `}` closing a template's `${` (when `close`), or to the end.
  const expression = (i: number, close: boolean): number => {
    let depth = 0
    while (i < src.length) {
      const c = src[i]
      if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
        const line = src[i + 1] === '/'
        const end = line ? src.indexOf('\n', i) : src.indexOf('*/', i + 2)
        const stop = end < 0 ? src.length : line ? end : end + 2
        blank(i, stop)
        i = stop
      } else if (c === '"' || c === "'") i = quoted(i)
      else if (c === '`') i = template(i)
      else {
        if (close && c === '{') depth++
        if (close && c === '}' && depth-- === 0) return i
        i++
      }
    }
    return i
  }
  expression(0, false)
  return { literals, code: code.join('') }
}

const lineOf = (src: string, index: number) => src.slice(0, index).split('\n').length

/** Text that reads as SQL. */
const SQL = /\b(select\b[\s\S]*\bfrom|insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i
/** Parts of a query that only show up once a statement is being glued together. */
const SQL_PIECE = /\bwhere\b|\bvalues\s*\(/i

/** The project's TypeScript files under src/. */
const sources = (files: Files) => Object.entries(files).filter(([path]) => path.startsWith('src/') && path.endsWith('.ts'))

function findings(files: Files, find: (src: string, path: string) => string[]): string[] {
  return sources(files).flatMap(([path, src]) => find(src, path))
}

const verdict = (problems: string[], ok: string): Verdict => (problems.length ? { passed: false, message: problems.join('\n') } : { passed: true, message: ok })

function concatenatedSql(src: string, path: string): string[] {
  const { literals, code } = scan(src)
  const next = (i: number) => /^\s*(\S)/.exec(code.slice(i))?.[1]
  const prev = (i: number) => /(\S)\s*$/.exec(code.slice(0, i))?.[1]
  return literals
    .filter((l) => (l.interpolated ? SQL.test(l.text) || SQL_PIECE.test(l.text) : SQL.test(l.text) && (next(l.end) === '+' || prev(l.start) === '+')))
    .map((l) => `${path}:${lineOf(src, l.start)}: SQL montado com ${l.interpolated ? '${…}' : '+'}.`)
}

function directSql(src: string, path: string): string[] {
  if (!path.startsWith('src/routes/') && path !== 'src/index.ts') return []
  const { code } = scan(src)
  return [...code.matchAll(/\b(?:db|tx)\s*\.\s*(?:query|transaction)\s*\(/g)].map((m) => `${path}:${lineOf(src, m.index)}: a rota chama o banco direto.`)
}

function selectStar(src: string, path: string): string[] {
  return scan(src)
    .literals.filter((l) => /\bselect\s+(?:distinct\s+)?(?:\w+\.)?\*/i.test(l.text))
    .map((l) => `${path}:${lineOf(src, l.start)}: SELECT *.`)
}

function writesWithoutTransaction(src: string, path: string): string[] {
  const { literals, code } = scan(src)
  const tables = new Set(
    literals.filter((l) => SQL.test(l.text)).flatMap((l) => [...l.text.matchAll(/\b(?:insert\s+into|update|delete\s+from)\s+"?(\w+)/gi)].map((m) => m[1].toLowerCase())),
  )
  // shortcut: per file, not per function; a write split across files goes unseen. Track calls between modules if stages need it.
  return tables.size >= 2 && !/\.\s*transaction\s*\(/.test(code) ? [`${path}: escreve em ${[...tables].join(', ')} sem db.transaction.`] : []
}

const HASHING = /crypto\s*\.\s*subtle\s*\.\s*(digest|deriveBits|deriveKey)|pbkdf2|scrypt|bcrypt|argon2/i

// --- Behaviour: one sequential test per item, judged on what it captured ---

type Judge<R> = (ref: R, responses: (CapturedResponse | undefined)[], rows: unknown[] | undefined) => Verdict

interface Behaviour<R> {
  steps(ref: R): TestStep[]
  db?(ref: R): string
  judge: Judge<R>
}

type RefOf<I extends CheckId> = Extract<CheckRef, { id: I }>

interface CheckDef<I extends CheckId> extends Omit<CheckInfo, 'id' | 'kind'> {
  static?(files: Files): Verdict
  behaviour?: Behaviour<RefOf<I>>
}

const said = (r: CapturedResponse) => `respondeu ${r.status}`
const label = (req: RequestSpec) => `${req.method ?? 'GET'} ${req.path}`
const fail = (message: string): Verdict => ({ passed: false, message })
const pass = (message: string): Verdict => ({ passed: true, message })

function hasKey(value: unknown, keys: Set<string>): string | undefined {
  if (Array.isArray(value)) return value.map((v) => hasKey(v, keys)).find(Boolean)
  if (value === null || typeof value !== 'object') return undefined
  for (const [k, v] of Object.entries(value)) {
    if (keys.has(k.toLowerCase())) return k
    const inner = hasKey(v, keys)
    if (inner) return inner
  }
  return undefined
}

const CHECKS: { [I in CheckId]: CheckDef<I> } = {
  'sql-parametrizado': {
    title: 'SQL parametrizado',
    why: 'Valor do usuário colado no SQL abre a porta para SQL injection.',
    how: 'Procura no código SQL montado com ${…} ou com +.',
    fix: "Escreva placeholders e passe os valores à parte: db.query('SELECT … WHERE id = $1', [id]).",
    static: (files) => verdict(findings(files, concatenatedSql), 'Todo SQL usa parâmetros.'),
  },
  camadas: {
    title: 'Rotas sem SQL',
    why: 'Rota cuida de HTTP; acesso ao banco num módulo só fica fácil de testar e de trocar.',
    how: 'Procura db.query e db.transaction em src/routes/ e src/index.ts.',
    fix: 'Mova as consultas para src/db/ (ou um repositório) e chame essas funções na rota.',
    static: (files) => verdict(findings(files, directSql), 'As rotas não falam SQL direto.'),
  },
  'sem-select-estrela': {
    title: 'Sem SELECT *',
    why: 'SELECT * devolve colunas que você não escolheu, inclusive as que não deviam sair (senha, hash).',
    how: 'Procura SELECT * nos textos de SQL em src/.',
    fix: 'Liste as colunas: SELECT id, nome, preco_centavos FROM produtos.',
    static: (files) => verdict(findings(files, selectStar), 'Toda consulta lista as colunas.'),
  },
  transacao: {
    title: 'Escrita em várias tabelas numa transação',
    why: 'Sem transação, uma falha no meio deixa metade gravada (um pedido sem itens).',
    how: 'Num arquivo que escreve em duas tabelas ou mais, procura db.transaction.',
    fix: 'Envolva as escritas: await db.transaction(async (tx) => { await tx.query(…); await tx.query(…) }).',
    static: (files) => verdict(findings(files, writesWithoutTransaction), 'Escritas em várias tabelas ficam numa transação.'),
  },
  'criado-201-location': {
    title: '201 com Location ao criar',
    why: 'Quem cria precisa saber onde o recurso novo está, sem adivinhar a URL.',
    how: 'Cria um recurso, confere 201 e o cabeçalho Location, e faz GET nele.',
    fix: "Responda c.json(criado, 201) com c.header('Location', `/produtos/${id}`), ou Response.json(criado, { status: 201, headers: { Location } }).",
    behaviour: {
      steps: (ref) => [{ request: ref.request, save: { local: 'header.location' } }, { request: { path: '{{local}}' } }],
      judge: (ref, [created, read]) => {
        if (!created) return fail(`${label(ref.request)} não respondeu.`)
        if (created.status !== 201) return fail(`${label(ref.request)} ${said(created)}, esperado 201.`)
        const location = created.headers.location
        if (!location) return fail('Faltou o cabeçalho Location.')
        if (read?.status !== 200) return fail(`GET ${location} ${read ? said(read) : 'não respondeu'}, esperado 200.`)
        return pass(`201 com Location: ${location}.`)
      },
    },
  },
  'problem-json': {
    title: 'Erros em problem+json',
    why: 'Um formato só de erro (RFC 9457) deixa o cliente tratar todos do mesmo jeito.',
    how: 'Provoca um erro e confere Content-Type application/problem+json com type, title e status.',
    fix: "Responda c.json({ type, title, status, detail }, status, { 'Content-Type': 'application/problem+json' }); um app.onError ajuda a fazer isso num lugar só.",
    behaviour: {
      steps: (ref) => [{ request: ref.request }],
      judge: (ref, [res]) => {
        if (!res) return fail(`${label(ref.request)} não respondeu.`)
        if (res.status < 400) return fail(`${label(ref.request)} ${said(res)}; esperado um erro.`)
        if (!res.headers['content-type']?.startsWith('application/problem+json')) return fail(`Content-Type foi ${res.headers['content-type'] ?? 'nenhum'}, esperado application/problem+json.`)
        const body = (res.body ?? {}) as Record<string, unknown>
        const missing = ['type', 'title'].filter((k) => typeof body[k] !== 'string')
        if (body.status !== res.status) missing.push('status')
        return missing.length ? fail(`O corpo não tem ${missing.join(', ')} (status deve repetir o da resposta).`) : pass('Erro em problem+json.')
      },
    },
  },
  'validacao-400': {
    title: 'Validação na borda',
    why: 'Entrada inválida para na porta com 400, sem chegar ao banco como 500.',
    how: 'Envia um corpo inválido e confere 400 com cada campo errado citado.',
    fix: 'Valide com zod (schema.safeParse(body)) e devolva 400 listando os campos de error.issues.',
    behaviour: {
      steps: (ref) => [{ request: ref.request }],
      judge: (ref, [res]) => {
        if (!res) return fail(`${label(ref.request)} não respondeu.`)
        if (res.status !== 400) return fail(`${label(ref.request)} ${said(res)}, esperado 400.`)
        const text = JSON.stringify(res.body)
        const missing = ref.fields.filter((f) => !text.includes(f))
        return missing.length ? fail(`A resposta não cita: ${missing.join(', ')}.`) : pass('400 com os campos inválidos.')
      },
    },
  },
  'paginacao-cursor': {
    title: 'Paginação por cursor com limite',
    why: 'Sem limite, um pedido de 1 milhão de linhas derruba o banco; o cursor não pula nem repete itens.',
    how: 'Pede muito mais itens do que o máximo e confere que vieram no máximo esse tanto, com um cursor para a próxima página.',
    fix: 'Limite com Math.min(limite, MAX), busque WHERE id > $cursor ORDER BY id LIMIT $n e devolva { itens, proximoCursor }.',
    behaviour: {
      steps: (ref) => [{ request: { path: ref.path } }],
      judge: (ref, [res]) => {
        if (!res) return fail(`GET ${ref.path} não respondeu.`)
        if (res.status !== 200) return fail(`GET ${ref.path} ${said(res)}, esperado 200.`)
        if (Array.isArray(res.body)) return fail('A resposta é só a lista; devolva um objeto com a lista e o cursor: { itens, proximoCursor }.')
        const body = (res.body ?? {}) as Record<string, unknown>
        const list = Object.values(body).find(Array.isArray)
        if (!list) return fail('Não achei a lista de itens na resposta.')
        if (list.length > ref.max) return fail(`Vieram ${list.length} itens; o máximo é ${ref.max}.`)
        return Object.keys(body).some((k) => /cursor|pr[oó]xim|next/i.test(k)) ? pass(`No máximo ${ref.max}, com cursor.`) : fail('Faltou o cursor da próxima página (por exemplo proximoCursor).')
      },
    },
  },
  'sem-vazar-campos': {
    title: 'Sem vazar campos internos',
    why: 'Senha, hash e campos internos não saem da API, nem por engano.',
    how: 'Faz as requisições e procura esses campos nas respostas.',
    fix: 'Escolha o que sai: liste as colunas no SELECT ou monte o objeto da resposta campo a campo.',
    behaviour: {
      steps: (ref) => ref.requests.map((request) => ({ request })),
      judge: (ref, responses) => {
        const keys = new Set(ref.fields.map((f) => f.toLowerCase()))
        for (const [i, res] of responses.entries()) {
          if (!res) return fail(`${label(ref.requests[i])} não respondeu.`)
          const leaked = hasKey(res.body, keys)
          if (leaked) return fail(`${label(ref.requests[i])} devolve o campo ${leaked}.`)
        }
        return pass('Nenhum campo interno nas respostas.')
      },
    },
  },
  idempotencia: {
    title: 'Idempotência',
    why: 'Um pagamento repetido pela rede (timeout, retry) não pode cobrar duas vezes.',
    how: 'Envia o mesmo POST com a mesma Idempotency-Key duas vezes: mesma resposta e uma linha só no banco.',
    fix: 'Guarde a chave com UNIQUE e a resposta; se a chave já existe, devolva a resposta guardada em vez de gravar de novo.',
    behaviour: {
      steps: (ref) => [{ request: ref.request }, { request: ref.request }],
      db: (ref) => ref.sql,
      judge: (ref, [first, second], rows) => {
        if (!first || !second) return fail(`${label(ref.request)} não respondeu.`)
        if (first.status >= 300) return fail(`A primeira vez ${said(first)}.`)
        if (second.status !== first.status || JSON.stringify(second.body) !== JSON.stringify(first.body)) return fail('A segunda vez respondeu diferente da primeira.')
        return rows?.length === 1 ? pass('Repetir não grava de novo.') : fail(`Depois das duas, o banco tem ${rows?.length ?? 0} linhas; esperado 1.`)
      },
    },
  },
  'senha-hash': {
    title: 'Senha com hash',
    why: 'Se o banco vazar, a senha não pode estar lá em texto.',
    how: 'Cria um usuário, lê o que ficou gravado e confere que a senha não aparece; procura no código uma função de hash (PBKDF2, scrypt…).',
    fix: "Derive com crypto.subtle (importKey + deriveBits com 'PBKDF2', sal aleatório por usuário) e grave sal e hash, nunca a senha.",
    static: (files) =>
      sources(files).some(([, src]) => HASHING.test(src)) ? pass('O código usa uma função de hash.') : fail('Não achei hash de senha no código (crypto.subtle, PBKDF2, scrypt…).'),
    behaviour: {
      steps: (ref) => [{ request: ref.request }],
      db: (ref) => ref.sql,
      judge: (ref, [res], rows) => {
        if (!res || res.status >= 300) return fail(`${label(ref.request)} ${res ? said(res) : 'não respondeu'}.`)
        if (!rows?.length) return fail('O usuário não foi gravado.')
        return JSON.stringify(rows).includes(ref.password) ? fail('A senha está gravada como veio.') : pass('A senha não fica gravada como veio.')
      },
    },
  },
  'auth-401-403': {
    title: '401 contra 403',
    why: '401 é "quem é você?"; 403 é "sei quem é, mas não pode". O cliente reage diferente a cada um.',
    how: 'Chama sem credencial (espera 401) e com credencial sem permissão (espera 403).',
    fix: 'Sem token ou token inválido: 401. Token válido sem a permissão: 403.',
    behaviour: {
      steps: (ref) => [{ request: ref.anonymous }, { request: ref.forbidden }],
      judge: (ref, [anonymous, forbidden]) => {
        if (anonymous?.status !== 401) return fail(`Sem credencial, ${label(ref.anonymous)} ${anonymous ? said(anonymous) : 'não respondeu'}; esperado 401.`)
        if (forbidden?.status !== 403) return fail(`Sem permissão, ${label(ref.forbidden)} ${forbidden ? said(forbidden) : 'não respondeu'}; esperado 403.`)
        return pass('401 sem credencial, 403 sem permissão.')
      },
    },
  },
}

const kindOf = (def: CheckDef<CheckId>): CheckKind => (def.static && def.behaviour ? 'both' : def.static ? 'static' : 'behaviour')

/** The catalogue, for the UI: every item with its texts and kind. */
export const CATALOGUE: CheckInfo[] = (Object.keys(CHECKS) as CheckId[]).map((id) => info(id))

export function info(id: CheckId): CheckInfo {
  const { title, why, how, fix } = CHECKS[id]
  return { id, kind: kindOf(CHECKS[id] as CheckDef<CheckId>), title, why, how, fix }
}

const behaviourOf = (ref: CheckRef) => CHECKS[ref.id].behaviour as Behaviour<CheckRef> | undefined

/** The behaviour items' tests, in the order of `refs` (static items have none); run them with the stage's tests. */
export function checkTests(refs: CheckRef[]): TestCase[] {
  return refs.flatMap((ref) => {
    const b = behaviourOf(ref)
    if (!b) return []
    const sql = b.db?.(ref)
    const before = 'before' in ref ? (ref.before ?? []) : []
    return [{ name: `checklist:${ref.id}`, sequential: true, capture: true, requests: [...before, ...b.steps(ref)], ...(sql ? { db: { sql } } : {}) }]
  })
}

/** Judges every item: static ones on `files`, behaviour ones on `results`, the results of `checkTests(refs)` in order. */
export function evaluateChecklist(refs: CheckRef[], files: Files, results: TestResult[]): CheckOutcome[] {
  let next = 0
  return refs.map((ref) => {
    const def = CHECKS[ref.id] as CheckDef<CheckId>
    const verdicts: Verdict[] = []
    if (def.static) verdicts.push(def.static(files))
    const b = behaviourOf(ref)
    if (b) {
      const result = results[next++]
      const skip = 'before' in ref ? (ref.before?.length ?? 0) : 0
      const responses = result?.responses?.slice(skip) ?? []
      // A crash, or a `before` step that failed, leaves nothing to judge: the test's own message says why.
      verdicts.push(result && (responses.length || result.passed) ? b.judge(ref, responses, result.rows) : fail(result?.message ?? 'O teste não rodou.'))
    }
    const failed = verdicts.find((v) => !v.passed)
    return { ...info(ref.id), ...(failed ?? { passed: true, message: verdicts.map((v) => v.message).join(' ') }) }
  })
}
